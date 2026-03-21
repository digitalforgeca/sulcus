//! Extension delivery endpoint — serves encrypted sulcus-sync dylibs to paid subscribers.
//!
//! GET /api/v1/extensions/sync?platform=<platform>
//!
//! The binary is read from `/opt/sulcus/extensions/{version}/{platform}/libsulcus_sync.{ext}`,
//! encrypted on-the-fly with AES-256-GCM (fresh nonce per request), and returned as JSON.
//! The encryption key is derived from the subscriber's raw API key via HKDF-SHA256 so that
//! only the key holder can decrypt the blob.

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

use crate::{middleware::TenantContext, SharedState};

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

    // Resolve the dylib path
    let ext_version =
        std::env::var("SULCUS_EXTENSION_VERSION").unwrap_or_else(|_| "latest".to_string());
    let file_ext = if platform.starts_with("darwin") {
        "dylib"
    } else {
        "so"
    };
    let dylib_path = format!(
        "/opt/sulcus/extensions/{}/{}/libsulcus_sync.{}",
        ext_version, platform, file_ext
    );

    // Read plaintext binary
    let plaintext = std::fs::read(&dylib_path).map_err(|e| {
        tracing::error!(path = %dylib_path, error = %e, "extension binary not found");
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
