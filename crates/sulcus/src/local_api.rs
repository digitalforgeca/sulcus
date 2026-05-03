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
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::runtime::AppState;

// ─── Tier Cache ─────────────────────────────────────────────────────────────

struct CachedTier {
    plan_tier: String,
    features: String,
    fetched_at: Instant,
}

static TIER_CACHE: OnceLock<tokio::sync::Mutex<Option<CachedTier>>> = OnceLock::new();

async fn get_cached_tier() -> (String, String) {
    let cache = TIER_CACHE.get_or_init(|| tokio::sync::Mutex::new(None));
    let mut guard = cache.lock().await;

    if let Some(ref cached) = *guard {
        if cached.fetched_at.elapsed() < Duration::from_secs(3600) {
            return (cached.plan_tier.clone(), cached.features.clone());
        }
    }

    let server_url = std::env::var("SULCUS_SERVER_URL").ok();
    let api_key = std::env::var("SULCUS_API_KEY").ok();

    if let (Some(url), Some(key)) = (server_url, api_key) {
        if let Ok(resp) = reqwest::Client::new()
            .get(format!("{}/api/v1/org", url))
            .header("Authorization", format!("Bearer {}", key))
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                let tier = data["plan_tier"].as_str().unwrap_or("local").to_string();
                let features = data["features"]
                    .as_str()
                    .unwrap_or("local_panel,thermo_config")
                    .to_string();
                *guard = Some(CachedTier {
                    plan_tier: tier.clone(),
                    features: features.clone(),
                    fetched_at: Instant::now(),
                });
                return (tier, features);
            }
        }
    }

    ("local".to_string(), "local_panel,thermo_config".to_string())
}

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
    namespace: String,
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

    let avg_heat: f64 =
        sqlx::query_scalar("SELECT COALESCE(AVG(current_heat::float8), 0.0) FROM nodes")
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
        "SELECT id, label, pointer_summary, memory_type, namespace, current_heat, COALESCE(updated_at, created_at) as upd
         FROM nodes ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 10",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let recent_nodes: Vec<RecentNode> = recent_rows
        .iter()
        .map(|r| {
            let label: String = r.get("label");
            let summary: String = r.get("pointer_summary");
            let namespace: String = r.get("namespace");
            // Use pointer_summary when label is just "Synthesis: {ns}" or unhelpful
            let display = if label.starts_with("Synthesis:") || label.is_empty() {
                if summary.is_empty() {
                    label.clone()
                } else {
                    summary
                }
            } else {
                label
            };
            RecentNode {
                id: r.get::<String, _>("id"),
                label: display,
                memory_type: r.get::<String, _>("memory_type"),
                namespace,
                heat: r.get::<f32, _>("current_heat") as f64,
                updated_at: r.get::<String, _>("upd"),
            }
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
                "current_heat": r.get::<f32, _>("current_heat") as f64,
                "base_utility": r.get::<f32, _>("base_utility") as f64,
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
                    "current_heat": r.get::<f32, _>("current_heat") as f64,
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
                    "current_heat": r.get::<f32, _>("current_heat") as f64,
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
        "version": env!("CARGO_PKG_VERSION"),
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
                "current_heat": r.get::<f32, _>("current_heat") as f64,
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
                "weight": r.get::<f32, _>("edge_weight") as f64,
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
        "current_heat": row.get::<f32, _>("current_heat") as f64,
        "base_utility": row.get::<f32, _>("base_utility") as f64,
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

// ─── Create Memory ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateMemory {
    pub label: String,
    pub memory_type: Option<String>,
    pub heat: Option<f64>,
    pub namespace: Option<String>,
}

pub async fn create_node(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateMemory>,
) -> Result<(StatusCode, Json<serde_json::Value>), StatusCode> {
    let pool = state.handler.storage().pool();
    let id = uuid::Uuid::now_v7().to_string();
    let memory_type = body.memory_type.unwrap_or_else(|| "episodic".into());
    let heat = body.heat.unwrap_or(0.8) as f32;
    let namespace = body.namespace.unwrap_or_else(|| "default".into());

    sqlx::query(
        "INSERT INTO nodes (id, label, pointer_summary, memory_type, current_heat, namespace, decay_class, modality)
         VALUES ($1, $2, $2, $3, $4, $5, 'normal', 'text')",
    )
    .bind(&id)
    .bind(&body.label)
    .bind(&memory_type)
    .bind(heat)
    .bind(&namespace)
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "create_node failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "label": body.label,
            "memory_type": memory_type,
            "heat": heat,
            "namespace": namespace,
        })),
    ))
}

// ─── Paywall Stub ───────────────────────────────────────────────────────────

pub async fn upgrade_required() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::PAYMENT_REQUIRED,
        Json(serde_json::json!({
            "error": "upgrade_required",
            "message": "Available on Sulcus Cloud",
            "upgrade_url": "https://sulcus.ca",
        })),
    )
}

// ─── Local Info ─────────────────────────────────────────────────────────────

pub async fn local_info() -> Json<serde_json::Value> {
    let (plan_tier, features) = get_cached_tier().await;
    Json(serde_json::json!({
        "mode": "local",
        "version": env!("CARGO_PKG_VERSION"),
        "tenant_id": "local",
        "org_name": null,
        "plan_tier": plan_tier,
        "max_seats": 1,
        "seats_used": 1,
        "features": features,
        "ops_limit": null,
        "nodes_limit": null,
        "members": [],
    }))
}

// ─── Thermo Config ──────────────────────────────────────────────────────────

/// GET /api/v1/settings/thermo — returns the current thermodynamic configuration.
pub async fn get_thermo_config(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let pool = state.handler.storage().pool();
    let row: Option<(serde_json::Value,)> =
        sqlx::query_as("SELECT config FROM thermo_config WHERE tenant_id = 'local'")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    let config: sulcus_core::thermo::ThermoConfig = match row {
        Some((val,)) => serde_json::from_value(val).unwrap_or_default(),
        None => sulcus_core::thermo::ThermoConfig::default(),
    };
    Json(serde_json::json!({ "config": config }))
}

/// PATCH /api/v1/settings/thermo — update thermodynamic configuration.
/// Accepts a full ThermoConfig JSON body. Validates and persists to local DB.
/// The background worker picks up changes within ~10 tick cycles.
pub async fn patch_thermo_config(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Validate by deserializing
    let config: sulcus_core::thermo::ThermoConfig = serde_json::from_value(body).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": format!("Invalid config: {e}")
            })),
        )
    })?;
    let pool = state.handler.storage().pool();
    sqlx::query(
        "INSERT INTO thermo_config (tenant_id, config, updated_at) \
         VALUES ('local', $1, NOW()) \
         ON CONFLICT (tenant_id) DO UPDATE SET config = $1, updated_at = NOW()",
    )
    .bind(serde_json::to_value(&config).unwrap())
    .execute(pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("DB error: {e}") })),
        )
    })?;
    Ok(Json(serde_json::json!({ "config": config })))
}

// ─── Trigger CRUD ───────────────────────────────────────────────────────────

/// GET /api/v1/triggers — list all triggers.
pub async fn list_triggers(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let pool = state.handler.storage().pool();
    let rows = sqlx::query(
        "SELECT id, namespace, name, description, enabled, event, action, action_config, \
         filter_memory_type, filter_namespace, filter_label_pattern, \
         filter_heat_below, filter_heat_above, max_fires, fire_count, \
         cooldown_seconds, last_fired_at, created_at \
         FROM triggers ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let triggers: Vec<serde_json::Value> = rows.iter().map(|r| {
        serde_json::json!({
            "id": r.try_get::<String, _>("id").unwrap_or_default(),
            "namespace": r.try_get::<String, _>("namespace").unwrap_or_default(),
            "name": r.try_get::<String, _>("name").unwrap_or_default(),
            "description": r.try_get::<String, _>("description").unwrap_or_default(),
            "enabled": r.try_get::<bool, _>("enabled").unwrap_or(true),
            "event": r.try_get::<String, _>("event").unwrap_or_default(),
            "action": r.try_get::<String, _>("action").unwrap_or_default(),
            "action_config": r.try_get::<serde_json::Value, _>("action_config").unwrap_or(serde_json::json!({})),
            "filters": {
                "memory_type": r.try_get::<Option<String>, _>("filter_memory_type").unwrap_or(None),
                "namespace": r.try_get::<Option<String>, _>("filter_namespace").unwrap_or(None),
                "label_pattern": r.try_get::<Option<String>, _>("filter_label_pattern").unwrap_or(None),
                "heat_below": r.try_get::<Option<f32>, _>("filter_heat_below").unwrap_or(None),
                "heat_above": r.try_get::<Option<f32>, _>("filter_heat_above").unwrap_or(None),
            },
            "max_fires": r.try_get::<Option<i32>, _>("max_fires").unwrap_or(None),
            "fire_count": r.try_get::<i32, _>("fire_count").unwrap_or(0),
            "cooldown_seconds": r.try_get::<i32, _>("cooldown_seconds").unwrap_or(0),
            "last_fired_at": r.try_get::<Option<String>, _>("last_fired_at").unwrap_or(None),
            "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
        })
    }).collect();

    Json(serde_json::json!({ "triggers": triggers, "count": triggers.len() }))
}

/// POST /api/v1/triggers — create a trigger.
pub async fn create_trigger(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let event = body.get("event").and_then(|v| v.as_str()).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "missing event"})),
        )
    })?;
    let action = body.get("action").and_then(|v| v.as_str()).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "missing action"})),
        )
    })?;

    let id = uuid::Uuid::now_v7().to_string();
    let description = body
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let action_config = body
        .get("action_config")
        .cloned()
        .unwrap_or(serde_json::json!({}));
    let filter_memory_type = body.get("filter_memory_type").and_then(|v| v.as_str());
    let filter_namespace = body.get("filter_namespace").and_then(|v| v.as_str());
    let filter_label_pattern = body.get("filter_label_pattern").and_then(|v| v.as_str());
    let filter_heat_below: Option<f32> = body
        .get("filter_heat_below")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32);
    let filter_heat_above: Option<f32> = body
        .get("filter_heat_above")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32);
    let max_fires: Option<i32> = body
        .get("max_fires")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let cooldown: i32 = body
        .get("cooldown_seconds")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let namespace = body
        .get("namespace")
        .and_then(|v| v.as_str())
        .unwrap_or("default");

    let pool = state.handler.storage().pool();
    sqlx::query(
        "INSERT INTO triggers (id, namespace, name, description, event, action, action_config, \
         filter_memory_type, filter_namespace, filter_label_pattern, \
         filter_heat_below, filter_heat_above, max_fires, cooldown_seconds) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    )
    .bind(&id)
    .bind(namespace)
    .bind(name)
    .bind(description)
    .bind(event)
    .bind(action)
    .bind(&action_config)
    .bind(filter_memory_type)
    .bind(filter_namespace)
    .bind(filter_label_pattern)
    .bind(filter_heat_below)
    .bind(filter_heat_above)
    .bind(max_fires)
    .bind(cooldown)
    .execute(pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
    })?;

    Ok(Json(
        serde_json::json!({ "ok": true, "trigger_id": id, "name": name }),
    ))
}

/// PATCH /api/v1/triggers/:id — update a trigger.
pub async fn patch_trigger(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.handler.storage().pool();

    if let Some(enabled) = body.get("enabled").and_then(|v| v.as_bool()) {
        sqlx::query(
            "UPDATE triggers SET enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(enabled)
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    if let Some(name) = body.get("name").and_then(|v| v.as_str()) {
        sqlx::query("UPDATE triggers SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(name)
            .bind(&id)
            .execute(pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    if let Some(config) = body.get("action_config") {
        sqlx::query(
            "UPDATE triggers SET action_config = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(config)
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    if let Some(mf) = body.get("max_fires").and_then(|v| v.as_i64()) {
        sqlx::query(
            "UPDATE triggers SET max_fires = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(mf as i32)
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    if let Some(cs) = body.get("cooldown_seconds").and_then(|v| v.as_i64()) {
        sqlx::query("UPDATE triggers SET cooldown_seconds = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(cs as i32).bind(&id).execute(pool).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    if body
        .get("reset_fire_count")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        sqlx::query(
            "UPDATE triggers SET fire_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        )
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    Ok(Json(serde_json::json!({ "ok": true, "trigger_id": id })))
}

/// DELETE /api/v1/triggers/:id — delete a trigger and its history.
pub async fn delete_trigger(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> StatusCode {
    let pool = state.handler.storage().pool();
    let result = sqlx::query("DELETE FROM triggers WHERE id = $1")
        .bind(&id)
        .execute(pool)
        .await;
    match result {
        Ok(r) if r.rows_affected() > 0 => StatusCode::NO_CONTENT,
        _ => StatusCode::NOT_FOUND,
    }
}

/// GET /api/v1/triggers/history — trigger firing history.
pub async fn trigger_history(
    State(state): State<Arc<AppState>>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let limit: i32 = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);
    let trigger_id = params.get("trigger_id");

    let pool = state.handler.storage().pool();
    let rows = if let Some(tid) = trigger_id {
        sqlx::query(
            "SELECT id, trigger_id, event, node_id, action, action_result, fired_at \
             FROM trigger_log WHERE trigger_id = $1 ORDER BY fired_at DESC LIMIT $2",
        )
        .bind(tid)
        .bind(limit)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query(
            "SELECT id, trigger_id, event, node_id, action, action_result, fired_at \
             FROM trigger_log ORDER BY fired_at DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    };

    let history: Vec<serde_json::Value> = rows.iter().map(|r| {
        serde_json::json!({
            "id": r.try_get::<String, _>("id").unwrap_or_default(),
            "trigger_id": r.try_get::<String, _>("trigger_id").unwrap_or_default(),
            "event": r.try_get::<String, _>("event").unwrap_or_default(),
            "node_id": r.try_get::<Option<String>, _>("node_id").unwrap_or(None),
            "action": r.try_get::<String, _>("action").unwrap_or_default(),
            "result": r.try_get::<serde_json::Value, _>("action_result").unwrap_or(serde_json::json!({})),
            "fired_at": r.try_get::<String, _>("fired_at").unwrap_or_default(),
        })
    }).collect();

    Json(serde_json::json!({ "history": history, "count": history.len() }))
}

// ─── SIU Config ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SiuConfig {
    pub enabled: bool,
    pub confidence_threshold: f64,
    pub auto_reclassify: bool,
    pub extract_details: bool,
    pub type_overrides: std::collections::HashMap<String, String>,
}

impl Default for SiuConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            confidence_threshold: 0.7,
            auto_reclassify: false,
            extract_details: true,
            type_overrides: std::collections::HashMap::new(),
        }
    }
}

/// GET /api/v1/settings/siu — returns current SIU config (feature-gated).
pub async fn get_siu_config(State(state): State<Arc<AppState>>) -> (StatusCode, Json<serde_json::Value>) {
    let (_, features) = get_cached_tier().await;
    if !features.contains("siu_classifier") {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "feature_not_available",
                "message": "SIU classifier requires a Neuron plan or higher.",
                "upgrade_url": "https://sulcus.ca/pricing"
            })),
        );
    }

    let pool = state.handler.storage().pool();
    let row: Option<(serde_json::Value,)> =
        sqlx::query_as("SELECT config FROM siu_config WHERE tenant_id = 'local'")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();

    let config: SiuConfig = match row {
        Some((ref val,)) => serde_json::from_value(val.clone()).unwrap_or_default(),
        None => SiuConfig::default(),
    };

    let defaults = SiuConfig::default();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "config": config,
            "defaults": defaults,
            "custom": row.is_some(),
        })),
    )
}

/// PATCH /api/v1/settings/siu — update SIU config (feature-gated).
pub async fn patch_siu_config(
    State(state): State<Arc<AppState>>,
    Json(config): Json<SiuConfig>,
) -> (StatusCode, Json<serde_json::Value>) {
    let (_, features) = get_cached_tier().await;
    if !features.contains("siu_classifier") {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "feature_not_available",
                "message": "SIU classifier requires a Neuron plan or higher.",
            })),
        );
    }

    if config.confidence_threshold < 0.0 || config.confidence_threshold > 1.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "invalid_threshold",
                "message": "Confidence threshold must be between 0.0 and 1.0",
            })),
        );
    }

    let pool = state.handler.storage().pool();
    let json_val = serde_json::to_value(&config).unwrap_or_default();

    let result = sqlx::query(
        "INSERT INTO siu_config (tenant_id, config) VALUES ('local', $1) \
         ON CONFLICT (tenant_id) DO UPDATE SET config = $1, updated_at = now()",
    )
    .bind(&json_val)
    .execute(pool)
    .await;

    match result {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "config": config,
                "saved": true,
            })),
        ),
        Err(e) => {
            tracing::error!(error = %e, "failed to save local SIU config");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "database_error" })),
            )
        }
    }
}

// ─── Memory Status (openclaw-sulcus plugin compat) ───────────────────────────

/// GET /api/v1/agent/memory/status
/// Local equivalent of the cloud server's memory status endpoint.
/// Returns basic node counts and backend info so the openclaw-sulcus plugin's
/// `memory_status` tool works when connected to a local sidecar.
pub async fn memory_status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let pool = state.handler.storage().pool();

    let total_memories: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nodes WHERE deleted_at IS NULL")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let hot_memories: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nodes WHERE current_heat >= 0.3 AND deleted_at IS NULL")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let cold_memories: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nodes WHERE current_heat < 0.3 AND deleted_at IS NULL")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let pinned_memories: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nodes WHERE is_pinned = true AND deleted_at IS NULL")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // Type breakdown
    let type_rows = sqlx::query(
        "SELECT memory_type, COUNT(*) as cnt FROM nodes WHERE deleted_at IS NULL GROUP BY memory_type"
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut by_type = serde_json::Map::new();
    for row in &type_rows {
        let mtype: String = row.get("memory_type");
        let cnt: i64 = row.get("cnt");
        by_type.insert(mtype, serde_json::Value::Number(cnt.into()));
    }

    Json(serde_json::json!({
        "backend": "local",
        "ok": true,
        "mode": "local-sidecar",
        "version": env!("CARGO_PKG_VERSION"),
        "namespace_memories": total_memories,
        "total_memories": total_memories,
        "hot_memories": hot_memories,
        "cold_memories": cold_memories,
        "pinned_memories": pinned_memories,
        "memories_by_type": by_type,
        "capabilities": {
            "graph": true,
            "triggers": true,
            "siu": false,
            "entity_expansion": false,
            "recall_log": false,
            "boost_batch": false,
            "hot_context": false,
        },
        "note": "Local sidecar mode — cloud-only features (SIVU, entity expansion, boost-batch, recall-log) are unavailable."
    }))
}
