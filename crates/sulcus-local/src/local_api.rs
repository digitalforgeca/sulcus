//! Local control panel API — implements the same endpoints as sulcus-server
//! but running against the embedded local Postgres.
//!
//! No auth required — if you can reach localhost, you're the owner.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;

use crate::runtime::AppState;

// ─── Dashboard Stats ────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DashboardStats {
    total_nodes: i64,
    pinned_count: i64,
    avg_heat: f64,
    type_distribution: Vec<TypeCount>,
    heat_distribution: HeatDistribution,
    namespace_counts: Vec<NamespaceCount>,
    recent_nodes: Vec<RecentNode>,
}

#[derive(Serialize)]
struct TypeCount {
    memory_type: String,
    count: i64,
}

#[derive(Serialize)]
struct HeatDistribution {
    frozen: i64,
    cool: i64,
    warm: i64,
    hot: i64,
    blazing: i64,
}

#[derive(Serialize)]
struct NamespaceCount {
    namespace: String,
    count: i64,
}

#[derive(Serialize)]
struct RecentNode {
    id: String,
    label: String,
    memory_type: String,
    heat: f64,
    updated_at: String,
}

pub async fn dashboard_stats(
    State(state): State<Arc<AppState>>,
) -> Result<Json<DashboardStats>, StatusCode> {
    let pool = state.handler.storage().pool();

    let total_nodes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nodes")
        .fetch_one(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let pinned_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nodes WHERE is_pinned = true")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let avg_heat: f64 = sqlx::query_scalar("SELECT COALESCE(AVG(current_heat), 0.0) FROM nodes")
        .fetch_one(pool)
        .await
        .unwrap_or(0.0);

    // Type distribution
    let type_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT memory_type, COUNT(*) FROM nodes GROUP BY memory_type ORDER BY 2 DESC",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let type_distribution: Vec<TypeCount> = type_rows
        .into_iter()
        .map(|(memory_type, count)| TypeCount { memory_type, count })
        .collect();

    // Heat distribution
    let frozen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nodes WHERE current_heat < 0.1")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let cool: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM nodes WHERE current_heat >= 0.1 AND current_heat < 0.3",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    let warm: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM nodes WHERE current_heat >= 0.3 AND current_heat < 0.6",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    let hot: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM nodes WHERE current_heat >= 0.6 AND current_heat < 0.85",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    let blazing: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nodes WHERE current_heat >= 0.85")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // Namespace counts
    let ns_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT COALESCE(namespace, 'default'), COUNT(*) FROM nodes GROUP BY namespace ORDER BY 2 DESC LIMIT 10",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let namespace_counts: Vec<NamespaceCount> = ns_rows
        .into_iter()
        .map(|(namespace, count)| NamespaceCount { namespace, count })
        .collect();

    // Recent nodes
    let recent_rows = sqlx::query(
        "SELECT id, label, memory_type, current_heat, COALESCE(updated_at, created_at) as upd
         FROM nodes ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 10",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let recent_nodes: Vec<RecentNode> = recent_rows
        .iter()
        .map(|r| RecentNode {
            id: r.get::<String, _>("id"),
            label: r.get::<String, _>("label"),
            memory_type: r.get::<String, _>("memory_type"),
            heat: r.get::<f64, _>("current_heat"),
            updated_at: r.get::<String, _>("upd"),
        })
        .collect();

    Ok(Json(DashboardStats {
        total_nodes,
        pinned_count,
        avg_heat,
        type_distribution,
        heat_distribution: HeatDistribution {
            frozen,
            cool,
            warm,
            hot,
            blazing,
        },
        namespace_counts,
        recent_nodes,
    }))
}

// ─── Usage Stats ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct UsageRow {
    month: String,
    sync_requests: i64,
    nodes_added: i64,
    avg_latency_ms: f64,
    max_latency_ms: f64,
}

pub async fn usage_stats(State(state): State<Arc<AppState>>) -> Json<Vec<UsageRow>> {
    let pool = state.handler.storage().pool();

    let ops_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM memory_ops")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let nodes_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nodes")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // For local, we don't track latency — return zeros
    let month = chrono::Utc::now().format("%Y-%m-01").to_string();
    Json(vec![UsageRow {
        month,
        sync_requests: ops_count,
        nodes_added: nodes_count,
        avg_latency_ms: 0.0,
        max_latency_ms: 0.0,
    }])
}

// ─── List Memories ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ListParams {
    page: Option<i64>,
    page_size: Option<i64>,
    sort: Option<String>,
    order: Option<String>,
    memory_type: Option<String>,
    namespace: Option<String>,
    pinned: Option<bool>,
    search: Option<String>,
}

pub async fn list_memories(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ListParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.handler.storage().pool();
    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(25).min(100);
    let offset = (page - 1) * page_size;
    let sort_col = match params.sort.as_deref() {
        Some("current_heat") | Some("heat") => "current_heat",
        Some("updated_at") | Some("date") => "COALESCE(updated_at, created_at)",
        Some("label") | Some("pointer_summary") => "label",
        Some("memory_type") => "memory_type",
        _ => "current_heat",
    };
    let order = if params.order.as_deref() == Some("asc") {
        "ASC"
    } else {
        "DESC"
    };

    let mut conditions = vec!["1=1".to_string()];
    if let Some(ref mt) = params.memory_type {
        conditions.push(format!("memory_type = '{}'", mt.replace('\'', "''")));
    }
    if let Some(ref ns) = params.namespace {
        conditions.push(format!(
            "COALESCE(namespace,'default') = '{}'",
            ns.replace('\'', "''")
        ));
    }
    if let Some(pinned) = params.pinned {
        conditions.push(format!("is_pinned = {pinned}"));
    }
    if let Some(ref s) = params.search {
        let escaped = s.replace('\'', "''").replace('%', "\\%");
        conditions.push(format!(
            "(label ILIKE '%{escaped}%' OR pointer_summary ILIKE '%{escaped}%')"
        ));
    }
    let where_clause = conditions.join(" AND ");

    let total: i64 =
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM nodes WHERE {where_clause}"))
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    let query = format!(
        "SELECT id, label, pointer_summary, memory_type, current_heat, base_utility,
                is_pinned, COALESCE(namespace,'default') as namespace,
                COALESCE(modality,'text') as modality,
                decay_class, min_heat, ttl_hours,
                created_at, COALESCE(updated_at, created_at) as updated_at
         FROM nodes WHERE {where_clause}
         ORDER BY {sort_col} {order}
         LIMIT {page_size} OFFSET {offset}"
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.get::<String, _>("id"),
                "label": r.get::<String, _>("label"),
                "pointer_summary": r.get::<String, _>("pointer_summary"),
                "memory_type": r.get::<String, _>("memory_type"),
                "current_heat": r.get::<f64, _>("current_heat"),
                "base_utility": r.get::<f64, _>("base_utility"),
                "is_pinned": r.get::<bool, _>("is_pinned"),
                "namespace": r.get::<String, _>("namespace"),
                "modality": r.get::<String, _>("modality"),
                "decay_class": r.get::<String, _>("decay_class"),
                "updated_at": r.get::<String, _>("updated_at"),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    })))
}

// ─── Hot Nodes ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct HotParams {
    limit: Option<i64>,
}

pub async fn hot_nodes(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HotParams>,
) -> Json<Vec<serde_json::Value>> {
    let pool = state.handler.storage().pool();
    let limit = params.limit.unwrap_or(20).min(100);

    let rows = sqlx::query(&format!(
        "SELECT id, label, pointer_summary, memory_type, current_heat, is_pinned
         FROM nodes ORDER BY current_heat DESC LIMIT {limit}"
    ))
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Json(
        rows.iter()
            .map(|r| {
                serde_json::json!({
                    "id": r.get::<String, _>("id"),
                    "label": r.get::<String, _>("label"),
                    "pointer_summary": r.get::<String, _>("pointer_summary"),
                    "memory_type": r.get::<String, _>("memory_type"),
                    "current_heat": r.get::<f64, _>("current_heat"),
                    "is_pinned": r.get::<bool, _>("is_pinned"),
                })
            })
            .collect(),
    )
}

// ─── Text Search ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SearchBody {
    query: String,
    limit: Option<i64>,
}

pub async fn text_search(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SearchBody>,
) -> Json<Vec<serde_json::Value>> {
    let pool = state.handler.storage().pool();
    let limit = body.limit.unwrap_or(20).min(100);
    let escaped = body.query.replace('\'', "''").replace('%', "\\%");

    let rows = sqlx::query(&format!(
        "SELECT id, label, pointer_summary, memory_type, current_heat, is_pinned
         FROM nodes
         WHERE label ILIKE '%{escaped}%' OR pointer_summary ILIKE '%{escaped}%'
         ORDER BY current_heat DESC
         LIMIT {limit}"
    ))
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Json(
        rows.iter()
            .map(|r| {
                serde_json::json!({
                    "id": r.get::<String, _>("id"),
                    "pointer_summary": r.get::<String, _>("pointer_summary"),
                    "memory_type": r.get::<String, _>("memory_type"),
                    "current_heat": r.get::<f64, _>("current_heat"),
                    "is_pinned": r.get::<bool, _>("is_pinned"),
                })
            })
            .collect(),
    )
}

// ─── Metrics ────────────────────────────────────────────────────────────────

pub async fn metrics(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let pool = state.handler.storage().pool();

    let node_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nodes")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let edge_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM edges")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let ops_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM memory_ops")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let db_size: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    Json(serde_json::json!({
        "backend": "embedded-postgres",
        "db_size_bytes": db_size,
        "golden_index_size": node_count,
        "server_ops_count": ops_count,
        "edge_count": edge_count,
        "mode": "local",
    }))
}

// ─── Graph Visualization ────────────────────────────────────────────────────

pub async fn visualize_graph(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let pool = state.handler.storage().pool();

    let nodes = sqlx::query("SELECT id, label, memory_type, current_heat, is_pinned FROM nodes")
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    let edges =
        sqlx::query("SELECT source_id, target_id, edge_weight, relationship_type FROM edges")
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    let node_list: Vec<serde_json::Value> = nodes
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.get::<String, _>("id"),
                "label": r.get::<String, _>("label"),
                "memory_type": r.get::<String, _>("memory_type"),
                "current_heat": r.get::<f64, _>("current_heat"),
                "is_pinned": r.get::<bool, _>("is_pinned"),
            })
        })
        .collect();

    let edge_list: Vec<serde_json::Value> = edges
        .iter()
        .map(|r| {
            serde_json::json!({
                "source": r.get::<String, _>("source_id"),
                "target": r.get::<String, _>("target_id"),
                "weight": r.get::<f64, _>("edge_weight"),
                "type": r.get::<String, _>("relationship_type"),
            })
        })
        .collect();

    Json(serde_json::json!({
        "nodes": node_list,
        "edges": edge_list,
    }))
}

// ─── Activity Log ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ActivityParams {
    limit: Option<i64>,
    offset: Option<i64>,
}

pub async fn list_activity(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ActivityParams>,
) -> Json<serde_json::Value> {
    let pool = state.handler.storage().pool();
    let limit = params.limit.unwrap_or(50).min(200);
    let offset = params.offset.unwrap_or(0);

    let rows = sqlx::query(&format!(
        "SELECT id, op_type, payload, created_at FROM memory_ops
         ORDER BY id DESC LIMIT {limit} OFFSET {offset}"
    ))
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.get::<i64, _>("id"),
                "action": r.get::<String, _>("op_type"),
                "target_id": null,
                "target_label": null,
                "metadata": r.get::<Option<serde_json::Value>, _>("payload"),
                "created_at": r.get::<String, _>("created_at"),
            })
        })
        .collect();

    Json(serde_json::json!({
        "items": items,
        "total": items.len(),
    }))
}

// ─── Single Node CRUD ───────────────────────────────────────────────────────

pub async fn get_node(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.handler.storage().pool();

    let row = sqlx::query(
        "SELECT id, label, pointer_summary, memory_type, current_heat, base_utility,
                is_pinned, COALESCE(namespace,'default') as namespace,
                decay_class, created_at, COALESCE(updated_at, created_at) as updated_at
         FROM nodes WHERE id = $1",
    )
    .bind(&id)
    .fetch_optional(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(serde_json::json!({
        "id": row.get::<String, _>("id"),
        "label": row.get::<String, _>("label"),
        "pointer_summary": row.get::<String, _>("pointer_summary"),
        "memory_type": row.get::<String, _>("memory_type"),
        "current_heat": row.get::<f64, _>("current_heat"),
        "base_utility": row.get::<f64, _>("base_utility"),
        "is_pinned": row.get::<bool, _>("is_pinned"),
        "namespace": row.get::<String, _>("namespace"),
        "decay_class": row.get::<String, _>("decay_class"),
        "updated_at": row.get::<String, _>("updated_at"),
    })))
}

#[derive(Deserialize)]
pub struct PatchNode {
    pointer_summary: Option<String>,
    memory_type: Option<String>,
    is_pinned: Option<bool>,
    current_heat: Option<f64>,
    decay_class: Option<String>,
    namespace: Option<String>,
}

pub async fn patch_node(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(patch): Json<PatchNode>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.handler.storage().pool();

    let mut sets = vec!["updated_at = CURRENT_TIMESTAMP".to_string()];
    if let Some(ref ps) = patch.pointer_summary {
        sets.push(format!("pointer_summary = '{}'", ps.replace('\'', "''")));
        sets.push(format!("label = '{}'", ps.replace('\'', "''")));
    }
    if let Some(ref mt) = patch.memory_type {
        sets.push(format!("memory_type = '{}'", mt.replace('\'', "''")));
    }
    if let Some(p) = patch.is_pinned {
        sets.push(format!("is_pinned = {p}"));
    }
    if let Some(h) = patch.current_heat {
        sets.push(format!("current_heat = {h}"));
    }
    if let Some(ref dc) = patch.decay_class {
        sets.push(format!("decay_class = '{}'", dc.replace('\'', "''")));
    }
    if let Some(ref ns) = patch.namespace {
        sets.push(format!("namespace = '{}'", ns.replace('\'', "''")));
    }

    let set_clause = sets.join(", ");
    sqlx::query(&format!("UPDATE nodes SET {set_clause} WHERE id = $1"))
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Return updated node
    get_node(State(state), Path(id)).await
}

pub async fn delete_node(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> StatusCode {
    let pool = state.handler.storage().pool();

    let result = sqlx::query("DELETE FROM nodes WHERE id = $1")
        .bind(&id)
        .execute(pool)
        .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => StatusCode::NO_CONTENT,
        Ok(_) => StatusCode::NOT_FOUND,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

// ─── Paywall Stub ───────────────────────────────────────────────────────────

pub async fn upgrade_required() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::PAYMENT_REQUIRED,
        Json(serde_json::json!({
            "error": "upgrade_required",
            "message": "Available on Sulcus Cloud",
            "upgrade_url": "https://sulcus.dforge.ca",
        })),
    )
}

// ─── Local Info ─────────────────────────────────────────────────────────────

pub async fn local_info() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "mode": "local",
        "version": env!("CARGO_PKG_VERSION"),
        "tenant_id": "local",
        "org_name": null,
        "plan_tier": "local",
        "max_seats": 1,
        "seats_used": 1,
        "features": "local_panel,thermo_config",
        "ops_limit": null,
        "nodes_limit": null,
        "members": [],
    }))
}
