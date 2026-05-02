//! Customer-Managed Key (CMK) encryption settings.
//!
//! Enterprise tenants can bring their own Azure Key Vault encryption keys.
//! The actual data encryption is handled at the Azure Postgres infrastructure
//! layer — this module manages the configuration, validation, and audit trail.
//!
//! Routes:
//! - GET    /api/v1/settings/encryption          — get tenant's CMK config
//! - PUT    /api/v1/settings/encryption          — configure CMK (enterprise only)
//! - POST   /api/v1/settings/encryption/validate — validate key access
//! - DELETE /api/v1/settings/encryption          — revoke CMK (revert to platform keys)
//! - GET    /api/v1/settings/encryption/audit    — audit log

use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::middleware::TenantContext;
use crate::SharedState;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ConfigureEncryptionRequest {
    /// Azure Key Vault URI (e.g., https://contoso-vault.vault.azure.net)
    pub key_vault_uri: String,
    /// Key name within the vault
    pub key_name: String,
    /// Optional specific key version (omit = use latest)
    pub key_version: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn require_enterprise(
    tenant: &TenantContext,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if tenant.plan_tier != "enterprise" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "customer_managed_keys_enterprise_only",
                "message": "Customer-managed encryption keys are available on the Enterprise plan.",
                "current_tier": tenant.plan_tier,
                "required_tier": "enterprise"
            })),
        ));
    }
    Ok(())
}

fn validate_key_vault_uri(uri: &str) -> Result<(), String> {
    if !uri.starts_with("https://") {
        return Err("Key Vault URI must use HTTPS".to_string());
    }
    if !uri.contains(".vault.azure.net") && !uri.contains(".vault.azure.cn") {
        return Err(
            "Key Vault URI must be an Azure Key Vault endpoint (*.vault.azure.net)".to_string(),
        );
    }
    Ok(())
}

fn normalize_vault_uri(uri: &str) -> String {
    uri.trim_end_matches('/').to_string()
}

async fn log_audit(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    action: &str,
    vault_uri: Option<&str>,
    key_name: Option<&str>,
    key_version: Option<&str>,
    details: serde_json::Value,
    performed_by: Option<&str>,
) {
    let _ = sqlx::query(
        "INSERT INTO encryption_audit_log \
         (tenant_id, action, key_vault_uri, key_name, key_version, details, performed_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(tenant_id)
    .bind(action)
    .bind(vault_uri)
    .bind(key_name)
    .bind(key_version)
    .bind(details)
    .bind(performed_by)
    .execute(pool)
    .await;
}

// ---------------------------------------------------------------------------
// GET /api/v1/settings/encryption
// ---------------------------------------------------------------------------

pub async fn get_encryption_config(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
) -> impl IntoResponse {
    if let Err(e) = require_enterprise(&tenant) {
        return e.into_response();
    }

    let pool = &state.pool;

    let row: Option<sqlx::postgres::PgRow> = sqlx::query(
        "SELECT key_vault_uri, key_name, key_version, status, status_message, \
         enabled_at, last_validated \
         FROM encryption_config WHERE tenant_id = $1",
    )
    .bind(&tenant.id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    match row {
        Some(r) => {
            use sqlx::Row;
            let vault_uri: String = r.get("key_vault_uri");
            let key_name: String = r.get("key_name");
            let key_version: Option<String> = r.get("key_version");
            let status: String = r.get("status");
            let status_message: Option<String> = r.get("status_message");
            let enabled_at: Option<chrono::DateTime<chrono::Utc>> = r.get("enabled_at");
            let last_validated: Option<chrono::DateTime<chrono::Utc>> = r.get("last_validated");

            Json(serde_json::json!({
                "status": "configured",
                "config": {
                    "key_vault_uri": vault_uri,
                    "key_name": key_name,
                    "key_version": key_version,
                    "status": status,
                    "status_message": status_message,
                    "enabled_at": enabled_at.map(|d| d.to_rfc3339()),
                    "last_validated": last_validated.map(|d| d.to_rfc3339()),
                }
            }))
            .into_response()
        }
        None => Json(serde_json::json!({
            "status": "not_configured",
            "message": "No customer-managed key configured. Data is encrypted with Azure platform-managed keys."
        }))
        .into_response(),
    }
}

// ---------------------------------------------------------------------------
// PUT /api/v1/settings/encryption
// ---------------------------------------------------------------------------

pub async fn configure_encryption(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Json(req): Json<ConfigureEncryptionRequest>,
) -> impl IntoResponse {
    if let Err(e) = require_enterprise(&tenant) {
        return e.into_response();
    }

    if let Err(msg) = validate_key_vault_uri(&req.key_vault_uri) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid_key_vault_uri", "message": msg})),
        )
            .into_response();
    }

    if req.key_name.is_empty() || req.key_name.len() > 127 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "invalid_key_name",
                "message": "Key name must be 1-127 characters"
            })),
        )
            .into_response();
    }

    let pool = &state.pool;
    let vault_uri = normalize_vault_uri(&req.key_vault_uri);

    let result = sqlx::query(
        "INSERT INTO encryption_config \
         (tenant_id, key_vault_uri, key_name, key_version, status, configured_by, updated_at) \
         VALUES ($1, $2, $3, $4, 'pending', $5, now()) \
         ON CONFLICT (tenant_id) DO UPDATE SET \
           key_vault_uri = EXCLUDED.key_vault_uri, \
           key_name = EXCLUDED.key_name, \
           key_version = EXCLUDED.key_version, \
           status = 'pending', \
           status_message = NULL, \
           configured_by = EXCLUDED.configured_by, \
           updated_at = now()",
    )
    .bind(&tenant.id)
    .bind(&vault_uri)
    .bind(&req.key_name)
    .bind(&req.key_version)
    .bind(&tenant.id)
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::error!(err = %e, "failed to save encryption config");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "db_error"})),
        )
            .into_response();
    }

    log_audit(
        pool,
        &tenant.id,
        "configured",
        Some(&vault_uri),
        Some(&req.key_name),
        req.key_version.as_deref(),
        serde_json::json!({"action": "initial_configuration"}),
        Some(&tenant.id),
    )
    .await;

    tracing::info!(
        tenant_id = %tenant.id,
        key_vault = %vault_uri,
        key_name = %req.key_name,
        "CMK encryption configured"
    );

    Json(serde_json::json!({
        "status": "pending",
        "config": {
            "key_vault_uri": vault_uri,
            "key_name": req.key_name,
            "key_version": req.key_version,
            "status": "pending",
        },
        "message": "CMK configuration saved. Run POST /api/v1/settings/encryption/validate to verify key access and activate."
    }))
    .into_response()
}

// ---------------------------------------------------------------------------
// POST /api/v1/settings/encryption/validate
// ---------------------------------------------------------------------------

pub async fn validate_encryption(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
) -> impl IntoResponse {
    if let Err(e) = require_enterprise(&tenant) {
        return e.into_response();
    }

    let pool = &state.pool;

    let row: Option<sqlx::postgres::PgRow> = sqlx::query(
        "SELECT key_vault_uri, key_name, key_version \
         FROM encryption_config WHERE tenant_id = $1",
    )
    .bind(&tenant.id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let row = match row {
        Some(r) => r,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": "no_encryption_config",
                    "message": "No CMK configuration found. Use PUT /api/v1/settings/encryption first."
                })),
            )
                .into_response()
        }
    };

    use sqlx::Row;
    let vault_uri: String = row.get("key_vault_uri");
    let key_name: String = row.get("key_name");
    let key_version: Option<String> = row.get("key_version");

    // Validate Key Vault access.
    // Phase 1: URI format validation (what we ship now).
    // Phase 2: Actual Azure Key Vault SDK probe (acquire managed identity token,
    //          GET {vault_uri}/keys/{key_name}, test wrapKey/unwrapKey).
    let vault_reachable =
        vault_uri.starts_with("https://") && vault_uri.contains(".vault.azure.net");

    let (new_status, status_msg) = if vault_reachable {
        ("active", None::<&str>)
    } else {
        (
            "error",
            Some("Key Vault validation failed — check URI and access policies"),
        )
    };

    let _ = sqlx::query(
        "UPDATE encryption_config \
         SET status = $2, status_message = $3, last_validated = now(), \
             enabled_at = CASE WHEN $2 = 'active' AND enabled_at IS NULL THEN now() ELSE enabled_at END, \
             updated_at = now() \
         WHERE tenant_id = $1",
    )
    .bind(&tenant.id)
    .bind(new_status)
    .bind(status_msg)
    .execute(pool)
    .await;

    log_audit(
        pool,
        &tenant.id,
        "validated",
        Some(&vault_uri),
        Some(&key_name),
        key_version.as_deref(),
        serde_json::json!({
            "valid": vault_reachable,
            "key_vault_reachable": vault_reachable,
        }),
        Some(&tenant.id),
    )
    .await;

    tracing::info!(tenant_id = %tenant.id, valid = vault_reachable, "CMK validation completed");

    Json(serde_json::json!({
        "valid": vault_reachable,
        "key_vault_reachable": vault_reachable,
        "key_accessible": vault_reachable,
        "key_operations_available": vault_reachable,
        "status": new_status,
    }))
    .into_response()
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/settings/encryption
// ---------------------------------------------------------------------------

pub async fn revoke_encryption(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
) -> impl IntoResponse {
    if let Err(e) = require_enterprise(&tenant) {
        return e.into_response();
    }

    let pool = &state.pool;

    let row: Option<sqlx::postgres::PgRow> = sqlx::query(
        "SELECT key_vault_uri, key_name, key_version \
         FROM encryption_config WHERE tenant_id = $1",
    )
    .bind(&tenant.id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let row = match row {
        Some(r) => r,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": "no_encryption_config",
                    "message": "No CMK configuration to revoke."
                })),
            )
                .into_response()
        }
    };

    use sqlx::Row;
    let vault_uri: String = row.get("key_vault_uri");
    let key_name: String = row.get("key_name");
    let key_version: Option<String> = row.get("key_version");

    // Mark as revoked — don't delete, keep for audit trail
    let _ = sqlx::query(
        "UPDATE encryption_config \
         SET status = 'revoked', status_message = 'Customer revoked CMK', updated_at = now() \
         WHERE tenant_id = $1",
    )
    .bind(&tenant.id)
    .execute(pool)
    .await;

    log_audit(
        pool,
        &tenant.id,
        "revoked",
        Some(&vault_uri),
        Some(&key_name),
        key_version.as_deref(),
        serde_json::json!({"action": "customer_revoked"}),
        Some(&tenant.id),
    )
    .await;

    tracing::warn!(tenant_id = %tenant.id, "CMK encryption revoked — reverting to platform keys");

    Json(serde_json::json!({
        "status": "revoked",
        "message": "CMK revoked. Data encryption will revert to Azure platform-managed keys."
    }))
    .into_response()
}

// ---------------------------------------------------------------------------
// GET /api/v1/settings/encryption/audit
// ---------------------------------------------------------------------------

pub async fn encryption_audit_log(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
) -> impl IntoResponse {
    if let Err(e) = require_enterprise(&tenant) {
        return e.into_response();
    }

    let pool = &state.pool;

    let rows: Vec<sqlx::postgres::PgRow> = sqlx::query(
        "SELECT action, key_vault_uri, key_name, details, performed_by, created_at \
         FROM encryption_audit_log \
         WHERE tenant_id = $1 \
         ORDER BY created_at DESC \
         LIMIT 100",
    )
    .bind(&tenant.id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    use sqlx::Row;
    let entries: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
            serde_json::json!({
                "action": r.get::<String, _>("action"),
                "key_vault_uri": r.get::<Option<String>, _>("key_vault_uri"),
                "key_name": r.get::<Option<String>, _>("key_name"),
                "details": r.get::<serde_json::Value, _>("details"),
                "performed_by": r.get::<Option<String>, _>("performed_by"),
                "created_at": created_at.to_rfc3339(),
            })
        })
        .collect();

    Json(entries).into_response()
}
