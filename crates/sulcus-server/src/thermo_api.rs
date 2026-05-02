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

    // Check if this tenant has a custom config stored
    let has_custom: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM thermo_config WHERE tenant_id = $1)")
            .bind(tenant)
            .fetch_one(pool)
            .await
            .unwrap_or(false);

    // load_tenant_config handles backfilling half_life_interactions for pre-v2.2.0 configs
    let config = load_tenant_config(pool, tenant).await;

    Json(serde_json::json!({
        "config": config,
        "defaults": ThermoConfig::default(),
        "custom": has_custom,
    }))
    .into_response()
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

// ─── GET /api/v1/analytics/recall ────────────────────────────────────────────

/// Recall quality analytics. Aggregates recall_log data by memory type and signal.
/// Returns stats that inform half-life tuning.
pub async fn get_recall_analytics(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant = &tenant_ctx.id;

    // Per-type recall signal counts
    #[derive(Debug, Serialize)]
    struct TypeStats {
        memory_type: String,
        total_recalls: i64,
        relevant_count: i64,
        irrelevant_count: i64,
        outdated_count: i64,
        relevance_ratio: f64,
        avg_heat_before: f64,
        avg_heat_after: f64,
    }

    let rows = sqlx::query(
        r#"SELECT
            COALESCE(gi.memory_type, 'unknown') AS memory_type,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE rl.signal = 'relevant') AS relevant,
            COUNT(*) FILTER (WHERE rl.signal = 'irrelevant') AS irrelevant,
            COUNT(*) FILTER (WHERE rl.signal = 'outdated') AS outdated,
            COALESCE(AVG(rl.heat_before), 0) AS avg_heat_before,
            COALESCE(AVG(rl.heat_after), 0) AS avg_heat_after
        FROM recall_log rl
        LEFT JOIN golden_index gi ON gi.id = rl.node_id AND gi.tenant_id = rl.tenant_id
        WHERE rl.tenant_id = $1
          AND rl.recalled_at > NOW() - INTERVAL '30 days'
        GROUP BY gi.memory_type
        ORDER BY total DESC"#,
    )
    .bind(tenant)
    .fetch_all(pool)
    .await;

    let stats: Vec<TypeStats> = match rows {
        Ok(rows) => rows
            .iter()
            .map(|r| {
                let total: i64 = sqlx::Row::get(r, "total");
                let relevant: i64 = sqlx::Row::get(r, "relevant");
                let irrelevant: i64 = sqlx::Row::get(r, "irrelevant");
                let outdated: i64 = sqlx::Row::get(r, "outdated");
                let relevance_ratio = if total > 0 {
                    relevant as f64 / total as f64
                } else {
                    0.0
                };
                TypeStats {
                    memory_type: sqlx::Row::get(r, "memory_type"),
                    total_recalls: total,
                    relevant_count: relevant,
                    irrelevant_count: irrelevant,
                    outdated_count: outdated,
                    relevance_ratio,
                    avg_heat_before: sqlx::Row::get(r, "avg_heat_before"),
                    avg_heat_after: sqlx::Row::get(r, "avg_heat_after"),
                }
            })
            .collect(),
        Err(e) => {
            tracing::error!("Failed to query recall analytics: {e}");
            Vec::new()
        }
    };

    // Generate tuning suggestions
    let mut suggestions: Vec<String> = Vec::new();
    for s in &stats {
        if s.total_recalls >= 10 {
            if s.relevance_ratio < 0.3 {
                suggestions.push(format!(
                    "{}: low relevance ({:.0}%) — consider shorter half-life to let stale memories fade faster",
                    s.memory_type,
                    s.relevance_ratio * 100.0
                ));
            }
            if s.relevance_ratio > 0.9 && s.total_recalls > 20 {
                suggestions.push(format!(
                    "{}: high relevance ({:.0}%) — these memories are valuable, consider longer half-life",
                    s.memory_type,
                    s.relevance_ratio * 100.0
                ));
            }
            if s.outdated_count as f64 / s.total_recalls as f64 > 0.2 {
                suggestions.push(format!(
                    "{}: {:.0}% outdated — consider shorter half-life or TTL for this type",
                    s.memory_type,
                    s.outdated_count as f64 / s.total_recalls as f64 * 100.0
                ));
            }
        }
    }

    Json(serde_json::json!({
        "stats": stats,
        "suggestions": suggestions,
        "period": "30d",
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
            let mut config: ThermoConfig =
                serde_json::from_value(config_json).unwrap_or_default();
            // Backfill per-type half_life_interactions from defaults for configs
            // that were saved before v2.2.0 (they deserialize with 50.0 for all types).
            let defaults = sulcus_types::thermo::default_decay_profiles();
            for (name, profile) in &mut config.decay_profiles {
                if profile.half_life_interactions == 50.0 {
                    if let Some(default_profile) = defaults.get(name) {
                        profile.half_life_interactions = default_profile.half_life_interactions;
                    }
                }
            }
            config
        }
        None => ThermoConfig::default(),
    }
}
