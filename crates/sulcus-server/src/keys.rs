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
    pub namespace: Option<String>,
    pub prefix: String, // first 8 chars of raw key — enough to identify
    pub plan_tier: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Serialize)]
pub struct CreateKeyResponse {
    pub id: String,
    pub label: String,
    pub key: String, // raw key — shown ONCE, never again
    pub prefix: String,
}

#[derive(Deserialize)]
pub struct CreateKeyRequest {
    pub label: String, // e.g. "Daedalus MCP", "Icarus sidecar", "Claude Desktop"
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
        "SELECT key_hash, label, namespace, plan_tier, created_at, last_used_at
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
                namespace: r.get::<Option<String>, _>("namespace"),
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

    // Try to inherit plan_tier from an existing key for this tenant.
    // If the tenant has no existing keys (e.g. JIT-provisioned via OIDC with
    // no api_key row), fall back to a direct INSERT with "free" tier.
    let result = sqlx::query(
        "INSERT INTO api_keys (tenant_id, key_hash, label, plan_tier)
         SELECT $1, $2, $3, plan_tier
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

    // If INSERT...SELECT inserted 0 rows (no existing key to copy tier from),
    // do a direct INSERT with the tier from the auth context or default "free".
    if result.rows_affected() == 0 {
        let fallback_tier = if tenant.plan_tier.is_empty() { "free" } else { &tenant.plan_tier };
        tracing::warn!(
            tenant = %tenant.id,
            label = %req.label,
            fallback_tier = %fallback_tier,
            "No existing key to inherit plan_tier from — using fallback"
        );
        sqlx::query(
            "INSERT INTO api_keys (tenant_id, key_hash, label, plan_tier) VALUES ($1, $2, $3, $4)",
        )
        .bind(&tenant.id)
        .bind(&key_hash)
        .bind(&req.label)
        .bind(fallback_tier)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "DB error creating key (fallback)");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }

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
    let result = sqlx::query("DELETE FROM api_keys WHERE tenant_id = $1 AND key_hash = $2")
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

/// PATCH /api/v1/keys/:id — update label and/or namespace on an API key.
#[derive(Deserialize)]
pub struct PatchKey {
    pub label: Option<String>,
    pub namespace: Option<String>,
}

pub async fn update_key(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Path(id): Path<String>,
    Json(body): Json<PatchKey>,
) -> Result<StatusCode, StatusCode> {
    // Sanitize namespace if provided
    let body = PatchKey {
        namespace: body.namespace.map(|ns| crate::middleware::sanitize_namespace(&ns)),
        ..body
    };
    if body.namespace.as_ref().is_some_and(|ns| ns.len() > 64) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut updates = Vec::new();
    let mut params: Vec<String> = Vec::new();
    let mut idx = 3; // $1 = tenant_id, $2 = key_hash

    if let Some(ref label) = body.label {
        updates.push(format!("label = ${idx}"));
        params.push(label.clone());
        idx += 1;
    }
    if let Some(ref ns) = body.namespace {
        updates.push(format!("namespace = ${idx}"));
        params.push(ns.clone());
    }

    if updates.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let sql = format!(
        "UPDATE api_keys SET {} WHERE tenant_id = $1 AND key_hash = $2",
        updates.join(", ")
    );

    let mut query = sqlx::query(&sql).bind(&tenant.id).bind(&id);
    for p in &params {
        query = query.bind(p);
    }

    let result = query.execute(&state.pool).await.map_err(|e| {
        tracing::error!(error = %e, "DB error updating key");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    tracing::info!(tenant = %tenant.id, key_id = %id, label = ?body.label, namespace = ?body.namespace, "API key updated");
    Ok(StatusCode::NO_CONTENT)
}
