//! API handlers for the configurable thermodynamic engine.
//!
//! Endpoints:
//! - GET  /api/v1/settings/thermo  — get tenant's thermo config
//! - PATCH /api/v1/settings/thermo — update tenant's thermo config
//! - POST /api/v1/feedback         — record recall quality feedback

use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sulcus_core::thermo::ThermoConfig;

use crate::middleware::TenantContext;
use crate::SharedState;

// ─── GET /api/v1/settings/thermo ────────────────────────────────────────────

pub async fn get_thermo_config(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant = &tenant_ctx.id;

    let row: Option<sqlx::postgres::PgRow> =
        sqlx::query("SELECT config FROM thermo_config WHERE tenant_id = $1")
            .bind(tenant)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

    match row {
        Some(r) => {
            let config_json: serde_json::Value = sqlx::Row::get(&r, "config");
            let config: ThermoConfig = serde_json::from_value(config_json).unwrap_or_default();
            Json(serde_json::json!({
                "config": config,
                "defaults": ThermoConfig::default(),
                "custom": true,
            }))
            .into_response()
        }
        None => Json(serde_json::json!({
            "config": ThermoConfig::default(),
            "defaults": ThermoConfig::default(),
            "custom": false,
        }))
        .into_response(),
    }
}

// ─── PATCH /api/v1/settings/thermo ──────────────────────────────────────────

pub async fn update_thermo_config(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant = &tenant_ctx.id;

    // Validate the body parses as ThermoConfig
    let config: ThermoConfig = match serde_json::from_value(body.clone()) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": format!("Invalid config: {e}") })),
            )
                .into_response();
        }
    };

    // Validate constraints
    for (name, profile) in &config.decay_profiles {
        if profile.half_life_secs < 0.0 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("Decay profile '{name}' has negative half_life_secs")
                })),
            )
                .into_response();
        }
        if !(0.0..=1.0).contains(&profile.floor) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("Decay profile '{name}' floor must be 0.0–1.0")
                })),
            )
                .into_response();
        }
    }

    let config_json = serde_json::to_value(&config).unwrap_or_default();

    let result = sqlx::query(
        "INSERT INTO thermo_config (tenant_id, config, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (tenant_id)
         DO UPDATE SET config = $2, updated_at = now()",
    )
    .bind(tenant)
    .bind(&config_json)
    .execute(pool)
    .await;

    match result {
        Ok(_) => Json(serde_json::json!({
            "ok": true,
            "config": config,
        }))
        .into_response(),
        Err(e) => {
            tracing::error!("Failed to save thermo config: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ─── POST /api/v1/feedback ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct FeedbackRequest {
    pub node_id: uuid::Uuid,
    pub signal: FeedbackSignal,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum FeedbackSignal {
    Relevant,
    Irrelevant,
    Outdated,
}

pub async fn post_feedback(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
    Json(body): Json<FeedbackRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant = &tenant_ctx.id;

    // Load current node
    let node_row: Result<Option<(f32, f32, String)>, _> = sqlx::query_as(
        "SELECT current_heat, COALESCE(stability, 1.0), memory_type
         FROM golden_index WHERE id = $1 AND tenant_id = $2",
    )
    .bind(body.node_id)
    .bind(tenant)
    .fetch_optional(pool)
    .await;

    let (heat_before, stability, memory_type) = match node_row {
        Ok(Some((h, s, mt))) => (h, s, mt),
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Node not found" })),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!("Feedback lookup failed: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    // Load tenant thermo config (or defaults)
    let config = load_tenant_config(pool, tenant).await;

    // Apply feedback signal
    let (new_heat, new_stability, set_valid_until) = match body.signal {
        FeedbackSignal::Relevant => {
            let (h, s) = config.apply_recall(heat_before, stability, &memory_type);
            (h, s, false)
        }
        FeedbackSignal::Irrelevant => {
            let h = (heat_before * 0.7).max(0.01);
            let s = (stability * 0.5).max(0.1);
            (h, s, false)
        }
        FeedbackSignal::Outdated => (0.01, 0.1, true),
    };

    // Update node
    let update_result = if set_valid_until {
        sqlx::query(
            "UPDATE golden_index SET current_heat = $1, stability = $2, valid_until = now()
             WHERE id = $3 AND tenant_id = $4",
        )
        .bind(new_heat)
        .bind(new_stability)
        .bind(body.node_id)
        .bind(tenant)
        .execute(pool)
        .await
    } else {
        sqlx::query(
            "UPDATE golden_index SET current_heat = $1, stability = $2
             WHERE id = $3 AND tenant_id = $4",
        )
        .bind(new_heat)
        .bind(new_stability)
        .bind(body.node_id)
        .bind(tenant)
        .execute(pool)
        .await
    };

    if let Err(e) = update_result {
        tracing::error!("Failed to update node after feedback: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    // Log the recall event
    let signal_str = match body.signal {
        FeedbackSignal::Relevant => "relevant",
        FeedbackSignal::Irrelevant => "irrelevant",
        FeedbackSignal::Outdated => "outdated",
    };
    let _ = sqlx::query(
        "INSERT INTO recall_log (tenant_id, node_id, context, signal, heat_before, heat_after)
         VALUES ($1, $2, 'feedback', $3, $4, $5)",
    )
    .bind(tenant)
    .bind(body.node_id)
    .bind(signal_str)
    .bind(heat_before)
    .bind(new_heat)
    .execute(pool)
    .await;

    Json(serde_json::json!({
        "ok": true,
        "node_id": body.node_id,
        "signal": signal_str,
        "heat_before": heat_before,
        "heat_after": new_heat,
        "stability_before": stability,
        "stability_after": new_stability,
    }))
    .into_response()
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Load a tenant's thermo config from the database, falling back to defaults.
pub async fn load_tenant_config(pool: &PgPool, tenant: &str) -> ThermoConfig {
    let row: Option<sqlx::postgres::PgRow> =
        sqlx::query("SELECT config FROM thermo_config WHERE tenant_id = $1")
            .bind(tenant)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

    match row {
        Some(r) => {
            let config_json: serde_json::Value = sqlx::Row::get(&r, "config");
            serde_json::from_value(config_json).unwrap_or_default()
        }
        None => ThermoConfig::default(),
    }
}
