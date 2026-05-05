//! Apache AGE graph integration — self-healing vertex sync + Cypher traversal.
//!
//! The `sulcus_graph` was created by migration 0029 but never wired in.
//! This module provides:
//!   - `ensure_memory_vertex()` — idempotent upsert of Memory nodes into AGE
//!   - `ensure_entity_vertex()` — idempotent upsert of Entity nodes into AGE
//!   - `ensure_graph_edge()` — idempotent edge creation with temporal properties
//!   - `graph_resonance()` — Cypher-based heat diffusion (replaces BFS loop)
//!   - `temporal_query()` — "what did this agent know at time T?"
//!
//! ## Self-Healing Pattern
//!
//! No batch backfill migration. Instead, every read/write path calls
//! `ensure_*` which MERGEs into the graph. The graph populates itself
//! through normal operation — hot memories get synced first because
//! they're recalled most often.
//!
//! ## golden_index remains authoritative
//!
//! The relational table is still the source of truth for memory content,
//! heat, and metadata. The AGE graph is the relationship/traversal layer.
//! Graph write failures are logged but never block the relational path.

use sqlx::{Executor, PgPool, Row};
use tracing;

// ---------------------------------------------------------------------------
// AGE helper: run a Cypher query via ag_catalog
// ---------------------------------------------------------------------------

/// Execute a Cypher query against sulcus_graph.
///
/// AGE requires `ag_catalog` on the search path. We acquire a raw
/// connection and run the SET + Cypher as separate statements to avoid
/// the "cannot insert multiple commands into a prepared statement" error
/// that sqlx triggers when combining them in a single query string.
/// Maximum time any single Cypher query may run before Postgres kills it.
const CYPHER_STATEMENT_TIMEOUT_MS: u32 = 5_000;

async fn cypher_exec(pool: &PgPool, cypher: &str) -> anyhow::Result<u64> {
    let mut conn = pool.acquire().await?;

    // Set search path + statement timeout so runaway graph traversals
    // are killed by Postgres rather than holding connections indefinitely.
    conn.execute(sqlx::raw_sql(&format!(
        "SET search_path = ag_catalog, \"$user\", public; SET statement_timeout = {CYPHER_STATEMENT_TIMEOUT_MS}"
    ))).await?;

    // Now execute the Cypher query
    let sql = format!(
        "SELECT * FROM cypher('sulcus_graph', $cypher${}$cypher$) AS (v agtype)",
        cypher
    );
    let result = conn.execute(sqlx::raw_sql(&sql)).await?;
    Ok(result.rows_affected())
}

/// Execute a Cypher query and return results as JSON values.
///
/// AGE requires the column definition list to match the number of RETURN columns.
/// For single-column returns, use this directly.
/// For multi-column returns, use `cypher_query_cols` with explicit column names.
async fn cypher_query(
    pool: &PgPool,
    cypher: &str,
) -> anyhow::Result<Vec<serde_json::Value>> {
    cypher_query_cols(pool, cypher, &["v"]).await
}

/// Execute a Cypher query with explicit column names.
/// Returns one JSON object per row with the column names as keys.
/// For single-column queries, each result is the raw parsed value (not wrapped).
pub(crate) async fn cypher_query_cols(
    pool: &PgPool,
    cypher: &str,
    columns: &[&str],
) -> anyhow::Result<Vec<serde_json::Value>> {
    let mut conn = pool.acquire().await?;

    conn.execute(sqlx::raw_sql(&format!(
        "SET search_path = ag_catalog, \"$user\", public; SET statement_timeout = {CYPHER_STATEMENT_TIMEOUT_MS}"
    ))).await?;

    // Build column definition: (col1 agtype, col2 agtype, ...)
    let col_defs: Vec<String> = columns.iter().map(|c| format!("{c} agtype")).collect();
    let col_selects: Vec<String> = columns.iter().map(|c| format!("{c}::text")).collect();

    let sql = format!(
        "SELECT {} FROM cypher('sulcus_graph', $cypher${}$cypher$) AS ({})",
        col_selects.join(", "),
        cypher,
        col_defs.join(", "),
    );
    let rows = conn.fetch_all(sqlx::raw_sql(&sql)).await?;

    let mut results = Vec::with_capacity(rows.len());
    if columns.len() == 1 {
        // Single column — return raw values (backward compat)
        for row in rows {
            let text: String = row.try_get(0)?;
            if let Ok(val) = serde_json::from_str(&text) {
                results.push(val);
            }
        }
    } else {
        // Multi-column — build JSON objects
        for row in rows {
            let mut obj = serde_json::Map::new();
            for (i, col) in columns.iter().enumerate() {
                let text: String = row.try_get(i)?;
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    obj.insert(col.to_string(), val);
                }
            }
            results.push(serde_json::Value::Object(obj));
        }
    }
    Ok(results)
}

// ---------------------------------------------------------------------------
// Self-healing vertex sync
// ---------------------------------------------------------------------------

/// Ensure a Memory vertex exists in the graph. Idempotent via MERGE on id.
///
/// Called on:
///   - Memory store (new memories enter the graph immediately)
///   - Memory recall (self-healing: touched memories get synced)
///
/// Properties stored on the vertex:
///   id, tenant_id, namespace, memory_type, current_heat, summary (first 200 chars),
///   is_pinned, updated_at
pub async fn ensure_memory_vertex(
    pool: &PgPool,
    tenant_id: &str,
    node_id: &uuid::Uuid,
    namespace: &str,
    memory_type: &str,
    current_heat: f32,
    pointer_summary: &str,
    is_pinned: bool,
) {
    let summary = if pointer_summary.len() > 200 {
        // Find a valid UTF-8 char boundary at or before byte 200
        let mut end = 200;
        while end > 0 && !pointer_summary.is_char_boundary(end) {
            end -= 1;
        }
        &pointer_summary[..end]
    } else {
        pointer_summary
    };

    // Escape single quotes for Cypher string literals
    let summary_escaped = summary.replace('\'', "\\'");
    let tenant_escaped = tenant_id.replace('\'', "\\'");
    let ns_escaped = namespace.replace('\'', "\\'");
    let mt_escaped = memory_type.replace('\'', "\\'");

    let cypher = format!(
        "MERGE (m:Memory {{id: '{node_id}'}}) \
         SET m.tenant_id = '{tenant_escaped}', \
             m.namespace = '{ns_escaped}', \
             m.memory_type = '{mt_escaped}', \
             m.current_heat = {current_heat}, \
             m.summary = '{summary_escaped}', \
             m.is_pinned = {is_pinned}, \
             m.is_archived = false, \
             m.updated_at = '{now}' \
         RETURN m",
        node_id = node_id,
        tenant_escaped = tenant_escaped,
        ns_escaped = ns_escaped,
        mt_escaped = mt_escaped,
        current_heat = current_heat,
        summary_escaped = summary_escaped,
        is_pinned = is_pinned,
        now = chrono::Utc::now().to_rfc3339(),
    );

    if let Err(e) = cypher_exec(pool, &cypher).await {
        tracing::warn!(
            node_id = %node_id,
            error = %e,
            "graph: failed to ensure Memory vertex (non-fatal)"
        );
    }
}

/// Mark a Memory vertex as archived in the graph.
///
/// Sets `is_archived = true` and `current_heat = 0`. Used when a memory
/// is soft-deleted (consolidated or forgotten). The vertex remains so that
/// entity traversal can still find cold memories via `graph_cold_query`.
pub async fn archive_memory_vertex(
    pool: &PgPool,
    tenant_id: &str,
    node_id: &uuid::Uuid,
) {
    let tenant_escaped = tenant_id.replace('\'', "\\'");
    let now = chrono::Utc::now().to_rfc3339();

    let cypher = format!(
        "MATCH (m:Memory {{id: '{node_id}', tenant_id: '{tenant_escaped}'}}) \
         SET m.is_archived = true, \
             m.current_heat = 0, \
             m.updated_at = '{now}' \
         RETURN m",
        node_id = node_id,
        tenant_escaped = tenant_escaped,
        now = now,
    );

    if let Err(e) = cypher_exec(pool, &cypher).await {
        tracing::warn!(
            node_id = %node_id,
            error = %e,
            "graph: failed to archive Memory vertex (non-fatal)"
        );
    }
}

/// Result of a cold graph query — archived memory reachable via entity traversal.
#[derive(Debug, serde::Serialize)]
pub struct ColdGraphResult {
    pub node_id: String,
    pub summary: String,
    pub memory_type: String,
    pub archived_heat: f32,
}

/// Query the graph for archived memories reachable via entity traversal.
///
/// Finds Entity vertices whose name contains `topic`, then traverses MENTIONS
/// edges back to Memory vertices that are archived (`is_archived = true`).
/// Used to augment cold-tier search with graph-derived results.
pub async fn graph_cold_query(
    pool: &PgPool,
    tenant_id: &str,
    namespace: &str,
    topic: &str,
    limit: u32,
) -> anyhow::Result<Vec<ColdGraphResult>> {
    let topic_escaped = topic.to_lowercase().replace('\'', "\\'");
    let tenant_escaped = tenant_id.replace('\'', "\\'");
    let ns_escaped = namespace.replace('\'', "\\'");

    let cypher = format!(
        "MATCH (e:Entity {{tenant_id: '{tenant_escaped}', namespace: '{ns_escaped}'}}) \
         WHERE e.name CONTAINS '{topic_escaped}' \
         MATCH (m:Memory)-[:MENTIONS]->(e) \
         WHERE m.tenant_id = '{tenant_escaped}' \
           AND m.is_archived = true \
         RETURN m.id AS node_id, m.summary AS summary, \
                m.memory_type AS memory_type, m.current_heat AS archived_heat \
         LIMIT {limit}",
        tenant_escaped = tenant_escaped,
        ns_escaped = ns_escaped,
        topic_escaped = topic_escaped,
        limit = limit,
    );

    let results = cypher_query_cols(
        pool, &cypher,
        &["node_id", "summary", "memory_type", "archived_heat"],
    ).await?;

    let mut cold_results = Vec::new();
    for val in results {
        let node_id = val.get("node_id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        if node_id.is_empty() {
            continue;
        }
        cold_results.push(ColdGraphResult {
            node_id,
            summary: val.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            memory_type: val.get("memory_type").and_then(|v| v.as_str()).unwrap_or("episodic").to_string(),
            archived_heat: val.get("archived_heat").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
        });
    }

    Ok(cold_results)
}

/// Remove Entity vertices that have no active (non-archived) Memory edges.
///
/// These are orphan entities — their memories have all been archived, so the
/// entity no longer participates in active recall. Returns the number removed.
///
/// Uses a two-pass approach for AGE compatibility:
///   1. Find entity IDs that still have at least one active Memory edge.
///   2. For all tenant entities not in that set, DETACH DELETE.
pub async fn graph_cleanup_orphan_entities(
    pool: &PgPool,
    tenant_id: &str,
    namespace: &str,
) -> anyhow::Result<u32> {
    let tenant_escaped = tenant_id.replace('\'', "\\'");
    let ns_escaped = namespace.replace('\'', "\\'");

    // Pass 1: collect entity IDs that still have an active memory edge
    let active_cypher = format!(
        "MATCH (m:Memory {{tenant_id: '{tenant_escaped}', is_archived: false}})-[:MENTIONS]->(e:Entity {{tenant_id: '{tenant_escaped}', namespace: '{ns_escaped}'}}) \
         RETURN DISTINCT e.id AS eid",
        tenant_escaped = tenant_escaped,
        ns_escaped = ns_escaped,
    );

    let active_results = cypher_query_cols(pool, &active_cypher, &["eid"]).await
        .unwrap_or_default();

    let active_ids: std::collections::HashSet<String> = active_results
        .iter()
        .filter_map(|v| v.get("eid").and_then(|v| v.as_str()).map(String::from))
        .collect();

    // Pass 2: find all entity IDs for this namespace
    let all_cypher = format!(
        "MATCH (e:Entity {{tenant_id: '{tenant_escaped}', namespace: '{ns_escaped}'}}) \
         RETURN e.id AS eid",
        tenant_escaped = tenant_escaped,
        ns_escaped = ns_escaped,
    );

    let all_results = cypher_query_cols(pool, &all_cypher, &["eid"]).await
        .unwrap_or_default();

    let mut removed = 0u32;
    for val in all_results {
        let eid = val.get("eid").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        if eid.is_empty() || active_ids.contains(&eid) {
            continue;
        }

        // Delete edges then vertex (AGE-compatible alternative to DETACH DELETE)
        let del_edges = format!(
            "MATCH (e:Entity {{id: '{eid}'}})-[r]-() DELETE r RETURN r",
            eid = eid.replace('\'', "\\'"),
        );
        let del_vertex = format!(
            "MATCH (e:Entity {{id: '{eid}'}}) DELETE e RETURN e",
            eid = eid.replace('\'', "\\'"),
        );

        let _ = cypher_exec(pool, &del_edges).await;
        if cypher_exec(pool, &del_vertex).await.is_ok() {
            removed += 1;
        }
    }

    if removed > 0 {
        tracing::debug!(
            tenant_id = tenant_id,
            namespace = namespace,
            removed = removed,
            "graph: cleaned up orphan Entity vertices"
        );
    }

    Ok(removed)
}

/// Ensure an Entity vertex exists in the graph. Idempotent via MERGE on id.
///
/// Called from entity_extraction when triples are stored.
pub async fn ensure_entity_vertex(
    pool: &PgPool,
    tenant_id: &str,
    entity_id: &uuid::Uuid,
    namespace: &str,
    name: &str,
    entity_type: &str,
    mention_count: i32,
) {
    let name_escaped = name.replace('\'', "\\'");
    let tenant_escaped = tenant_id.replace('\'', "\\'");
    let ns_escaped = namespace.replace('\'', "\\'");
    let et_escaped = entity_type.replace('\'', "\\'");

    let cypher = format!(
        "MERGE (e:Entity {{id: '{entity_id}'}}) \
         SET e.tenant_id = '{tenant_escaped}', \
             e.namespace = '{ns_escaped}', \
             e.name = '{name_escaped}', \
             e.entity_type = '{et_escaped}', \
             e.mention_count = {mention_count}, \
             e.updated_at = '{now}' \
         RETURN e",
        entity_id = entity_id,
        tenant_escaped = tenant_escaped,
        ns_escaped = ns_escaped,
        name_escaped = name_escaped,
        et_escaped = et_escaped,
        mention_count = mention_count,
        now = chrono::Utc::now().to_rfc3339(),
    );

    if let Err(e) = cypher_exec(pool, &cypher).await {
        tracing::warn!(
            entity_id = %entity_id,
            error = %e,
            "graph: failed to ensure Entity vertex (non-fatal)"
        );
    }
}

// ---------------------------------------------------------------------------
// Self-healing edge sync
// ---------------------------------------------------------------------------

/// Edge types in the graph.
pub enum GraphEdgeType {
    /// Entity → Entity (from SILU triple extraction)
    RelatesTo,
    /// Memory → Entity (memory mentions this entity)
    Mentions,
    /// Memory → Memory (temporal proximity or semantic similarity)
    Temporal,
}

impl GraphEdgeType {
    fn label(&self) -> &str {
        match self {
            Self::RelatesTo => "RELATES_TO",
            Self::Mentions => "MENTIONS",
            Self::Temporal => "TEMPORAL",
        }
    }
}

/// Ensure an edge exists in the graph. Idempotent via MERGE.
///
/// Properties: weight, relationship_label, source_memory_id, created_at, valid_from
pub async fn ensure_graph_edge(
    pool: &PgPool,
    source_id: &uuid::Uuid,
    target_id: &uuid::Uuid,
    edge_type: GraphEdgeType,
    weight: f32,
    relationship_label: Option<&str>,
    source_memory_id: Option<&uuid::Uuid>,
) {
    let edge_label = edge_type.label();
    let rel_label = relationship_label
        .map(|l| l.replace('\'', "\\'"))
        .unwrap_or_default();
    let src_mem = source_memory_id
        .map(|id| id.to_string())
        .unwrap_or_default();
    let now = chrono::Utc::now().to_rfc3339();

    // Determine source/target vertex labels based on edge type
    let (src_label, tgt_label) = match edge_type {
        GraphEdgeType::RelatesTo => ("Entity", "Entity"),
        GraphEdgeType::Mentions => ("Memory", "Entity"),
        GraphEdgeType::Temporal => ("Memory", "Memory"),
    };

    let cypher = format!(
        "MATCH (a:{src_label} {{id: '{source_id}'}}), (b:{tgt_label} {{id: '{target_id}'}}) \
         MERGE (a)-[r:{edge_label}]->(b) \
         SET r.weight = {weight}, \
             r.relationship_label = '{rel_label}', \
             r.source_memory_id = '{src_mem}', \
             r.created_at = COALESCE(r.created_at, '{now}'), \
             r.valid_from = COALESCE(r.valid_from, '{now}'), \
             r.updated_at = '{now}' \
         RETURN r",
        src_label = src_label,
        tgt_label = tgt_label,
        source_id = source_id,
        target_id = target_id,
        edge_label = edge_label,
        weight = weight,
        rel_label = rel_label,
        src_mem = src_mem,
        now = now,
    );

    if let Err(e) = cypher_exec(pool, &cypher).await {
        tracing::debug!(
            source = %source_id,
            target = %target_id,
            edge = edge_label,
            error = %e,
            "graph: failed to ensure edge (non-fatal)"
        );
    }
}

// ---------------------------------------------------------------------------
// Cypher-based resonance (replaces BFS loop in worker.rs)
// ---------------------------------------------------------------------------

/// Apply heat resonance using Cypher variable-length path traversal.
///
/// Instead of the Rust BFS loop that queries `golden_edges` hop-by-hop,
/// this uses a single Cypher query to find all nodes within `max_depth`
/// hops and compute their boost.
///
/// Returns the number of relational nodes updated (heat changes are
/// written back to `golden_index` since it remains authoritative).
pub async fn graph_resonance(
    pool: &PgPool,
    tenant_id: &str,
    source_ids: &[&str],
    spread_factor: f32,
    damping: f32,
    thermal_gate: f32,
    max_depth: u32,
) -> anyhow::Result<u64> {
    if source_ids.is_empty() || spread_factor <= 0.0 {
        return Ok(0);
    }

    let mut total_updated = 0u64;

    for source_id in source_ids {
        // Cypher query: find all nodes within max_depth hops.
        // AGE does not support shortestPath() — use path variable to estimate hops.
        // We use a variable-length relationship and extract path length instead.
        let cypher = format!(
            "MATCH p = (source:Memory {{id: '{source_id}', tenant_id: '{tenant_id}'}}) \
             -[*1..{max_depth}]-(neighbor:Memory) \
             WHERE neighbor.current_heat > {thermal_gate} \
               AND neighbor.id <> '{source_id}' \
               AND neighbor.tenant_id = '{tenant_id}' \
               AND neighbor.is_archived <> true \
             RETURN DISTINCT neighbor.id, neighbor.current_heat",
            source_id = source_id,
            tenant_id = tenant_id.replace('\'', "\\'"),
            max_depth = max_depth,
            thermal_gate = thermal_gate,
        );

        match cypher_query_cols(pool, &cypher, &["nid", "heat"]).await {
            Ok(results) => {
                for val in results {
                    let nid = val.get("nid")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let current_heat = val.get("heat")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0) as f32;
                    let hops = 1i32;

                    if nid.is_empty() {
                        continue;
                    }

                    let hop_factor = spread_factor * damping.powi(hops - 1);
                    if hop_factor < 0.001 {
                        continue;
                    }

                    let boost = hop_factor * (1.0 - current_heat).max(0.0);
                    if boost < 0.001 {
                        continue;
                    }

                    let new_heat = (current_heat + boost).min(1.0);

                    // Write back to golden_index (authoritative store)
                    let result = sqlx::query(
                        "UPDATE golden_index SET current_heat = $1, updated_at = now() \
                         WHERE tenant_id = $2 AND id = $3::uuid \
                         AND is_pinned = false AND current_heat < $1"
                    )
                    .bind(new_heat)
                    .bind(tenant_id)
                    .bind(nid)
                    .execute(pool)
                    .await;

                    if let Ok(r) = result {
                        if r.rows_affected() > 0 {
                            total_updated += 1;
                        }
                    }
                }
            }
            Err(e) => {
                tracing::debug!(
                    source_id = source_id,
                    error = %e,
                    "graph: Cypher resonance failed, will fall back to relational BFS"
                );
                return Err(e);
            }
        }
    }

    if total_updated > 0 {
        tracing::debug!(
            tenant_id = tenant_id,
            nodes_warmed = total_updated,
            "graph: Cypher resonance applied"
        );
    }

    Ok(total_updated)
}

// ---------------------------------------------------------------------------
// Temporal query — "what did this agent know at time T?"
// ---------------------------------------------------------------------------

/// Result of a temporal graph query.
#[derive(Debug, serde::Serialize)]
pub struct TemporalResult {
    pub node_id: String,
    pub memory_type: String,
    pub summary: String,
    pub heat_at_time: f32,
    pub relationship: Option<String>,
    pub hops: u32,
}

/// Query the graph for what an agent knew about a topic at a given time.
///
/// Uses Cypher to find Entity vertices matching the topic, then traverses
/// MENTIONS edges back to Memory vertices, filtering by valid_from <= at_time.
pub async fn temporal_query(
    pool: &PgPool,
    tenant_id: &str,
    namespace: &str,
    topic: &str,
    at_time: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<Vec<TemporalResult>> {
    let topic_escaped = topic.to_lowercase().replace('\'', "\\'");
    let tenant_escaped = tenant_id.replace('\'', "\\'");
    let ns_escaped = namespace.replace('\'', "\\'");
    let time_str = at_time.to_rfc3339();

    let cypher = format!(
        "MATCH (e:Entity {{tenant_id: '{tenant_escaped}', namespace: '{ns_escaped}'}}) \
         WHERE e.name CONTAINS '{topic_escaped}' \
         MATCH (m:Memory)-[r:MENTIONS]->(e) \
         WHERE m.tenant_id = '{tenant_escaped}' \
           AND r.valid_from <= '{time_str}' \
           AND (r.valid_until IS NULL OR r.valid_until > '{time_str}') \
         RETURN m.id AS node_id, m.memory_type AS memory_type, \
                m.summary AS summary, m.current_heat AS heat, \
                r.relationship_label AS relationship \
         ORDER BY m.current_heat DESC \
         LIMIT 20",
        tenant_escaped = tenant_escaped,
        ns_escaped = ns_escaped,
        topic_escaped = topic_escaped,
        time_str = time_str,
    );

    let results = cypher_query_cols(
        pool, &cypher,
        &["node_id", "memory_type", "summary", "heat", "relationship"],
    ).await?;

    let mut temporal_results = Vec::new();
    for val in results {
        temporal_results.push(TemporalResult {
            node_id: val.get("node_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            memory_type: val.get("memory_type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            summary: val.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            heat_at_time: val.get("heat").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
            relationship: val.get("relationship").and_then(|v| v.as_str()).map(String::from),
            hops: 1,
        });
    }

    Ok(temporal_results)
}

// ---------------------------------------------------------------------------
// Graph health check
// ---------------------------------------------------------------------------

/// Quick check: can we execute Cypher queries against sulcus_graph?
pub async fn graph_available(pool: &PgPool) -> bool {
    let result = cypher_exec(pool, "MATCH (n) RETURN count(n)").await;
    result.is_ok()
}

/// Count vertices and edges in the AGE graph.
pub async fn graph_stats(pool: &PgPool) -> anyhow::Result<(u64, u64)> {
    // AGE returns agtype values — count() returns a plain integer, not a JSON object.
    // After v::text cast, we get "0" or "42", not {"cnt": 42}.
    // Try as_u64() directly on the parsed value (it's a JSON number, not an object).
    let vertex_count = cypher_query(pool, "MATCH (n) RETURN count(n)")
        .await?
        .first()
        .and_then(|v| v.as_u64().or_else(|| v.get("cnt").and_then(|c| c.as_u64())))
        .unwrap_or(0);

    let edge_count = cypher_query(pool, "MATCH ()-[r]->() RETURN count(r)")
        .await?
        .first()
        .and_then(|v| v.as_u64().or_else(|| v.get("cnt").and_then(|c| c.as_u64())))
        .unwrap_or(0);

    Ok((vertex_count, edge_count))
}

// ---------------------------------------------------------------------------
// API handler types
// ---------------------------------------------------------------------------

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use std::sync::Arc;

type SharedState = Arc<crate::AppState>;

/// GET /api/v1/agent/graph/status — AGE graph health per-namespace
pub async fn handle_graph_status(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl axum::response::IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;
    let namespace = &tenant_ctx.agent_label;

    let available = graph_available(pool).await;

    if !available {
        return (
            axum::http::StatusCode::OK,
            Json(serde_json::json!({
                "age_graph": {
                    "available": false,
                    "reason": "AGE extension not reachable"
                }
            })),
        );
    }

    let (total_vertices, total_edges) = graph_stats(pool).await.unwrap_or((0, 0));

    // Per-namespace counts
    let tenant_escaped = tenant_id.replace('\'', "\\'");
    let ns_escaped = namespace.replace('\'', "\\'");

    let ns_memory_count = cypher_query(
        pool,
        &format!(
            "MATCH (m:Memory {{tenant_id: '{tenant_escaped}', namespace: '{ns_escaped}'}}) \
             RETURN count(m) AS cnt"
        ),
    )
    .await
    .ok()
    .and_then(|r| r.first().and_then(|v| v.as_u64().or_else(|| v.get("cnt").and_then(|c| c.as_u64()))))
    .unwrap_or(0);

    let ns_entity_count = cypher_query(
        pool,
        &format!(
            "MATCH (e:Entity {{tenant_id: '{tenant_escaped}', namespace: '{ns_escaped}'}}) \
             RETURN count(e) AS cnt"
        ),
    )
    .await
    .ok()
    .and_then(|r| r.first().and_then(|v| v.as_u64().or_else(|| v.get("cnt").and_then(|c| c.as_u64()))))
    .unwrap_or(0);

    let ns_edge_count = cypher_query(
        pool,
        &format!(
            "MATCH (a {{tenant_id: '{tenant_escaped}'}})-[r]->(b) \
             RETURN count(r) AS cnt"
        ),
    )
    .await
    .ok()
    .and_then(|r| r.first().and_then(|v| v.as_u64().or_else(|| v.get("cnt").and_then(|c| c.as_u64()))))
    .unwrap_or(0);

    // Relational comparison for self-healing coverage
    let relational_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM golden_index WHERE tenant_id = $1 AND namespace = $2 AND archived_at IS NULL",
    )
    .bind(tenant_id)
    .bind(namespace)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let relational_entity_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM entities WHERE tenant_id = $1 AND namespace = $2",
    )
    .bind(tenant_id)
    .bind(namespace)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let coverage_pct = if relational_count > 0 {
        ((ns_memory_count as f64 / relational_count as f64) * 100.0).round()
    } else {
        0.0
    };

    (
        axum::http::StatusCode::OK,
        Json(serde_json::json!({
            "age_graph": {
                "available": true,
                "global": {
                    "vertices": total_vertices,
                    "edges": total_edges,
                },
                "namespace": namespace,
                "namespace_stats": {
                    "memory_vertices": ns_memory_count,
                    "entity_vertices": ns_entity_count,
                    "edges": ns_edge_count,
                },
                "relational_comparison": {
                    "golden_index_count": relational_count,
                    "entities_count": relational_entity_count,
                    "graph_coverage_pct": coverage_pct,
                },
            }
        })),
    )
}

/// GET /api/v1/agent/graph/neighbors/:id — what's connected to this memory?
pub async fn handle_graph_neighbors(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Path(node_id): Path<String>,
) -> impl axum::response::IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;

    if !graph_available(pool).await {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "AGE graph not available" })),
        );
    }

    let tenant_escaped = tenant_id.replace('\'', "\\'");
    let id_escaped = node_id.replace('\'', "\\'");

    // Find all direct neighbors.
    // NOTE: AGE may not support labels(), CASE WHEN, COALESCE, or type() —
    // keep the query simple with only property access.
    let cypher = format!(
        "MATCH (source:Memory {{id: '{id_escaped}', tenant_id: '{tenant_escaped}'}})-[r]-(neighbor) \
         RETURN neighbor.id, neighbor.summary, neighbor.name, \
                neighbor.current_heat, neighbor.memory_type, \
                neighbor.entity_type, r.weight, r.relationship_label \
         LIMIT 50",
    );

    match cypher_query_cols(
        pool, &cypher,
        &["id", "summary", "name", "heat", "memory_type", "entity_type", "weight", "relationship"],
    ).await {
        Ok(results) => {
            let neighbors: Vec<serde_json::Value> = results
                .into_iter()
                .map(|v| {
                    // Determine node_type from which property is present
                    let has_summary = v.get("summary").and_then(|v| v.as_str()).is_some();
                    let has_name = v.get("name").and_then(|v| v.as_str()).is_some();
                    let node_type = if v.get("memory_type").and_then(|v| v.as_str()).is_some() {
                        "Memory"
                    } else if v.get("entity_type").and_then(|v| v.as_str()).is_some() {
                        "Entity"
                    } else {
                        "Unknown"
                    };
                    let label = if has_summary {
                        v.get("summary").and_then(|v| v.as_str()).unwrap_or("")
                    } else if has_name {
                        v.get("name").and_then(|v| v.as_str()).unwrap_or("")
                    } else {
                        ""
                    };
                    serde_json::json!({
                        "id": v.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                        "node_type": node_type,
                        "label": label,
                        "heat": v.get("heat").and_then(|v| v.as_f64()),
                        "memory_type": v.get("memory_type").and_then(|v| v.as_str()),
                        "entity_type": v.get("entity_type").and_then(|v| v.as_str()),
                        "weight": v.get("weight").and_then(|v| v.as_f64()),
                        "relationship": v.get("relationship").and_then(|v| v.as_str()),
                    })
                })
                .collect();

            (
                axum::http::StatusCode::OK,
                Json(serde_json::json!({
                    "node_id": node_id,
                    "neighbor_count": neighbors.len(),
                    "neighbors": neighbors,
                })),
            )
        }
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Cypher query failed: {}", e) })),
        ),
    }
}

/// POST /api/v1/agent/graph/temporal — what did this agent know at time T?
#[derive(serde::Deserialize)]
pub struct TemporalQueryRequest {
    pub topic: String,
    pub at_time: Option<String>,
    pub limit: Option<u32>,
}

pub async fn handle_temporal_query(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<TemporalQueryRequest>,
) -> impl axum::response::IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;
    let namespace = &tenant_ctx.agent_label;

    if !graph_available(pool).await {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "AGE graph not available" })),
        );
    }

    let at_time = req
        .at_time
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(chrono::Utc::now);

    match temporal_query(pool, tenant_id, namespace, &req.topic, at_time).await {
        Ok(results) => {
            let items: Vec<serde_json::Value> = results
                .iter()
                .map(|r| {
                    serde_json::json!({
                        "node_id": r.node_id,
                        "memory_type": r.memory_type,
                        "summary": r.summary,
                        "heat_at_time": r.heat_at_time,
                        "relationship": r.relationship,
                    })
                })
                .collect();

            (
                axum::http::StatusCode::OK,
                Json(serde_json::json!({
                    "topic": req.topic,
                    "at_time": at_time.to_rfc3339(),
                    "namespace": namespace,
                    "results": items,
                    "count": items.len(),
                })),
            )
        }
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Temporal query failed: {}", e) })),
        ),
    }
}

/// GET /api/v1/agent/graph/verify/:id — confirm a specific memory exists in AGE
pub async fn handle_graph_verify(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Path(node_id): Path<String>,
) -> impl axum::response::IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;

    if !graph_available(pool).await {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "AGE graph not available" })),
        );
    }

    let tenant_escaped = tenant_id.replace('\'', "\\'");
    let id_escaped = node_id.replace('\'', "\\'");

    // Check AGE for the vertex — try Memory label first, then Entity.
    // AGE requires label-specific matching for property lookups.
    let memory_cypher = format!(
        "MATCH (n:Memory {{id: '{id_escaped}', tenant_id: '{tenant_escaped}'}}) \
         RETURN n.id, n.memory_type, n.current_heat, n.summary, n.updated_at",
    );
    let entity_cypher = format!(
        "MATCH (n:Entity {{id: '{id_escaped}', tenant_id: '{tenant_escaped}'}}) \
         RETURN n.id, n.entity_type, n.current_heat, n.name, n.updated_at",
    );

    // Try Memory first
    let in_graph = match cypher_query_cols(
        pool, &memory_cypher,
        &["id", "memory_type", "heat", "summary", "updated_at"],
    ).await {
        Ok(results) if !results.is_empty() => {
            let v = &results[0];
            Some(serde_json::json!({
                "id": v.get("id").and_then(|v| v.as_str()),
                "node_type": "Memory",
                "memory_type": v.get("memory_type").and_then(|v| v.as_str()),
                "heat": v.get("heat").and_then(|v| v.as_f64()),
                "summary": v.get("summary").and_then(|v| v.as_str()),
                "updated_at": v.get("updated_at").and_then(|v| v.as_str()),
            }))
        }
        _ => {
            // Try Entity
            match cypher_query_cols(
                pool, &entity_cypher,
                &["id", "entity_type", "heat", "name", "updated_at"],
            ).await {
                Ok(results) if !results.is_empty() => {
                    let v = &results[0];
                    Some(serde_json::json!({
                        "id": v.get("id").and_then(|v| v.as_str()),
                        "node_type": "Entity",
                        "entity_type": v.get("entity_type").and_then(|v| v.as_str()),
                        "heat": v.get("heat").and_then(|v| v.as_f64()),
                        "name": v.get("name").and_then(|v| v.as_str()),
                        "updated_at": v.get("updated_at").and_then(|v| v.as_str()),
                    }))
                }
                _ => None,
            }
        }
    };

    // Check relational for comparison
    let in_relational: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid AND archived_at IS NULL) \
         OR EXISTS(SELECT 1 FROM entities WHERE tenant_id = $1 AND id = $2::uuid)",
    )
    .bind(tenant_id)
    .bind(&node_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    let synced = in_graph.is_some();

    (
        axum::http::StatusCode::OK,
        Json(serde_json::json!({
            "node_id": node_id,
            "in_graph": synced,
            "in_relational": in_relational,
            "synced": synced && in_relational,
            "graph_data": in_graph,
        })),
    )
}
