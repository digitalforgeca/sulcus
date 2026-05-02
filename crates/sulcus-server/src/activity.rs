//! Activity log: write-through log of every significant action in Sulcus.
//!
//! # Endpoints
//! - `GET  /api/v1/activity`  — paginated activity feed (auth required)
//! - `POST /api/v1/activity`  — record a new activity entry (internal use)
//!
//! # Free function
//! `log_activity` is exported for use by other handlers so they can fire-and-forget
//! activity records without coupling to the HTTP layer.

use axum::{
    extract::{Extension, Json, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::SharedState;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ActivityItem {
    pub id: i64,
    pub actor: String,
    pub action: String,
    pub target_id: Option<Uuid>,
    pub target_label: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct ActivityListResponse {
    pub items: Vec<ActivityItem>,
    pub next_cursor: Option<String>,
}

// ---------------------------------------------------------------------------
// GET /api/v1/activity
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ActivityQuery {
    /// Max items to return (default 50, capped at 200).
    pub limit: Option<i64>,
    /// Filter by exact actor name.
    pub actor: Option<String>,
    /// Filter by action prefix (e.g. "memory" matches "memory.add", "memory.delete").
    pub action: Option<String>,
    /// ISO-8601 timestamp cursor — return items *before* this timestamp.
    pub before: Option<String>,
}

pub async fn list_activity(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Query(params): Query<ActivityQuery>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    let limit = params.limit.unwrap_or(50).clamp(1, 200);

    // Parse the cursor timestamp if provided.
    let before_ts: Option<DateTime<Utc>> = params
        .before
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc));

    match fetch_activity(
        &state.pool,
        &tenant_id,
        limit,
        params.actor.as_deref(),
        params.action.as_deref(),
        before_ts,
    )
    .await
    {
        Ok(items) => {
            // If we got a full page, set the cursor to the last item's created_at.
            let next_cursor = if items.len() == limit as usize {
                items.last().map(|i| i.created_at.to_rfc3339())
            } else {
                None
            };
            (
                StatusCode::OK,
                Json(ActivityListResponse { items, next_cursor }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch activity log");
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response()
        }
    }
}

async fn fetch_activity(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    actor: Option<&str>,
    action_prefix: Option<&str>,
    before: Option<DateTime<Utc>>,
) -> anyhow::Result<Vec<ActivityItem>> {
    // Build query dynamically — sqlx doesn't support fully dynamic bind lists,
    // so we enumerate the relevant combinations.
    let rows = match (actor, action_prefix, before) {
        (None, None, None) => {
            sqlx::query_as::<
                _,
                (
                    i64,
                    String,
                    String,
                    Option<Uuid>,
                    Option<String>,
                    Option<serde_json::Value>,
                    DateTime<Utc>,
                ),
            >(
                "SELECT id, actor, action, target_id, target_label, metadata, created_at \
                 FROM activity_log WHERE tenant_id = $1 \
                 ORDER BY created_at DESC LIMIT $2",
            )
            .bind(tenant_id)
            .bind(limit)
            .fetch_all(pool)
            .await?
        }
        (Some(a), None, None) => {
            sqlx::query_as::<
                _,
                (
                    i64,
                    String,
                    String,
                    Option<Uuid>,
                    Option<String>,
                    Option<serde_json::Value>,
                    DateTime<Utc>,
                ),
            >(
                "SELECT id, actor, action, target_id, target_label, metadata, created_at \
                 FROM activity_log WHERE tenant_id = $1 AND actor = $2 \
                 ORDER BY created_at DESC LIMIT $3",
            )
            .bind(tenant_id)
            .bind(a)
            .bind(limit)
            .fetch_all(pool)
            .await?
        }
        (None, Some(ap), None) => {
            let pattern = format!("{}%", ap);
            sqlx::query_as::<
                _,
                (
                    i64,
                    String,
                    String,
                    Option<Uuid>,
                    Option<String>,
                    Option<serde_json::Value>,
                    DateTime<Utc>,
                ),
            >(
                "SELECT id, actor, action, target_id, target_label, metadata, created_at \
                 FROM activity_log WHERE tenant_id = $1 AND action LIKE $2 \
                 ORDER BY created_at DESC LIMIT $3",
            )
            .bind(tenant_id)
            .bind(pattern)
            .bind(limit)
            .fetch_all(pool)
            .await?
        }
        (None, None, Some(b)) => {
            sqlx::query_as::<
                _,
                (
                    i64,
                    String,
                    String,
                    Option<Uuid>,
                    Option<String>,
                    Option<serde_json::Value>,
                    DateTime<Utc>,
                ),
            >(
                "SELECT id, actor, action, target_id, target_label, metadata, created_at \
                 FROM activity_log WHERE tenant_id = $1 AND created_at < $2 \
                 ORDER BY created_at DESC LIMIT $3",
            )
            .bind(tenant_id)
            .bind(b)
            .bind(limit)
            .fetch_all(pool)
            .await?
        }
        (Some(a), Some(ap), None) => {
            let pattern = format!("{}%", ap);
            sqlx::query_as::<
                _,
                (
                    i64,
                    String,
                    String,
                    Option<Uuid>,
                    Option<String>,
                    Option<serde_json::Value>,
                    DateTime<Utc>,
                ),
            >(
                "SELECT id, actor, action, target_id, target_label, metadata, created_at \
                 FROM activity_log WHERE tenant_id = $1 AND actor = $2 AND action LIKE $3 \
                 ORDER BY created_at DESC LIMIT $4",
            )
            .bind(tenant_id)
            .bind(a)
            .bind(pattern)
            .bind(limit)
            .fetch_all(pool)
            .await?
        }
        (Some(a), None, Some(b)) => {
            sqlx::query_as::<
                _,
                (
                    i64,
                    String,
                    String,
                    Option<Uuid>,
                    Option<String>,
                    Option<serde_json::Value>,
                    DateTime<Utc>,
                ),
            >(
                "SELECT id, actor, action, target_id, target_label, metadata, created_at \
                 FROM activity_log WHERE tenant_id = $1 AND actor = $2 AND created_at < $3 \
                 ORDER BY created_at DESC LIMIT $4",
            )
            .bind(tenant_id)
            .bind(a)
            .bind(b)
            .bind(limit)
            .fetch_all(pool)
            .await?
        }
        (None, Some(ap), Some(b)) => {
            let pattern = format!("{}%", ap);
            sqlx::query_as::<
                _,
                (
                    i64,
                    String,
                    String,
                    Option<Uuid>,
                    Option<String>,
                    Option<serde_json::Value>,
                    DateTime<Utc>,
                ),
            >(
                "SELECT id, actor, action, target_id, target_label, metadata, created_at \
                 FROM activity_log WHERE tenant_id = $1 AND action LIKE $2 AND created_at < $3 \
                 ORDER BY created_at DESC LIMIT $4",
            )
            .bind(tenant_id)
            .bind(pattern)
            .bind(b)
            .bind(limit)
            .fetch_all(pool)
            .await?
        }
        (Some(a), Some(ap), Some(b)) => {
            let pattern = format!("{}%", ap);
            sqlx::query_as::<
                _,
                (i64, String, String, Option<Uuid>, Option<String>, Option<serde_json::Value>, DateTime<Utc>),
            >(
                "SELECT id, actor, action, target_id, target_label, metadata, created_at \
                 FROM activity_log WHERE tenant_id = $1 AND actor = $2 AND action LIKE $3 AND created_at < $4 \
                 ORDER BY created_at DESC LIMIT $5",
            )
            .bind(tenant_id)
            .bind(a)
            .bind(pattern)
            .bind(b)
            .bind(limit)
            .fetch_all(pool)
            .await?
        }
    };

    Ok(rows
        .into_iter()
        .map(
            |(id, actor, action, target_id, target_label, metadata, created_at)| ActivityItem {
                id,
                actor,
                action,
                target_id,
                target_label,
                metadata,
                created_at,
            },
        )
        .collect())
}

// ---------------------------------------------------------------------------
// POST /api/v1/activity  (internal use)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RecordActivityRequest {
    pub actor: String,
    pub action: String,
    pub target_id: Option<Uuid>,
    pub target_label: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct RecordActivityResponse {
    pub id: i64,
}

pub async fn record_activity(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(body): Json<RecordActivityRequest>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;

    match log_activity(
        &state.pool,
        &tenant_id,
        &body.actor,
        &body.action,
        body.target_id,
        body.target_label.as_deref(),
        body.metadata,
    )
    .await
    {
        Ok(id) => (StatusCode::CREATED, Json(RecordActivityResponse { id })).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to record activity");
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// Free function — callable from any handler
// ---------------------------------------------------------------------------

/// Insert a row into `activity_log` and return the new `id`.
///
/// Designed for fire-and-forget use inside other handlers:
/// ```rust,no_run,ignore
/// let _ = crate::activity::log_activity(&state.pool, &tenant_id, "system", "memory.add", Some(node_id), Some(&label), None).await;
/// ```
pub async fn log_activity(
    pool: &PgPool,
    tenant_id: &str,
    actor: &str,
    action: &str,
    target_id: Option<Uuid>,
    target_label: Option<&str>,
    metadata: Option<serde_json::Value>,
) -> anyhow::Result<i64> {
    let row = sqlx::query_as::<_, (i64,)>(
        "INSERT INTO activity_log (tenant_id, actor, action, target_id, target_label, metadata) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         RETURNING id",
    )
    .bind(tenant_id)
    .bind(actor)
    .bind(action)
    .bind(target_id)
    .bind(target_label)
    .bind(metadata)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}
