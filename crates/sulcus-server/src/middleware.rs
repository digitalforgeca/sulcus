use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use sha2::{Digest, Sha256};
use crate::SharedState;

/// Middleware that requires `Authorization: Bearer <api-key>` header.
///
/// Validation strategy:
/// 1. Hash the provided token using SHA256.
/// 2. Lookup the hash in the `api_keys` table.
/// 3. If found, the `tenant_id` from that row is used for multi-tenancy.
pub async fn require_agent_api_key(
    State(state): State<SharedState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    
    if !header.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token = header.trim_start_matches("Bearer ").trim();

    if token.is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // compute sha256 hex of token
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let hash = hasher.finalize();
    let hash_hex = hex::encode(hash);

    // Verify against DB
    // Optimization: If SULCUS_ALLOW_ANY_KEY is set, we bypass lookup and use hash as tenant_id (local dev)
    let tenant_id: String = if std::env::var("SULCUS_ALLOW_ANY_KEY").is_ok() {
        hash_hex
    } else {
        let row = sqlx::query("SELECT tenant_id FROM api_keys WHERE key_hash = $1")
            .bind(&hash_hex)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "DB error during auth");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

        match row {
            Some(r) => sqlx::Row::get(&r, "tenant_id"),
            None => {
                // FALLBACK: Try OIDC JIT provisioning
                match crate::auth::verify_and_provision_jit(&state.pool, token).await {
                    Ok(Some(id)) => id.tenant_id,
                    Ok(None) => return Err(StatusCode::UNAUTHORIZED),
                    Err(e) => {
                        tracing::error!(error = %e, "OIDC verification failure");
                        return Err(StatusCode::UNAUTHORIZED);
                    }
                }
            }
        }
    };

    // insert tenant_id into request extensions for downstream handlers
    req.extensions_mut().insert(tenant_id);

    Ok(next.run(req).await)
}

/// Middleware that requires a valid API key **and** a 'team' or 'enterprise' plan tier.
///
/// Wraps the same auth logic as `require_agent_api_key` but also enforces that
/// the tenant's `plan_tier` qualifies, returning `403 Forbidden` otherwise.
pub async fn require_team_tier(
    State(state): State<SharedState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !header.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token = header.trim_start_matches("Bearer ").trim();

    if token.is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let hash_hex = hex::encode(hasher.finalize());

    let (tenant_id, plan_tier): (String, String) =
        if std::env::var("SULCUS_ALLOW_ANY_KEY").is_ok() {
            // Dev bypass: grant team tier so MCP routes are reachable locally.
            (hash_hex, "team".to_string())
        } else {
            let row =
                sqlx::query("SELECT tenant_id, plan_tier FROM api_keys WHERE key_hash = $1")
                    .bind(&hash_hex)
                    .fetch_optional(&state.pool)
                    .await
                    .map_err(|e| {
                        tracing::error!(error = %e, "DB error during tier auth");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

            match row {
                Some(r) => (
                    sqlx::Row::get(&r, "tenant_id"),
                    sqlx::Row::get(&r, "plan_tier"),
                ),
                None => {
                    // OIDC JIT-provisioned tenants are always 'enterprise'.
                    match crate::auth::verify_and_provision_jit(&state.pool, token).await {
                        Ok(Some(id)) => (id.tenant_id, "enterprise".to_string()),
                        Ok(None) => return Err(StatusCode::UNAUTHORIZED),
                        Err(e) => {
                            tracing::error!(error = %e, "OIDC verification failure");
                            return Err(StatusCode::UNAUTHORIZED);
                        }
                    }
                }
            }
        };

    if !matches!(plan_tier.as_str(), "team" | "enterprise") {
        return Err(StatusCode::FORBIDDEN);
    }

    req.extensions_mut().insert(tenant_id);
    Ok(next.run(req).await)
}
