use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::{middleware::TenantContext, SharedState};

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ApiKeyInfo {
    pub id: String,
    pub label: String,
    pub prefix: String,   // first 8 chars of raw key — enough to identify
    pub plan_tier: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Serialize)]
pub struct CreateKeyResponse {
    pub id: String,
    pub label: String,
    pub key: String,  // raw key — shown ONCE, never again
    pub prefix: String,
}

#[derive(Deserialize)]
pub struct CreateKeyRequest {
    pub label: String,  // e.g. "Daedalus MCP", "Icarus sidecar", "Claude Desktop"
}

#[derive(Deserialize)]
pub struct RevokeKeyRequest {
    // path param :id is the key_hash (used as stable ID)
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// GET /api/v1/keys — list all API keys for this tenant
pub async fn list_keys(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
) -> Result<axum::Json<Vec<ApiKeyInfo>>, StatusCode> {
    let rows = sqlx::query(
        "SELECT key_hash, label, plan_tier, created_at, last_used_at
         FROM api_keys
         WHERE tenant_id = $1
         ORDER BY created_at DESC",
    )
    .bind(&tenant.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "DB error listing keys");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let keys: Vec<ApiKeyInfo> = rows
        .iter()
        .map(|r| {
            let hash: String = r.get("key_hash");
            let label: String = r.get::<Option<String>, _>("label").unwrap_or_default();
            let prefix = hash.chars().take(8).collect(); // hash prefix as identifier
            ApiKeyInfo {
                id: hash.clone(),
                label,
                prefix,
                plan_tier: r.get("plan_tier"),
                created_at: r
                    .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                    .to_rfc3339(),
                last_used_at: r
                    .get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_used_at")
                    .map(|t| t.to_rfc3339()),
            }
        })
        .collect();

    Ok(axum::Json(keys))
}

/// POST /api/v1/keys — generate a new API key for this tenant
pub async fn create_key(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Json(req): Json<CreateKeyRequest>,
) -> Result<axum::Json<CreateKeyResponse>, StatusCode> {
    // Generate a 32-byte random key, encoded as hex → 64 char string
    // Prefixed with "sk-" for easy identification
    let random_bytes: [u8; 32] = rand::thread_rng().gen();
    let raw_key = format!("sk-{}", hex::encode(random_bytes));
    let prefix = raw_key.chars().take(8).collect::<String>();

    // Hash for storage
    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    let key_hash = hex::encode(hasher.finalize());

    // Insert — inherits tenant's plan_tier
    sqlx::query(
        "INSERT INTO api_keys (tenant_id, key_hash, label, plan_tier, keycloak_user_id)
         SELECT tenant_id, $2, $3, plan_tier, keycloak_user_id
         FROM api_keys WHERE tenant_id = $1
         LIMIT 1",
    )
    .bind(&tenant.id)
    .bind(&key_hash)
    .bind(&req.label)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "DB error creating key");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tracing::info!(tenant = %tenant.id, label = %req.label, "API key created");

    Ok(axum::Json(CreateKeyResponse {
        id: key_hash.clone(),
        label: req.label,
        key: raw_key,
        prefix,
    }))
}

/// DELETE /api/v1/keys/:id — revoke an API key (id = key_hash)
pub async fn revoke_key(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let result = sqlx::query(
        "DELETE FROM api_keys WHERE tenant_id = $1 AND key_hash = $2",
    )
    .bind(&tenant.id)
    .bind(&id)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "DB error revoking key");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    tracing::info!(tenant = %tenant.id, key_id = %id, "API key revoked");
    Ok(StatusCode::NO_CONTENT)
}
