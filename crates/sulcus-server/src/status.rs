//! Public status endpoint — aggregate system health with no PII.
//!
//! Returns server health, aggregate statistics, and uptime information.
//! All data is anonymized — no tenant IDs, emails, or user-identifiable info.

use axum::{extract::State, Json};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::AppState;

/// GET /api/v1/status — public, no auth required.
///
/// Returns aggregate system health metrics suitable for a public status page.
/// No PII is included: only counts, sizes, and timestamps.
pub async fn public_status(State(state): State<Arc<AppState>>) -> Json<Value> {
    let pool = &state.pool;

    // --- Aggregate counts (no tenant filtering = system-wide) ---

    let total_nodes: i64 = sqlx::query_scalar("SELECT count(*) FROM golden_index")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let total_edges: i64 = sqlx::query_scalar("SELECT count(*) FROM golden_edges")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let total_tenants: i64 =
        sqlx::query_scalar("SELECT count(DISTINCT tenant_id) FROM api_keys")
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    let total_triggers: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM triggers WHERE enabled = true",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let total_trigger_fires: i64 = sqlx::query_scalar("SELECT count(*) FROM trigger_history")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let total_ops: i64 = sqlx::query_scalar("SELECT count(*) FROM server_ops")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // Memory type distribution (aggregate, no tenant info)
    let type_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT memory_type, count(*) as cnt FROM golden_index GROUP BY memory_type ORDER BY cnt DESC",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let memory_types: Value = type_rows
        .iter()
        .map(|(t, c)| json!({ "type": t, "count": c }))
        .collect::<Vec<_>>()
        .into();

    // Average heat across all nodes
    let avg_heat: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(current_heat), 0.0)::float8 FROM golden_index",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0.0);

    // Hot nodes (heat > 0.5)
    let hot_nodes: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM golden_index WHERE current_heat > 0.5",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Cold nodes (heat < 0.1)
    let cold_nodes: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM golden_index WHERE current_heat < 0.1",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // DB size
    let db_size_bytes: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // Waitlist count
    let waitlist_count: i64 = sqlx::query_scalar("SELECT count(*) FROM waitlist")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // Server uptime indicator: latest server_ops timestamp
    let latest_op: Option<String> = sqlx::query_scalar(
        "SELECT max(created_at)::text FROM server_ops",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(None);

    // --- AGE graph stats (non-fatal if AGE unavailable) ---
    let age_available = crate::graph::graph_available(pool).await;
    let (age_vertices, age_edges) = if age_available {
        crate::graph::graph_stats(pool).await.unwrap_or((0, 0))
    } else {
        (0, 0)
    };

    Json(json!({
        "status": "operational",
        "version": format!("{}-{}", env!("CARGO_PKG_VERSION"), {
            // Prefer compile-time ref, fall back to runtime env, then "dev"
            let compile_ref = option_env!("SULCUS_BUILD_REF").unwrap_or("dev");
            if compile_ref != "dev" { compile_ref.to_string() }
            else { std::env::var("SULCUS_BUILD_REF").unwrap_or_else(|_| "dev".to_string()) }
        }),
        "checked_at": chrono::Utc::now().to_rfc3339(),

        "graph": {
            "total_nodes": total_nodes,
            "total_edges": total_edges,
            "hot_nodes": hot_nodes,
            "cold_nodes": cold_nodes,
            "average_heat": (avg_heat * 1000.0).round() / 1000.0,
            "memory_types": memory_types,
        },

        "age_graph": {
            "available": age_available,
            "vertices": age_vertices,
            "edges": age_edges,
        },

        "system": {
            "total_agents": total_tenants,
            "total_operations": total_ops,
            "active_triggers": total_triggers,
            "trigger_fires": total_trigger_fires,
            "waitlist_signups": waitlist_count,
            "database_size_mb": (db_size_bytes as f64 / 1_048_576.0 * 10.0).round() / 10.0,
            "last_activity": latest_op,
        },
    }))
}
