use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::SharedState;

/// POST /api/v1/waitlist — public, no auth required
pub async fn join_waitlist(
    State(state): State<SharedState>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let email = match body.get("email").and_then(|v| v.as_str()) {
        Some(e) if e.contains('@') && e.len() > 3 => e.trim().to_lowercase(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "valid email required"})),
            )
        }
    };

    let source = body
        .get("source")
        .and_then(|v| v.as_str())
        .unwrap_or("landing");

    let result = sqlx::query(
        "INSERT INTO waitlist (email, source) VALUES ($1, $2) \
         ON CONFLICT (email) DO NOTHING",
    )
    .bind(&email)
    .bind(source)
    .execute(&state.pool)
    .await;

    match result {
        Ok(r) => {
            let was_new = r.rows_affected() > 0;
            (
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "new": was_new,
                    "message": if was_new { "Welcome! You're on the list." } else { "You're already on the list." }
                })),
            )
        }
        Err(e) => {
            tracing::error!(error = %e, "waitlist insert failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "internal error"})),
            )
        }
    }
}

/// GET /api/v1/admin/waitlist — authenticated, admin only
pub async fn list_waitlist(State(state): State<SharedState>) -> Json<Value> {
    let rows = sqlx::query_as::<_, (i64, String, String, Option<String>)>(
        "SELECT id, email, source, created_at::text FROM waitlist ORDER BY created_at DESC LIMIT 500",
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let items: Vec<Value> = rows
        .iter()
        .map(|(id, email, source, created_at)| {
            json!({
                "id": id,
                "email": email,
                "source": source,
                "created_at": created_at,
            })
        })
        .collect();

    Json(json!({ "items": items, "total": items.len() }))
}
