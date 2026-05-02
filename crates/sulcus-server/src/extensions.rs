//! Extension delivery endpoint — serves encrypted dylibs to authenticated users.
//!
//! GET /api/v1/extensions/{component}?platform=<platform>
//!
//! Supported components:
//! - `sync`  — cloud sync (paywalled: requires paid plan)
//! - `siu`   — SIU classifier (free: available to all tiers)
//! - `embed` — embedding engine (free)
//! - `store` — storage engine (free)
//!
//! The binary is loaded from one of two sources (checked in order):
//! 1. Local filesystem: `/opt/sulcus/extensions/{component}/{version}/{platform}/libsulcus_{component}.{ext}`
//! 2. Remote storage:   `EXTENSION_STORAGE_URL/{component}/{version}/{platform}/libsulcus_{component}.{ext}`
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
    response::IntoResponse,
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

/// Simple per-tenant rate limiter for extension downloads.
/// 10 downloads per tenant per hour (sliding window).
static RATE_LIMITER: std::sync::OnceLock<Arc<RwLock<HashMap<String, Vec<std::time::Instant>>>>> =
    std::sync::OnceLock::new();

fn rate_limiter() -> &'static Arc<RwLock<HashMap<String, Vec<std::time::Instant>>>> {
    RATE_LIMITER.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

const RATE_LIMIT_WINDOW: std::time::Duration = std::time::Duration::from_secs(3600); // 1 hour
const RATE_LIMIT_MAX: usize = 10; // max downloads per window

async fn check_rate_limit(tenant_id: &str) -> bool {
    let limiter = rate_limiter();
    let now = std::time::Instant::now();
    let mut map = limiter.write().await;
    let timestamps = map.entry(tenant_id.to_string()).or_insert_with(Vec::new);

    // Purge expired entries
    timestamps.retain(|&t| now.duration_since(t) < RATE_LIMIT_WINDOW);

    if timestamps.len() >= RATE_LIMIT_MAX {
        false
    } else {
        timestamps.push(now);
        true
    }
}

const SUPPORTED_PLATFORMS: &[&str] = &[
    "darwin-arm64",
    "darwin-x86_64",
    "linux-x86_64",
    "linux-aarch64",
];

/// Known extension components and their access policy.
struct ComponentInfo {
    /// Library name (e.g. "sulcus_sync" → libsulcus_sync.dylib)
    lib_name: &'static str,
    /// HKDF salt for per-component encryption key derivation
    hkdf_salt: &'static [u8],
    /// Whether this component requires a paid plan
    requires_paid: bool,
}

fn component_info(component: &str) -> Option<ComponentInfo> {
    match component {
        "sync" => Some(ComponentInfo {
            lib_name: "sulcus_sync",
            hkdf_salt: b"sulcus-sync-v1",
            requires_paid: true,
        }),
        "siu" => Some(ComponentInfo {
            lib_name: "sulcus_siu",
            hkdf_salt: b"sulcus-siu-v1",
            requires_paid: false, // Free for all tiers
        }),
        "embed" => Some(ComponentInfo {
            lib_name: "sulcus_vectors",
            hkdf_salt: b"sulcus-vectors-v1",
            requires_paid: false,
        }),
        "store" => Some(ComponentInfo {
            lib_name: "sulcus_store",
            hkdf_salt: b"sulcus-store-v1",
            requires_paid: false,
        }),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
pub struct ExtensionQuery {
    pub platform: String,
}

#[derive(Debug, Deserialize)]
pub struct ExtensionPathParams {
    pub component: String,
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

/// GET /api/v1/extensions/sync (legacy — redirects to generalized handler)
pub async fn get_extension(
    state: State<SharedState>,
    tenant: Extension<TenantContext>,
    headers: HeaderMap,
    query: Query<ExtensionQuery>,
) -> Result<Json<ExtensionResponse>, StatusCode> {
    get_extension_by_component(
        state,
        tenant,
        headers,
        axum::extract::Path("sync".to_string()),
        query,
    )
    .await
}

/// GET /api/v1/extensions/{component}?platform=<platform>
///
/// Returns an encrypted dylib for the requested component and platform.
/// Requires `Authorization: Bearer <api-key>`.
/// Some components (sync) require a paid plan; others (siu, embed, store) are free.
pub async fn get_extension_by_component(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    headers: HeaderMap,
    axum::extract::Path(component): axum::extract::Path<String>,
    Query(params): Query<ExtensionQuery>,
) -> Result<Json<ExtensionResponse>, StatusCode> {
    // Rate limit: 10 downloads per tenant per hour
    if !check_rate_limit(&tenant.id).await {
        tracing::warn!(tenant = %tenant.id, "extension download rate limit exceeded");
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    // Look up component info
    let info = component_info(&component).ok_or(StatusCode::NOT_FOUND)?;

    // Check plan requirements
    if info.requires_paid && matches!(tenant.plan_tier.as_str(), "free" | "open") {
        return Err(StatusCode::PAYMENT_REQUIRED);
    }

    let platform = &params.platform;
    if !SUPPORTED_PLATFORMS.contains(&platform.as_str()) {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Extract raw API key from Authorization header
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
    let lib_filename = format!("lib{}.{}", info.lib_name, file_ext);

    // Try loading the binary: local filesystem first, then remote storage
    let plaintext = load_extension_binary(&component, &ext_version, platform, &lib_filename)
        .await
        .map_err(|e| {
            tracing::error!(
                component = %component,
                platform = %platform,
                version = %ext_version,
                error = %e,
                "extension binary not available"
            );
            StatusCode::NOT_FOUND
        })?;

    // SHA-256 of plaintext for integrity check
    let mut sha_hasher = Sha256::new();
    sha_hasher.update(&plaintext);
    let sha256_plaintext = hex::encode(sha_hasher.finalize());

    // Derive 32-byte AES key: HKDF-SHA256(IKM=api_key, salt=component_salt, info=platform)
    let hk = Hkdf::<Sha256>::new(Some(info.hkdf_salt), raw_key.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(platform.as_bytes(), &mut okm).map_err(|_| {
        tracing::error!("HKDF expand failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Random 12-byte nonce
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

    // Log delivery
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
        component = %component,
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
/// 1. Local path `/opt/sulcus/extensions/{component}/{version}/{platform}/{filename}`
/// 2. In-memory cache (for previously fetched remote binaries)
/// 3. Remote URL `EXTENSION_STORAGE_URL/{component}/{version}/{platform}/{filename}`
async fn load_extension_binary(
    component: &str,
    version: &str,
    platform: &str,
    filename: &str,
) -> anyhow::Result<Vec<u8>> {
    // 1. Try local filesystem (new layout with component prefix)
    let local_path = format!("/opt/sulcus/extensions/{}/{}/{}/{}", component, version, platform, filename);
    // Also check legacy flat layout for backward compat
    let legacy_path = format!("/opt/sulcus/extensions/{}/{}/{}", version, platform, filename);
    if let Ok(data) = std::fs::read(&local_path) {
        tracing::debug!(path = %local_path, "loaded extension from local filesystem");
        return Ok(data);
    }
    // Legacy flat path (for existing sync deployments)
    if let Ok(data) = std::fs::read(&legacy_path) {
        tracing::debug!(path = %legacy_path, "loaded extension from legacy filesystem path");
        return Ok(data);
    }

    let cache_key = format!("{}/{}/{}", component, version, platform);

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

    // Path traversal protection
    for part in [component, version, platform, filename] {
        if part.contains("..") || part.contains('/') || part.contains('\\') {
            anyhow::bail!("invalid path component in extension request");
        }
    }

    let url = format!(
        "{}/{}/{}/{}/{}",
        base_url.trim_end_matches('/'),
        component,
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

/// GET /api/v1/extensions/siu/model
/// Serves the SIU JSON model file for client-side classification.
/// No encryption — it's a model file, not a dylib. Rate limited like other extensions.
pub async fn get_siu_model(
    Extension(tenant): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    // Rate limit
    if !check_rate_limit(&tenant.id).await {
        return (axum::http::StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded").into_response();
    }

    let model_dir = std::env::var("SIU_MODEL_DIR").unwrap_or_else(|_| "/opt/sulcus/model".to_string());
    let model_path = format!("{}/memory_classifier_multilabel.json", model_dir);

    match tokio::fs::read(&model_path).await {
        Ok(data) => {
            (
                [(axum::http::header::CONTENT_TYPE, "application/json"),
                 (axum::http::header::CACHE_CONTROL, "public, max-age=86400, immutable")],
                data,
            ).into_response()
        }
        Err(_) => {
            (axum::http::StatusCode::NOT_FOUND, "SIU model not available").into_response()
        }
    }
}
