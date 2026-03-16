//! Anonymous telemetry endpoint for local Sulcus installs.
//!
//! Receives heartbeats from sulcus-local instances. No auth required.
//! Rate-limited to 1 event per instance_id per hour server-side.

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct TelemetryEvent {
    pub instance_id: String,
    #[serde(default = "default_event")]
    pub event: String,
    pub version: Option<String>,
    pub os: Option<String>,
    pub integration: Option<String>,
    pub llm_model: Option<String>,
    pub node_count: Option<i32>,
    pub edge_count: Option<i32>,
    pub memory_types: Option<serde_json::Value>,
    pub tick_mode: Option<String>,
    pub uptime_hours: Option<f32>,
    pub sync_enabled: Option<bool>,
    pub cloud_tenant: Option<String>,
    pub mcp_tools_called: Option<i64>,
    pub panel_active: Option<bool>,
}

fn default_event() -> String {
    "heartbeat".into()
}

#[derive(Serialize)]
pub struct TelemetryResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// POST /api/v1/telemetry
///
/// Accepts anonymous heartbeats. Rate-limited to 1 per instance per hour.
pub async fn ingest_telemetry(
    State(state): State<Arc<AppState>>,
    Json(ev): Json<TelemetryEvent>,
) -> (StatusCode, Json<TelemetryResponse>) {
    // Validate instance_id (must be non-empty, max 128 chars)
    if ev.instance_id.is_empty() || ev.instance_id.len() > 128 {
        return (
            StatusCode::BAD_REQUEST,
            Json(TelemetryResponse {
                ok: false,
                message: Some("invalid instance_id".into()),
            }),
        );
    }

    // Rate limit: check if this instance sent an event in the last hour
    let recent = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM telemetry_events
         WHERE instance_id = $1 AND received_at > now() - interval '1 hour'",
    )
    .bind(&ev.instance_id)
    .fetch_one(&*state.pool)
    .await
    .unwrap_or(0);

    if recent > 0 {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(TelemetryResponse {
                ok: false,
                message: Some("rate limited — 1 per hour per instance".into()),
            }),
        );
    }

    // Insert
    let result = sqlx::query(
        "INSERT INTO telemetry_events
         (instance_id, event, version, os, integration, llm_model,
          node_count, edge_count, memory_types, tick_mode, uptime_hours,
          sync_enabled, cloud_tenant, mcp_tools_called, panel_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    )
    .bind(&ev.instance_id)
    .bind(&ev.event)
    .bind(&ev.version)
    .bind(&ev.os)
    .bind(&ev.integration)
    .bind(&ev.llm_model)
    .bind(ev.node_count)
    .bind(ev.edge_count)
    .bind(&ev.memory_types)
    .bind(&ev.tick_mode)
    .bind(ev.uptime_hours)
    .bind(ev.sync_enabled)
    .bind(&ev.cloud_tenant)
    .bind(ev.mcp_tools_called)
    .bind(ev.panel_active)
    .execute(&*state.pool)
    .await;

    match result {
        Ok(_) => (
            StatusCode::OK,
            Json(TelemetryResponse {
                ok: true,
                message: None,
            }),
        ),
        Err(e) => {
            tracing::warn!("telemetry insert failed: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(TelemetryResponse {
                    ok: false,
                    message: Some("internal error".into()),
                }),
            )
        }
    }
}

/// GET /api/v1/admin/telemetry
///
/// Admin endpoint to view telemetry stats (requires auth).
pub async fn telemetry_stats(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let total_instances =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(DISTINCT instance_id) FROM telemetry_events")
            .fetch_one(&*state.pool)
            .await
            .unwrap_or(0);

    let active_24h = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT instance_id) FROM telemetry_events
         WHERE received_at > now() - interval '24 hours'",
    )
    .fetch_one(&*state.pool)
    .await
    .unwrap_or(0);

    let active_7d = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT instance_id) FROM telemetry_events
         WHERE received_at > now() - interval '7 days'",
    )
    .fetch_one(&*state.pool)
    .await
    .unwrap_or(0);

    // Integration breakdown
    let integrations: Vec<(String, i64)> = sqlx::query_as(
        "SELECT COALESCE(integration, 'unknown'), COUNT(DISTINCT instance_id)
         FROM telemetry_events
         WHERE received_at > now() - interval '30 days'
         GROUP BY integration ORDER BY 2 DESC LIMIT 20",
    )
    .fetch_all(&*state.pool)
    .await
    .unwrap_or_default();

    // Version breakdown
    let versions: Vec<(String, i64)> = sqlx::query_as(
        "SELECT COALESCE(version, 'unknown'), COUNT(DISTINCT instance_id)
         FROM telemetry_events
         WHERE received_at > now() - interval '30 days'
         GROUP BY version ORDER BY 2 DESC LIMIT 10",
    )
    .fetch_all(&*state.pool)
    .await
    .unwrap_or_default();

    // OS breakdown
    let platforms: Vec<(String, i64)> = sqlx::query_as(
        "SELECT COALESCE(os, 'unknown'), COUNT(DISTINCT instance_id)
         FROM telemetry_events
         WHERE received_at > now() - interval '30 days'
         GROUP BY os ORDER BY 2 DESC LIMIT 10",
    )
    .fetch_all(&*state.pool)
    .await
    .unwrap_or_default();

    Json(serde_json::json!({
        "total_instances": total_instances,
        "active_24h": active_24h,
        "active_7d": active_7d,
        "integrations": integrations.into_iter()
            .map(|(k, v)| serde_json::json!({"name": k, "instances": v}))
            .collect::<Vec<_>>(),
        "versions": versions.into_iter()
            .map(|(k, v)| serde_json::json!({"version": k, "instances": v}))
            .collect::<Vec<_>>(),
        "platforms": platforms.into_iter()
            .map(|(k, v)| serde_json::json!({"os": k, "instances": v}))
            .collect::<Vec<_>>(),
    }))
}
