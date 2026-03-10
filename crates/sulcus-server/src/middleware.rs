use crate::SharedState;
use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug)]
pub struct TenantContext {
    pub id: String,
    pub plan_tier: String,
    pub ops_limit: Option<i64>,
    pub roles: Vec<String>,
}

impl TenantContext {
    pub fn has_role(&self, role: &str) -> bool {
        self.roles.contains(&role.to_string())
    }
}

/// Helper to authenticate a bearer token.
async fn authenticate(state: &SharedState, token: &str) -> Result<TenantContext, StatusCode> {
    let dev_bypass = std::env::var("SULCUS_ALLOW_ANY_KEY").is_ok();

    // compute sha256 hex of token for static API keys
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let hash = hasher.finalize();
    let hash_hex = hex::encode(hash);

    if dev_bypass {
        return Ok(TenantContext {
            id: hash_hex,
            plan_tier: "enterprise".to_string(),
            ops_limit: None,
            roles: vec!["sulcus-enterprise".to_string()],
        });
    }

    // Try OIDC JIT provisioning first if it looks like a JWT
    if token.starts_with("eyJ") {
        match crate::auth::verify_and_provision_jit(&state.pool, token).await {
            Ok(Some(id)) => {
                return Ok(TenantContext {
                    id: id.tenant_id,
                    plan_tier: id.plan_tier,
                    ops_limit: None,
                    roles: id.roles,
                });
            }
            Ok(None) => {
                tracing::debug!(
                    "OIDC verification returned None, falling back to static API key check."
                );
            }
            Err(e) => {
                tracing::error!(error = %e, "OIDC verification error");
                // Don't fail immediately, might be a static key that coincidentally starts with eyJ
            }
        }
    }

    // Verify against DB (Static API Keys)
    let row =
        sqlx::query("SELECT tenant_id, plan_tier, ops_limit FROM api_keys WHERE key_hash = $1")
            .bind(&hash_hex)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "DB error during auth");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

    match row {
        Some(r) => Ok(TenantContext {
            id: sqlx::Row::get(&r, "tenant_id"),
            plan_tier: sqlx::Row::get(&r, "plan_tier"),
            ops_limit: sqlx::Row::get(&r, "ops_limit"),
            roles: vec![], // Static API keys don't inherently have Keycloak roles
        }),
        None => Err(StatusCode::UNAUTHORIZED),
    }
}

/// Middleware that requires `Authorization: Bearer <api-key>` header.
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

    let tenant_ctx = authenticate(&state, token).await?;

    // insert tenant context into request extensions for downstream handlers
    req.extensions_mut().insert(tenant_ctx);

    Ok(next.run(req).await)
}

/// Middleware that requires a valid API key **and** a 'team' or 'enterprise' plan tier.
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

    let tenant_ctx = authenticate(&state, token).await?;

    if !matches!(tenant_ctx.plan_tier.as_str(), "team" | "enterprise") {
        return Err(StatusCode::FORBIDDEN);
    }

    req.extensions_mut().insert(tenant_ctx);
    Ok(next.run(req).await)
}
