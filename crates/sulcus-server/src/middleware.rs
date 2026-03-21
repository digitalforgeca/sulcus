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
    /// DB-stored entitlements (from Stripe product metadata via webhook).
    /// NULL = unlimited (no cap enforced).
    pub max_agents: Option<i64>,
    pub max_nodes: Option<i64>,
    pub max_sync_requests: Option<i64>,
    pub features: String,
    pub roles: Vec<String>,
}

impl TenantContext {
    /// Returns the effective ops limit for this tenant.
    /// Prefers DB-stored `max_sync_requests` (from Stripe), then `ops_limit`,
    /// then tier-based defaults. NULL/None = use tier default.
    pub fn effective_ops_limit(&self) -> i64 {
        // -1 in DB means unlimited (set via Stripe "unlimited" metadata)
        if let Some(msr) = self.max_sync_requests {
            if msr <= 0 {
                return i64::MAX;
            }
            return msr;
        }
        self.ops_limit.unwrap_or(match self.plan_tier.as_str() {
            "cortex" => 100_000,
            "enterprise" => 1_000_000,
            _ => 10_000, // free tier
        })
    }

    /// Returns the effective total node storage limit for this tenant.
    /// 0 = unlimited (enterprise or explicit Stripe metadata).
    /// Prefers DB-stored `max_nodes` when available.
    pub fn effective_node_limit(&self) -> i64 {
        if let Some(mn) = self.max_nodes {
            if mn <= 0 {
                return 0;
            } // 0 = unlimited
            return mn;
        }
        match self.plan_tier.as_str() {
            "free" => 1_000,
            "cortex" | "team" => 50_000,
            "enterprise" => 0, // unlimited
            _ => 1_000,
        }
    }

    /// Returns the effective agent limit. 0 = unlimited.
    pub fn effective_agent_limit(&self) -> i64 {
        if let Some(ma) = self.max_agents {
            if ma <= 0 {
                return 0;
            }
            return ma;
        }
        match self.plan_tier.as_str() {
            "free" => 1,
            "cortex" | "team" => 5,
            "enterprise" => 0,
            _ => 1,
        }
    }
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
            max_agents: None,
            max_nodes: None,
            max_sync_requests: None,
            features: "remote_mcp,team_dashboard,priority_support,sso_saml,custom_retention,dedicated_support".to_string(),
            roles: vec!["sulcus-enterprise".to_string()],
        });
    }

    // Try OIDC JIT provisioning first if it looks like a JWT
    if token.starts_with("eyJ") {
        tracing::info!("Bearer token looks like JWT, attempting OIDC verification");
        match crate::auth::verify_and_provision_jit(&state.pool, token).await {
            Ok(Some(id)) => {
                tracing::info!(tenant = %id.tenant_id, tier = %id.plan_tier, "OIDC auth succeeded");
                return Ok(TenantContext {
                    id: id.tenant_id,
                    plan_tier: id.plan_tier,
                    ops_limit: None,
                    max_agents: None,
                    max_nodes: None,
                    max_sync_requests: None,
                    features: String::new(),
                    roles: id.roles,
                });
            }
            Ok(None) => {
                tracing::warn!(
                    "OIDC verification returned None, falling back to static API key check"
                );
            }
            Err(e) => {
                tracing::error!(error = %e, "OIDC verification error");
            }
        }
    }

    // Verify against DB (Static API Keys)
    let row =
        sqlx::query("SELECT tenant_id, plan_tier, ops_limit, max_agents, max_nodes, max_sync_requests, COALESCE(features, '') as features FROM api_keys WHERE key_hash = $1")
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
            max_agents: sqlx::Row::get(&r, "max_agents"),
            max_nodes: sqlx::Row::get(&r, "max_nodes"),
            max_sync_requests: sqlx::Row::get(&r, "max_sync_requests"),
            features: sqlx::Row::get(&r, "features"),
            roles: vec![],
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

/// Middleware that requires a valid API key **and** a paid plan tier (`cortex` or `enterprise`).
/// The legacy `team` value is also accepted for rows not yet migrated by 0017.
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

    if !matches!(
        tenant_ctx.plan_tier.as_str(),
        "cortex" | "team" | "enterprise"
    ) {
        return Err(StatusCode::FORBIDDEN);
    }

    req.extensions_mut().insert(tenant_ctx);
    Ok(next.run(req).await)
}
