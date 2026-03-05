use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use sha2::{Digest, Sha256};
use crate::SharedState;

#[derive(Clone, Debug)]
pub struct TenantContext {
    pub id: String,
    pub plan_tier: String,
    pub ops_limit: Option<i64>,
}

/// Middleware that requires `Authorization: Bearer <api-key>` header.
///
/// Validation strategy:
/// 1. Hash the provided token using SHA256.
/// 2. Lookup the hash in the `api_keys` table.
/// 3. If found, the `TenantContext` from that row is used for multi-tenancy.
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
    // Optimization: If SULCUS_ALLOW_ANY_KEY is set (only allowed in dev/debug builds), we bypass lookup and use hash as tenant_id
    #[allow(unused_variables)]
    let mut dev_bypass = false;
    #[cfg(debug_assertions)]
    {
        if std::env::var("SULCUS_ALLOW_ANY_KEY").is_ok() {
            dev_bypass = true;
        }
    }

    let tenant_ctx: TenantContext = if dev_bypass {
        TenantContext {
            id: hash_hex,
            plan_tier: "enterprise".to_string(),
            ops_limit: None,
        }
    } else {
        let row = sqlx::query("SELECT tenant_id, plan_tier, ops_limit FROM api_keys WHERE key_hash = $1")
            .bind(&hash_hex)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "DB error during auth");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

        match row {
            Some(r) => TenantContext {
                id: sqlx::Row::get(&r, "tenant_id"),
                plan_tier: sqlx::Row::get(&r, "plan_tier"),
                ops_limit: sqlx::Row::get(&r, "ops_limit"),
            },
            None => {
                // FALLBACK: Try OIDC JIT provisioning
                match crate::auth::verify_and_provision_jit(&state.pool, token).await {
                    Ok(Some(id)) => TenantContext {
                        id: id.tenant_id,
                        plan_tier: "enterprise".to_string(),
                        ops_limit: None,
                    },
                    Ok(None) => return Err(StatusCode::UNAUTHORIZED),
                    Err(e) => {
                        tracing::error!(error = %e, "OIDC verification failure");
                        return Err(StatusCode::UNAUTHORIZED);
                    }
                }
            }
        }
    };

    // insert tenant context into request extensions for downstream handlers
    req.extensions_mut().insert(tenant_ctx);

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

    #[allow(unused_variables)]
    let mut dev_bypass = false;
    #[cfg(debug_assertions)]
    {
        if std::env::var("SULCUS_ALLOW_ANY_KEY").is_ok() {
            dev_bypass = true;
        }
    }

    let tenant_ctx: TenantContext =
        if dev_bypass {
            // Dev bypass: grant team tier so MCP routes are reachable locally.
            TenantContext {
                id: hash_hex,
                plan_tier: "team".to_string(),
                ops_limit: None,
            }
        } else {
            let row =
                sqlx::query("SELECT tenant_id, plan_tier, ops_limit FROM api_keys WHERE key_hash = $1")
                    .bind(&hash_hex)
                    .fetch_optional(&state.pool)
                    .await
                    .map_err(|e| {
                        tracing::error!(error = %e, "DB error during tier auth");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

            match row {
                Some(r) => TenantContext {
                    id: sqlx::Row::get(&r, "tenant_id"),
                    plan_tier: sqlx::Row::get(&r, "plan_tier"),
                    ops_limit: sqlx::Row::get(&r, "ops_limit"),
                },
                None => {
                    // OIDC JIT-provisioned tenants are always 'enterprise'.
                    match crate::auth::verify_and_provision_jit(&state.pool, token).await {
                        Ok(Some(id)) => TenantContext {
                            id: id.tenant_id,
                            plan_tier: "enterprise".to_string(),
                            ops_limit: None,
                        },
                        Ok(None) => return Err(StatusCode::UNAUTHORIZED),
                        Err(e) => {
                            tracing::error!(error = %e, "OIDC verification failure");
                            return Err(StatusCode::UNAUTHORIZED);
                        }
                    }
                }
            }
        };

    if !matches!(tenant_ctx.plan_tier.as_str(), "team" | "enterprise") {
        return Err(StatusCode::FORBIDDEN);
    }

    req.extensions_mut().insert(tenant_ctx);
    Ok(next.run(req).await)
}
