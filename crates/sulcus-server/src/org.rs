//! Organization (org) management — seats, members, invites.

use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::IntoResponse,
    Extension,
};
use serde::{Deserialize, Serialize};

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
    pub members: Vec<OrgMember>,
}

#[derive(Serialize)]
pub struct OrgMember {
    pub email: String,
    pub name: Option<String>,
    pub role: String, // "owner" | "member"
    pub joined_at: String,
}

#[derive(Deserialize)]
pub struct InviteMember {
    pub email: String,
}

#[derive(Deserialize)]
pub struct UpdateOrg {
    pub org_name: Option<String>,
}

#[derive(Deserialize)]
pub struct RemoveMember {
    pub email: String,
}

// ── GET /api/v1/org ──────────────────────────────────────────────

pub async fn get_org(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = &tenant_ctx.id;

    // Get org info from api_keys
    let row = match sqlx::query_as::<_, (Option<String>, String, Option<i32>, i32, Option<String>)>(
        "SELECT org_name, COALESCE(plan_tier, 'free'), max_seats, \
         COALESCE(seats_used, 1), features \
         FROM api_keys WHERE tenant_id = $1",
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

    // Get org members from org_members table
    let members: Vec<OrgMember> =
        match sqlx::query_as::<_, (String, Option<String>, String, String)>(
            "SELECT email, name, role, joined_at::text \
         FROM org_members WHERE tenant_id = $1 ORDER BY joined_at",
        )
        .bind(tenant_id)
        .fetch_all(&state.pool)
        .await
        {
            Ok(rows) => rows
                .into_iter()
                .map(|(email, name, role, joined_at)| OrgMember {
                    email,
                    name,
                    role,
                    joined_at,
                })
                .collect(),
            Err(_) => vec![], // Table may not exist yet
        };

    let info = OrgInfo {
        tenant_id: tenant_id.clone(),
        org_name: row.0,
        plan_tier: row.1.clone(),
        max_seats: row.2,
        seats_used: row.3,
        features: row.4.unwrap_or_default(),
        ops_limit: tenant_ctx.effective_ops_limit(),
        nodes_limit: tenant_ctx.effective_node_limit(),
        members,
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
        if let Err(e) = sqlx::query("UPDATE api_keys SET org_name = $1 WHERE tenant_id = $2")
            .bind(name)
            .bind(tenant_id)
            .execute(&state.pool)
            .await
        {
            tracing::error!(error = %e, "failed to update org name");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
        }
    }

    StatusCode::OK.into_response()
}

// ── POST /api/v1/org/invite ──────────────────────────────────────

pub async fn invite_member(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(payload): Json<InviteMember>,
) -> impl IntoResponse {
    let tenant_id = &tenant_ctx.id;

    // Check seat limits
    let counts: Option<(Option<i32>, i32)> = sqlx::query_as(
        "SELECT max_seats, COALESCE(seats_used, 1) FROM api_keys WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None);

    if let Some((Some(limit), used)) = counts {
        if used >= limit {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "error": "seat_limit_reached",
                    "message": format!("Your plan allows {} seats. Upgrade for more.", limit),
                    "max_seats": limit,
                    "seats_used": used,
                })),
            )
                .into_response();
        }
    }

    // Insert member
    let result = sqlx::query(
        "INSERT INTO org_members (tenant_id, email, role, joined_at) \
         VALUES ($1, $2, 'member', now()) \
         ON CONFLICT (tenant_id, email) DO NOTHING",
    )
    .bind(tenant_id)
    .bind(&payload.email)
    .execute(&state.pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            // Increment seats_used
            let _ = sqlx::query(
                "UPDATE api_keys SET seats_used = COALESCE(seats_used, 1) + 1 WHERE tenant_id = $1",
            )
            .bind(tenant_id)
            .execute(&state.pool)
            .await;

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "message": "Member invited",
                    "email": payload.email,
                })),
            )
                .into_response()
        }
        Ok(_) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Member already exists" })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to invite member");
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response()
        }
    }
}

// ── DELETE /api/v1/org/members ───────────────────────────────────

pub async fn remove_member(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(payload): Json<RemoveMember>,
) -> impl IntoResponse {
    let tenant_id = &tenant_ctx.id;

    let result = sqlx::query(
        "DELETE FROM org_members WHERE tenant_id = $1 AND email = $2 AND role != 'owner'",
    )
    .bind(tenant_id)
    .bind(&payload.email)
    .execute(&state.pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            // Decrement seats_used
            let _ = sqlx::query(
                "UPDATE api_keys SET seats_used = GREATEST(COALESCE(seats_used, 1) - 1, 1) WHERE tenant_id = $1",
            )
            .bind(tenant_id)
            .execute(&state.pool)
            .await;

            (
                StatusCode::OK,
                Json(serde_json::json!({ "message": "Member removed" })),
            )
                .into_response()
        }
        Ok(_) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Member not found or cannot remove owner" })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to remove member");
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response()
        }
    }
}
