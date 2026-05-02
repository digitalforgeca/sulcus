//! Organization (org) management — thin proxy over Keycloak 26 Organizations API.
//!
//! All org/member/invite operations delegate to Keycloak. Our `org_members` and
//! `seats_used` tables are no longer the source of truth — KC is.
//! We still read plan limits (max_seats, features) from `api_keys` (Stripe-provisioned).

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::keycloak::get_admin_token;
use crate::SharedState;

// ── Types ────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct OrgInfo {
    pub tenant_id: String,
    pub org_name: Option<String>,
    pub plan_tier: String,
    pub max_seats: Option<i32>,
    pub seats_used: i32,
    pub features: String,
    pub ops_limit: i64,
    pub nodes_limit: i64,
    pub agents_limit: i64,
    pub members: Vec<OrgMember>,
    pub kc_org_id: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct OrgMember {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub username: Option<String>,
    pub role: String,
}

#[derive(Deserialize)]
pub struct InviteMember {
    pub email: String,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateOrg {
    pub org_name: Option<String>,
}

#[derive(Deserialize)]
pub struct RemoveMemberPath {
    pub user_id: String,
}

// ── Helpers ──────────────────────────────────────────────────────

/// Extract the KC base admin URL and realm from AUTH_KEYCLOAK_ISSUER.
fn kc_admin_base() -> Result<(String, String), StatusCode> {
    let issuer = std::env::var("AUTH_KEYCLOAK_ISSUER").map_err(|_| {
        tracing::error!("AUTH_KEYCLOAK_ISSUER not set");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let base = issuer
        .split("/realms/")
        .next()
        .unwrap_or(&issuer)
        .trim_end_matches('/')
        .to_string();
    let realm = issuer
        .split("/realms/")
        .nth(1)
        .unwrap_or("sulcus")
        .trim_end_matches('/')
        .to_string();
    Ok((base, realm))
}

/// Get an admin bearer token string.
async fn admin_token() -> Result<String, StatusCode> {
    get_admin_token().await.map(|t| t.access_token).map_err(|e| {
        tracing::error!(error = %e, "failed to get KC admin token");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

/// Find or create a KC Organization for this tenant.
/// Returns the KC org ID.
async fn ensure_kc_org(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    client: &Client,
    base: &str,
    realm: &str,
    token: &str,
) -> Result<String, StatusCode> {
    // 1. Check if we already have a mapping
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT kc_org_id FROM tenant_kc_orgs WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "failed to query tenant_kc_orgs");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if let Some((org_id,)) = existing {
        return Ok(org_id);
    }

    // 2. Get org name from api_keys
    let org_name: Option<String> = sqlx::query_scalar(
        "SELECT org_name FROM api_keys WHERE tenant_id = $1 AND org_name IS NOT NULL LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "failed to query org_name");
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .flatten();

    let name = org_name.unwrap_or_else(|| format!("org-{}", &tenant_id[..8.min(tenant_id.len())]));
    // Alias must be URL-safe — lowercase, replace non-alphanumeric with dashes
    let alias = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>();

    // 3. Create the KC organization
    let url = format!("{}/admin/realms/{}/organizations", base, realm);
    let resp = client
        .post(&url)
        .bearer_auth(token)
        .json(&serde_json::json!({
            "name": name,
            "alias": alias,
            "enabled": true,
            "description": format!("Organization for tenant {}", tenant_id),
        }))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to create KC org");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!(status = %status, body = %body, "KC create org failed");
        // If 409 (conflict), try to find existing org by alias
        if status == reqwest::StatusCode::CONFLICT {
            let search_url = format!(
                "{}/admin/realms/{}/organizations?search={}&exact=true",
                base, realm, alias
            );
            let search_resp = client
                .get(&search_url)
                .bearer_auth(token)
                .send()
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let orgs: Vec<serde_json::Value> = search_resp
                .json()
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            if let Some(org) = orgs.first() {
                if let Some(id) = org["id"].as_str() {
                    // Store the mapping
                    let _ = sqlx::query(
                        "INSERT INTO tenant_kc_orgs (tenant_id, kc_org_id) VALUES ($1, $2) \
                         ON CONFLICT (tenant_id) DO UPDATE SET kc_org_id = EXCLUDED.kc_org_id",
                    )
                    .bind(tenant_id)
                    .bind(id)
                    .execute(pool)
                    .await;
                    return Ok(id.to_string());
                }
            }
        }
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // Extract org ID from Location header
    let location = resp
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let org_id = location
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string();

    if org_id.is_empty() {
        tracing::error!("KC org created but no ID in Location header");
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // 4. Store the mapping
    sqlx::query(
        "INSERT INTO tenant_kc_orgs (tenant_id, kc_org_id) VALUES ($1, $2) \
         ON CONFLICT (tenant_id) DO UPDATE SET kc_org_id = EXCLUDED.kc_org_id",
    )
    .bind(tenant_id)
    .bind(&org_id)
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "failed to store tenant_kc_orgs mapping");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tracing::info!(tenant_id = %tenant_id, kc_org_id = %org_id, "created KC organization");
    Ok(org_id)
}

/// Fetch members of a KC organization.
async fn fetch_kc_members(
    client: &Client,
    base: &str,
    realm: &str,
    token: &str,
    org_id: &str,
) -> Result<Vec<OrgMember>, StatusCode> {
    let url = format!(
        "{}/admin/realms/{}/organizations/{}/members?first=0&max=100",
        base, realm, org_id
    );
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to fetch KC org members");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        tracing::error!(body = %body, "KC fetch members failed");
        return Ok(vec![]);
    }

    let users: Vec<serde_json::Value> = resp.json().await.map_err(|e| {
        tracing::error!(error = %e, "failed to parse KC members response");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(users
        .into_iter()
        .map(|u| {
            let first = u["firstName"].as_str().unwrap_or("");
            let last = u["lastName"].as_str().unwrap_or("");
            let display_name = if first.is_empty() && last.is_empty() {
                None
            } else {
                Some(format!("{} {}", first, last).trim().to_string())
            };
            OrgMember {
                id: u["id"].as_str().unwrap_or("").to_string(),
                email: u["email"].as_str().unwrap_or("").to_string(),
                name: display_name,
                username: u["username"].as_str().map(|s| s.to_string()),
                role: "member".to_string(), // KC26 doesn't have org-scoped roles yet
            }
        })
        .collect())
}

// ── GET /api/v1/org ──────────────────────────────────────────────

pub async fn get_org(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = &tenant_ctx.id;

    // Get plan info from api_keys
    let row = match sqlx::query_as::<_, (Option<String>, String, Option<i32>, Option<String>)>(
        "SELECT org_name, COALESCE(plan_tier, 'free'), max_seats, features \
         FROM api_keys WHERE tenant_id = $1 \
         ORDER BY CASE WHEN plan_tier = 'enterprise' THEN 0 WHEN plan_tier = 'cortex' THEN 1 ELSE 2 END \
         LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return (StatusCode::NOT_FOUND, "Tenant not found").into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to get org info");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
        }
    };

    let features = if !tenant_ctx.features.is_empty() {
        tenant_ctx.features.clone()
    } else {
        row.3.unwrap_or_default()
    };

    // Try to get KC org + members
    let (kc_org_id, members, seats_used) = match kc_admin_base() {
        Ok((base, realm)) => match admin_token().await {
            Ok(token) => {
                let client = Client::new();
                match ensure_kc_org(&state.pool, tenant_id, &client, &base, &realm, &token).await {
                    Ok(org_id) => {
                        let members =
                            fetch_kc_members(&client, &base, &realm, &token, &org_id).await.unwrap_or_default();
                        let count = members.len() as i32;
                        (Some(org_id), members, count.max(1))
                    }
                    Err(_) => (None, vec![], 1),
                }
            }
            Err(_) => (None, vec![], 1),
        },
        Err(_) => (None, vec![], 1),
    };

    let info = OrgInfo {
        tenant_id: tenant_id.clone(),
        org_name: row.0,
        plan_tier: row.1.clone(),
        max_seats: row.2,
        seats_used,
        features,
        ops_limit: tenant_ctx.effective_ops_limit(),
        nodes_limit: tenant_ctx.effective_node_limit(),
        agents_limit: tenant_ctx.effective_agent_limit(),
        members,
        kc_org_id,
    };

    (StatusCode::OK, Json(info)).into_response()
}

// ── PATCH /api/v1/org ────────────────────────────────────────────

pub async fn update_org(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(payload): Json<UpdateOrg>,
) -> impl IntoResponse {
    let tenant_id = &tenant_ctx.id;

    if let Some(ref name) = payload.org_name {
        // Update local DB
        if let Err(e) = sqlx::query("UPDATE api_keys SET org_name = $1 WHERE tenant_id = $2")
            .bind(name)
            .bind(tenant_id)
            .execute(&state.pool)
            .await
        {
            tracing::error!(error = %e, "failed to update org name");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
        }

        // Also update KC org name if it exists
        if let Ok((base, realm)) = kc_admin_base() {
            if let Ok(token) = admin_token().await {
                let client = Client::new();
                if let Ok(org_id) =
                    ensure_kc_org(&state.pool, tenant_id, &client, &base, &realm, &token).await
                {
                    let url = format!(
                        "{}/admin/realms/{}/organizations/{}",
                        base, realm, org_id
                    );
                    let _ = client
                        .put(&url)
                        .bearer_auth(&token)
                        .json(&serde_json::json!({
                            "name": name,
                            "description": format!("Organization for tenant {}", tenant_id),
                        }))
                        .send()
                        .await;
                }
            }
        }
    }

    StatusCode::OK.into_response()
}

// ── Invite throttling ────────────────────────────────────────────

/// Max invites per tenant per hour. Prevents spam from bad actors.
const MAX_INVITES_PER_HOUR: i64 = 10;
/// Cooldown in seconds between invites to the same email.
const REINVITE_COOLDOWN_SECS: i64 = 300; // 5 minutes

/// Check invite rate limit. Returns Ok(()) if allowed, Err(Response) if throttled.
async fn check_invite_throttle(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    email: &str,
) -> Result<(), Response> {
    // 1. Check per-tenant hourly limit
    let hourly_count: Option<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*) FROM org_invite_log \
         WHERE tenant_id = $1 AND created_at > now() - interval '1 hour'",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    if let Some((count,)) = hourly_count {
        if count >= MAX_INVITES_PER_HOUR {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                Json(serde_json::json!({
                    "error": "rate_limited",
                    "message": format!("Maximum {} invites per hour. Try again later.", MAX_INVITES_PER_HOUR),
                    "retry_after_secs": 3600,
                })),
            )
                .into_response());
        }
    }

    // 2. Check per-email cooldown (prevent reinvite spam)
    let last_invite: Option<(String,)> = sqlx::query_as(
        "SELECT created_at::text FROM org_invite_log \
         WHERE tenant_id = $1 AND email = $2 \
         AND created_at > now() - make_interval(secs => $3) \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(tenant_id)
    .bind(email)
    .bind(REINVITE_COOLDOWN_SECS as f64)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    if last_invite.is_some() {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "error": "cooldown",
                "message": format!("Please wait {} minutes before resending an invite to this email.", REINVITE_COOLDOWN_SECS / 60),
                "retry_after_secs": REINVITE_COOLDOWN_SECS,
            })),
        )
            .into_response());
    }

    Ok(())
}

/// Record an invite in the throttle log.
async fn log_invite(pool: &sqlx::PgPool, tenant_id: &str, email: &str) {
    let _ = sqlx::query(
        "INSERT INTO org_invite_log (tenant_id, email) VALUES ($1, $2)",
    )
    .bind(tenant_id)
    .bind(email)
    .execute(pool)
    .await;
}

/// Send invite via KC (shared logic for invite + reinvite).
async fn send_kc_invite(
    client: &Client,
    base: &str,
    realm: &str,
    token: &str,
    org_id: &str,
    email: &str,
    first_name: Option<&str>,
    last_name: Option<&str>,
) -> Result<Response, StatusCode> {
    let invite_url = format!(
        "{}/admin/realms/{}/organizations/{}/members/invite-user",
        base, realm, org_id
    );

    let mut form = vec![("email", email.to_string())];
    if let Some(first) = first_name {
        form.push(("firstName", first.to_string()));
    }
    if let Some(last) = last_name {
        form.push(("lastName", last.to_string()));
    }

    let resp = client
        .post(&invite_url)
        .bearer_auth(token)
        .form(&form)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to send KC invite");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if resp.status().is_success() {
        tracing::info!(email = %email, org_id = %org_id, "invite sent via Keycloak");
        Ok((
            StatusCode::OK,
            Json(serde_json::json!({
                "message": "Invitation sent",
                "email": email,
            })),
        )
            .into_response())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!(status = %status, body = %body, email = %email, "KC invite failed");

        let error_msg = if status == reqwest::StatusCode::CONFLICT {
            "Member already exists in this organization"
        } else if status == reqwest::StatusCode::BAD_REQUEST {
            "Invalid email address"
        } else {
            "Failed to send invitation"
        };

        Ok((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            Json(serde_json::json!({
                "error": error_msg,
                "detail": body,
            })),
        )
            .into_response())
    }
}

// ── POST /api/v1/org/invite ──────────────────────────────────────

pub async fn invite_member(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(payload): Json<InviteMember>,
) -> Result<Response, StatusCode> {
    let tenant_id = &tenant_ctx.id;

    // Throttle check
    if let Err(throttle_resp) = check_invite_throttle(&state.pool, tenant_id, &payload.email).await {
        return Ok(throttle_resp);
    }

    // Check seat limits from DB (Stripe-provisioned)
    let max_seats: Option<i32> = sqlx::query_scalar(
        "SELECT max_seats FROM api_keys WHERE tenant_id = $1 \
         ORDER BY CASE WHEN plan_tier = 'enterprise' THEN 0 ELSE 1 END LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None)
    .flatten();

    let (base, realm) = kc_admin_base()?;
    let token = admin_token().await?;
    let client = Client::new();
    let org_id = ensure_kc_org(&state.pool, tenant_id, &client, &base, &realm, &token).await?;

    // Check current member count against seat limit
    if let Some(limit) = max_seats {
        if limit > 0 {
            let count_url = format!(
                "{}/admin/realms/{}/organizations/{}/members/count",
                base, realm, org_id
            );
            let count_resp = client
                .get(&count_url)
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let count: i64 = count_resp.json().await.unwrap_or(0);
            if count >= limit as i64 {
                return Ok((
                    StatusCode::FORBIDDEN,
                    Json(serde_json::json!({
                        "error": "seat_limit_reached",
                        "message": format!("Your plan allows {} seats. Upgrade for more.", limit),
                        "max_seats": limit,
                        "seats_used": count,
                    })),
                )
                    .into_response());
            }
        }
    }

    let result = send_kc_invite(
        &client, &base, &realm, &token, &org_id,
        &payload.email,
        payload.first_name.as_deref(),
        payload.last_name.as_deref(),
    )
    .await?;

    // Log the invite for throttling
    log_invite(&state.pool, tenant_id, &payload.email).await;

    Ok(result)
}

// ── POST /api/v1/org/reinvite ────────────────────────────────────

pub async fn reinvite_member(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(payload): Json<InviteMember>,
) -> Result<Response, StatusCode> {
    let tenant_id = &tenant_ctx.id;

    // Throttle check (same limits apply to reinvites)
    if let Err(throttle_resp) = check_invite_throttle(&state.pool, tenant_id, &payload.email).await {
        return Ok(throttle_resp);
    }

    let (base, realm) = kc_admin_base()?;
    let token = admin_token().await?;
    let client = Client::new();
    let org_id = ensure_kc_org(&state.pool, tenant_id, &client, &base, &realm, &token).await?;

    // First, remove the member if they exist (so KC sends a fresh invite)
    // Search for the user by email in KC
    let search_url = format!(
        "{}/admin/realms/{}/users?email={}&exact=true",
        base, realm,
        urlencoding::encode(&payload.email)
    );
    let search_resp = client
        .get(&search_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if search_resp.status().is_success() {
        let users: Vec<serde_json::Value> = search_resp.json().await.unwrap_or_default();
        if let Some(user) = users.first() {
            if let Some(user_id) = user["id"].as_str() {
                // Remove from org first (ignore errors — may not be a member yet)
                let remove_url = format!(
                    "{}/admin/realms/{}/organizations/{}/members/{}",
                    base, realm, org_id, user_id
                );
                let _ = client
                    .delete(&remove_url)
                    .bearer_auth(&token)
                    .send()
                    .await;
            }
        }
    }

    // Now send a fresh invite
    let result = send_kc_invite(
        &client, &base, &realm, &token, &org_id,
        &payload.email,
        payload.first_name.as_deref(),
        payload.last_name.as_deref(),
    )
    .await?;

    log_invite(&state.pool, tenant_id, &payload.email).await;

    Ok(result)
}

// ── DELETE /api/v1/org/members/:user_id ──────────────────────────

pub async fn remove_member(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Path(params): Path<RemoveMemberPath>,
) -> Result<Response, StatusCode> {
    let tenant_id = &tenant_ctx.id;

    let (base, realm) = kc_admin_base()?;
    let token = admin_token().await?;
    let client = Client::new();
    let org_id = ensure_kc_org(&state.pool, tenant_id, &client, &base, &realm, &token).await?;

    let url = format!(
        "{}/admin/realms/{}/organizations/{}/members/{}",
        base, realm, org_id, params.user_id
    );

    let resp = client
        .delete(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to remove KC org member");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if resp.status().is_success() {
        tracing::info!(user_id = %params.user_id, org_id = %org_id, "member removed via Keycloak");
        Ok((
            StatusCode::OK,
            Json(serde_json::json!({ "message": "Member removed" })),
        )
            .into_response())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!(status = %status, body = %body, "KC remove member failed");
        Ok((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Member not found" })),
        )
            .into_response())
    }
}
