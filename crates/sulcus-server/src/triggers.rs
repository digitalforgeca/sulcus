//! Stub trigger endpoints — returns empty collections until the full trigger
//! engine is built.  Prevents dashboard 404 retry storms.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;

use crate::middleware::TenantContext;
use crate::SharedState;

// ── GET /api/v1/triggers ─────────────────────────────────────────────────

pub async fn list_triggers(
    State(_state): State<SharedState>,
    Extension(_tenant_ctx): Extension<TenantContext>,
) -> impl IntoResponse {
    Json(json!({ "items": [], "total": 0 }))
}

// ── POST /api/v1/triggers ────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateTrigger {
    pub name: Option<String>,
    pub event: Option<String>,
    pub pattern: Option<String>,
    pub actions: Option<serde_json::Value>,
}

pub async fn create_trigger(
    State(_state): State<SharedState>,
    Extension(_tenant_ctx): Extension<TenantContext>,
    Json(_body): Json<CreateTrigger>,
) -> impl IntoResponse {
    // Stub — triggers table doesn't exist yet
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": "Triggers engine not yet deployed. Coming soon."
        })),
    )
}

// ── GET /api/v1/triggers/:id ─────────────────────────────────────────────

pub async fn get_trigger(
    State(_state): State<SharedState>,
    Extension(_tenant_ctx): Extension<TenantContext>,
    Path(_id): Path<String>,
) -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "Trigger not found" })),
    )
}

// ── PATCH /api/v1/triggers/:id ───────────────────────────────────────────

pub async fn update_trigger(
    State(_state): State<SharedState>,
    Extension(_tenant_ctx): Extension<TenantContext>,
    Path(_id): Path<String>,
    Json(_body): Json<serde_json::Value>,
) -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": "Triggers engine not yet deployed. Coming soon."
        })),
    )
}

// ── DELETE /api/v1/triggers/:id ──────────────────────────────────────────

pub async fn delete_trigger(
    State(_state): State<SharedState>,
    Extension(_tenant_ctx): Extension<TenantContext>,
    Path(_id): Path<String>,
) -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": "Triggers engine not yet deployed. Coming soon."
        })),
    )
}

// ── GET /api/v1/triggers/history ─────────────────────────────────────────

pub async fn trigger_history(
    State(_state): State<SharedState>,
    Extension(_tenant_ctx): Extension<TenantContext>,
) -> impl IntoResponse {
    Json(json!({ "items": [], "total": 0 }))
}
