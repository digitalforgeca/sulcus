//! Extension delivery endpoint — serves encrypted sulcus-sync dylibs to paid subscribers.
//!
//! GET /api/v1/extensions/sync?platform=<platform>
//!
//! The binary is loaded from one of two sources (checked in order):
//! 1. Local filesystem: `/opt/sulcus/extensions/{version}/{platform}/libsulcus_sync.{ext}`
//! 2. Remote storage:   `EXTENSION_STORAGE_URL/{version}/{platform}/libsulcus_sync.{ext}`
//!
//! The binary is encrypted on-the-fly with AES-256-GCM (fresh nonce per request) and returned
//! as JSON. The encryption key is derived from the subscriber's raw API key via HKDF-SHA256
//! so that only the key holder can decrypt the blob.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use axum::{
    extract::{Extension, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose, Engine as _};
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{middleware::TenantContext, SharedState};

/// In-memory cache for remotely-fetched extension binaries.
/// Key: "{version}/{platform}", Value: raw bytes.
static EXTENSION_CACHE: std::sync::OnceLock<Arc<RwLock<HashMap<String, Vec<u8>>>>> =
    std::sync::OnceLock::new();

fn extension_cache() -> &'static Arc<RwLock<HashMap<String, Vec<u8>>>> {
    EXTENSION_CACHE.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

const SUPPORTED_PLATFORMS: &[&str] = &[
    "darwin-arm64",
    "darwin-x86_64",
    "linux-x86_64",
    "linux-aarch64",
];

#[derive(Debug, Deserialize)]
pub struct ExtensionQuery {
    pub platform: String,
}

#[derive(Debug, Serialize)]
pub struct ExtensionResponse {
    pub version: String,
    pub platform: String,
    /// Hex-encoded 12-byte AES-GCM nonce.
    pub nonce: String,
    /// Base64-encoded AES-256-GCM ciphertext (includes 16-byte auth tag).
    pub encrypted_blob: String,
    /// Hex-encoded SHA-256 of the plaintext binary (for integrity check after decrypt).
    pub sha256_plaintext: String,
}

/// GET /api/v1/extensions/sync
///
/// Returns an encrypted sulcus-sync dylib for the subscriber's platform.
/// Requires `Authorization: Bearer <api-key>` and a paid plan tier.
pub async fn get_extension(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    headers: HeaderMap,
    Query(params): Query<ExtensionQuery>,
) -> Result<Json<ExtensionResponse>, StatusCode> {
    // Reject free-tier tenants
    if matches!(tenant.plan_tier.as_str(), "free" | "open") {
        return Err(StatusCode::PAYMENT_REQUIRED);
    }

    let platform = &params.platform;
    if !SUPPORTED_PLATFORMS.contains(&platform.as_str()) {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Extract raw API key from Authorization header (middleware already verified it)
    let raw_key = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Look up key_id for the download log
    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    let hash_hex = hex::encode(hasher.finalize());

    let key_row = sqlx::query("SELECT id FROM api_keys WHERE key_hash = $1")
        .bind(&hash_hex)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "DB error looking up key_id for extension log");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let key_id: uuid::Uuid = key_row
        .map(|r| r.get("id"))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Resolve extension version and file extension
    let ext_version = {
        let raw = std::env::var("SULCUS_EXTENSION_VERSION").unwrap_or_else(|_| "latest".to_string());
        // Normalize: storage directories use "v0.1.0" format; accept both "0.1.0" and "v0.1.0"
        if raw == "latest" || raw.starts_with('v') {
            raw
        } else {
            format!("v{}", raw)
        }
    };
    let file_ext = if platform.starts_with("darwin") {
        "dylib"
    } else {
        "so"
    };
    let lib_filename = format!("libsulcus_sync.{}", file_ext);

    // Try loading the binary: local filesystem first, then remote storage
    let plaintext = load_extension_binary(&ext_version, platform, &lib_filename)
        .await
        .map_err(|e| {
            tracing::error!(
                platform = %platform,
                version = %ext_version,
                error = %e,
                "extension binary not available"
            );
            StatusCode::NOT_FOUND
        })?;

    // SHA-256 of plaintext for integrity check on the client side
    let mut sha_hasher = Sha256::new();
    sha_hasher.update(&plaintext);
    let sha256_plaintext = hex::encode(sha_hasher.finalize());

    // Derive 32-byte AES key: HKDF-SHA256(IKM=api_key, salt="sulcus-sync-v1", info=platform)
    let hk = Hkdf::<Sha256>::new(Some(b"sulcus-sync-v1"), raw_key.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(platform.as_bytes(), &mut okm).map_err(|_| {
        tracing::error!("HKDF expand failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Random 12-byte nonce — fresh per request
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

    // Encrypt with AES-256-GCM
    let key = Key::<Aes256Gcm>::from_slice(&okm);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).map_err(|_| {
        tracing::error!("AES-GCM encryption failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Log delivery (fire-and-forget; errors don't fail the response)
    let _ = sqlx::query(
        "INSERT INTO extension_downloads (key_id, platform, version) VALUES ($1, $2, $3)",
    )
    .bind(key_id)
    .bind(platform)
    .bind(&ext_version)
    .execute(&state.pool)
    .await;

    tracing::info!(
        tenant = %tenant.id,
        platform = %platform,
        version = %ext_version,
        "extension download served"
    );

    Ok(Json(ExtensionResponse {
        version: ext_version,
        platform: platform.clone(),
        nonce: hex::encode(nonce_bytes),
        encrypted_blob: general_purpose::STANDARD.encode(&ciphertext),
        sha256_plaintext,
    }))
}

/// Load extension binary from local filesystem or remote storage.
///
/// Checks in order:
/// 1. Local path `/opt/sulcus/extensions/{version}/{platform}/{filename}`
/// 2. In-memory cache (for previously fetched remote binaries)
/// 3. Remote URL `EXTENSION_STORAGE_URL/{version}/{platform}/{filename}`
async fn load_extension_binary(
    version: &str,
    platform: &str,
    filename: &str,
) -> anyhow::Result<Vec<u8>> {
    // 1. Try local filesystem
    let local_path = format!("/opt/sulcus/extensions/{}/{}/{}", version, platform, filename);
    if let Ok(data) = std::fs::read(&local_path) {
        tracing::debug!(path = %local_path, "loaded extension from local filesystem");
        return Ok(data);
    }

    let cache_key = format!("{}/{}", version, platform);

    // 2. Check in-memory cache
    {
        let cache = extension_cache().read().await;
        if let Some(data) = cache.get(&cache_key) {
            tracing::debug!(cache_key = %cache_key, "loaded extension from memory cache");
            return Ok(data.clone());
        }
    }

    // 3. Fetch from remote storage URL
    let base_url = std::env::var("EXTENSION_STORAGE_URL").map_err(|_| {
        anyhow::anyhow!(
            "extension not found locally and EXTENSION_STORAGE_URL not configured"
        )
    })?;

    let url = format!(
        "{}/{}/{}/{}",
        base_url.trim_end_matches('/'),
        version,
        platform,
        filename
    );

    tracing::info!(url = %url, "fetching extension from remote storage");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!(
            "remote extension fetch failed: {} for {}",
            resp.status(),
            url
        );
    }

    let data = resp.bytes().await?.to_vec();

    if data.is_empty() {
        anyhow::bail!("remote extension fetch returned empty body");
    }

    tracing::info!(
        url = %url,
        size_bytes = data.len(),
        "extension fetched and cached from remote storage"
    );

    // Store in cache for subsequent requests
    {
        let mut cache = extension_cache().write().await;
        cache.insert(cache_key, data.clone());
    }

    Ok(data)
}
