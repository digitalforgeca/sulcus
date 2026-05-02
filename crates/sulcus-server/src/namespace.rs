use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;

use crate::middleware::TenantContext;
use crate::SharedState;

/// GET /api/v1/namespaces/acl — List all namespace ACL rules for the tenant.
pub async fn list_acl(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
) -> impl IntoResponse {
    let rules = match crate::db::list_namespace_acl(&state.pool, &tenant_ctx.id).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "failed to list namespace ACL");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "DB error"}))).into_response();
        }
    };

    let default_policy = crate::db::get_namespace_default(&state.pool, &tenant_ctx.id).await;
    let namespaces = crate::db::list_namespaces(&state.pool, &tenant_ctx.id).await.unwrap_or_default();
    let agents = crate::db::list_agent_labels(&state.pool, &tenant_ctx.id).await.unwrap_or_default();

    Json(json!({
        "rules": rules,
        "default_policy": default_policy,
        "namespaces": namespaces,
        "agents": agents,
    })).into_response()
}

/// POST /api/v1/namespaces/acl — Create or update a namespace ACL rule.
/// Body: { "agent_label": "daedalus", "namespace": "daedalus", "policy": "allow" }
pub async fn upsert_acl(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let agent_label = match payload.get("agent_label").and_then(|v| v.as_str()) {
        Some(l) if !l.is_empty() => l.to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"error": "agent_label required"}))).into_response(),
    };
    let namespace = match payload.get("namespace").and_then(|v| v.as_str()) {
        Some(n) if !n.is_empty() => n.to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"error": "namespace required"}))).into_response(),
    };
    let policy = match payload.get("policy").and_then(|v| v.as_str()) {
        Some("allow") => "allow",
        Some("deny") => "deny",
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"error": "policy must be 'allow' or 'deny'"}))).into_response(),
    };

    if let Err(e) = crate::db::upsert_namespace_acl(&state.pool, &tenant_ctx.id, &agent_label, &namespace, policy).await {
        tracing::error!(error = %e, "failed to upsert namespace ACL");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "DB error"}))).into_response();
    }

    Json(json!({
        "status": "ok",
        "agent_label": agent_label,
        "namespace": namespace,
        "policy": policy,
    })).into_response()
}

/// DELETE /api/v1/namespaces/acl/:id — Delete a namespace ACL rule.
pub async fn delete_acl(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
    axum::extract::Path(rule_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match crate::db::delete_namespace_acl(&state.pool, &tenant_ctx.id, &rule_id).await {
        Ok(true) => Json(json!({"status": "deleted"})).into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, Json(json!({"error": "rule not found"}))).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to delete namespace ACL rule");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "DB error"}))).into_response()
        }
    }
}

/// PUT /api/v1/namespaces/default — Set the tenant-level default namespace policy.
/// Body: { "default_policy": "allow" | "deny" }
pub async fn set_default(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let policy = match payload.get("default_policy").and_then(|v| v.as_str()) {
        Some("allow") => "allow",
        Some("deny") => "deny",
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"error": "default_policy must be 'allow' or 'deny'"}))).into_response(),
    };

    if let Err(e) = crate::db::set_namespace_default(&state.pool, &tenant_ctx.id, policy).await {
        tracing::error!(error = %e, "failed to set namespace default");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "DB error"}))).into_response();
    }

    Json(json!({
        "status": "ok",
        "default_policy": policy,
    })).into_response()
}

// ═══════════════════════════════════════════════════════════════
// Agent / Namespace Management
// ═══════════════════════════════════════════════════════════════

/// Summary of an agent namespace for the management dashboard.
#[derive(Serialize)]
pub struct AgentSummary {
    pub namespace: String,
    pub memory_count: i64,
    pub hot_count: i64,
    pub cold_count: i64,
    pub archived_count: i64,
    pub pinned_count: i64,
    pub avg_heat: f64,
    pub graph_vertices: i64,
    pub graph_edges: i64,
    pub last_activity: Option<String>,
    pub memory_types: serde_json::Value,
}

/// GET /api/v1/admin/agents — List all agent namespaces with stats.
pub async fn list_agents(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
) -> impl IntoResponse {
    let tenant_id = &tenant_ctx.id;
    let pool = &state.pool;

    // Get per-namespace stats in one query
    let rows = match sqlx::query(
        "SELECT \
            namespace, \
            COUNT(*) as memory_count, \
            COUNT(*) FILTER (WHERE current_heat >= 0.3 AND archived_at IS NULL) as hot_count, \
            COUNT(*) FILTER (WHERE current_heat < 0.3 AND archived_at IS NULL) as cold_count, \
            COUNT(*) FILTER (WHERE archived_at IS NOT NULL) as archived_count, \
            COUNT(*) FILTER (WHERE is_pinned = true) as pinned_count, \
            COALESCE(AVG(current_heat), 0) as avg_heat, \
            MAX(updated_at) as last_activity, \
            jsonb_object_agg( \
                COALESCE(memory_type, 'unknown'), type_count \
            ) FILTER (WHERE memory_type IS NOT NULL) as memory_types \
         FROM golden_index \
         LEFT JOIN LATERAL ( \
            SELECT memory_type as mt, COUNT(*) as type_count \
            FROM golden_index g2 \
            WHERE g2.tenant_id = golden_index.tenant_id AND g2.namespace = golden_index.namespace \
            GROUP BY memory_type \
         ) tc ON true \
         WHERE tenant_id = $1 \
         GROUP BY namespace \
         ORDER BY namespace"
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await {
        Ok(r) => r,
        Err(_) => {
            // Fallback to simpler query if the lateral join is too complex
            match sqlx::query(
                "SELECT \
                    namespace, \
                    COUNT(*) as memory_count, \
                    COUNT(*) FILTER (WHERE current_heat >= 0.3 AND archived_at IS NULL) as hot_count, \
                    COUNT(*) FILTER (WHERE current_heat < 0.3 AND archived_at IS NULL) as cold_count, \
                    COUNT(*) FILTER (WHERE archived_at IS NOT NULL) as archived_count, \
                    COUNT(*) FILTER (WHERE is_pinned = true) as pinned_count, \
                    COALESCE(AVG(current_heat), 0) as avg_heat, \
                    MAX(updated_at) as last_activity \
                 FROM golden_index \
                 WHERE tenant_id = $1 \
                 GROUP BY namespace \
                 ORDER BY namespace"
            )
            .bind(tenant_id)
            .fetch_all(pool)
            .await {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!(error = %e, "failed to list agents");
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "DB error"}))).into_response();
                }
            }
        }
    };

    // Get suspension status per namespace
    let suspension_rows = sqlx::query(
        "SELECT namespace, suspended_at, suspended_by \
         FROM namespace_counters WHERE tenant_id = $1 AND suspended_at IS NOT NULL"
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut suspension_map: std::collections::HashMap<String, (Option<chrono::DateTime<chrono::Utc>>, Option<String>)> = std::collections::HashMap::new();
    for row in &suspension_rows {
        let ns: String = row.get("namespace");
        let at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("suspended_at").ok().flatten();
        let by: Option<String> = row.try_get("suspended_by").ok().flatten();
        suspension_map.insert(ns, (at, by));
    }

    // Get per-namespace memory type breakdown separately (cleaner than lateral join)
    let type_rows = sqlx::query(
        "SELECT namespace, COALESCE(memory_type, 'unknown') as mt, COUNT(*) as cnt \
         FROM golden_index WHERE tenant_id = $1 \
         GROUP BY namespace, memory_type ORDER BY namespace, cnt DESC"
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut type_map: std::collections::HashMap<String, serde_json::Value> = std::collections::HashMap::new();
    for row in &type_rows {
        let ns: String = row.get("namespace");
        let mt: String = row.get("mt");
        let cnt: i64 = row.get("cnt");
        let entry = type_map.entry(ns).or_insert_with(|| json!({}));
        if let Some(obj) = entry.as_object_mut() {
            obj.insert(mt, json!(cnt));
        }
    }

    // Get graph vertex/edge counts per namespace (via AGE if available)
    let graph_stats = get_graph_stats_per_namespace(pool, tenant_id).await;

    let agents: Vec<serde_json::Value> = rows.iter().map(|row| {
        let ns: String = row.get("namespace");
        let last_activity: Option<chrono::DateTime<chrono::Utc>> = row.try_get("last_activity").ok();
        let (vertices, edges) = graph_stats.get(&ns).copied().unwrap_or((0, 0));
        let types = type_map.get(&ns).cloned().unwrap_or(json!({}));

        let (susp_at, susp_by) = suspension_map.get(&ns)
            .cloned()
            .unwrap_or((None, None));
        json!({
            "namespace": ns,
            "memory_count": row.get::<i64, _>("memory_count"),
            "hot_count": row.get::<i64, _>("hot_count"),
            "cold_count": row.get::<i64, _>("cold_count"),
            "archived_count": row.get::<i64, _>("archived_count"),
            "pinned_count": row.get::<i64, _>("pinned_count"),
            "avg_heat": row.get::<f64, _>("avg_heat"),
            "graph_vertices": vertices,
            "graph_edges": edges,
            "last_activity": last_activity.map(|t| t.to_rfc3339()),
            "memory_types": types,
            "suspended": susp_at.is_some(),
            "suspended_at": susp_at.map(|t| t.to_rfc3339()),
            "suspended_by": susp_by,
        })
    }).collect();

    Json(json!({ "agents": agents })).into_response()
}

/// Helper: get graph vertex/edge counts per namespace.
async fn get_graph_stats_per_namespace(
    pool: &sqlx::PgPool,
    tenant_id: &str,
) -> std::collections::HashMap<String, (i64, i64)> {
    let mut stats = std::collections::HashMap::new();

    // Try getting vertex counts from AGE graph
    let vertex_rows = sqlx::query(
        "SELECT namespace, COUNT(*) as cnt FROM golden_index \
         WHERE tenant_id = $1 AND archived_at IS NULL \
         GROUP BY namespace"
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for row in &vertex_rows {
        let ns: String = row.get("namespace");
        let cnt: i64 = row.get("cnt");
        stats.insert(ns, (cnt, 0));
    }

    // Edge counts from golden_edges
    let edge_rows = sqlx::query(
        "SELECT g.namespace, COUNT(e.*) as cnt \
         FROM golden_edges e \
         JOIN golden_index g ON e.tenant_id = g.tenant_id AND e.source_id = g.id \
         WHERE e.tenant_id = $1 \
         GROUP BY g.namespace"
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for row in &edge_rows {
        let ns: String = row.get("namespace");
        let cnt: i64 = row.get("cnt");
        stats.entry(ns).and_modify(|(_, e)| *e = cnt).or_insert((0, cnt));
    }

    stats
}

/// POST /api/v1/admin/agents/merge — Merge one namespace into another.
/// Body: { "source": "thor", "target": "Thor", "delete_source_after": true }
///
/// Rewrites namespace on all source memories → target.
/// Optionally deletes source namespace data after merge.
#[derive(Deserialize)]
pub struct MergeRequest {
    pub source: String,
    pub target: String,
    #[serde(default = "default_true")]
    pub delete_source_after: bool,
}

fn default_true() -> bool { true }

pub async fn merge_agents(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
    Json(req): Json<MergeRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;

    // Sanitize namespaces
    let source = crate::middleware::sanitize_namespace(&req.source);
    let target = crate::middleware::sanitize_namespace(&req.target);

    if source == target {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "error": "source and target must be different namespaces"
        }))).into_response();
    }

    // Verify source has memories
    let source_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM golden_index WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&source)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if source_count == 0 {
        return (StatusCode::NOT_FOUND, Json(json!({
            "error": "source namespace has no memories",
            "source": source,
        }))).into_response();
    }

    tracing::info!(
        "Merging namespace '{}' → '{}' ({} memories) for tenant {}",
        source, target, source_count, tenant_id
    );

    // Begin merge transaction
    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "failed to begin merge transaction");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "DB error"}))).into_response();
        }
    };

    // 1. Rewrite namespace on all golden_index rows
    let memories_moved = sqlx::query(
        "UPDATE golden_index SET namespace = $3, updated_at = now() \
         WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&source)
    .bind(&target)
    .execute(&mut *tx)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);

    // 2. Rewrite namespace_counters (merge or insert)
    let _ = sqlx::query(
        "UPDATE namespace_counters SET namespace = $3 \
         WHERE tenant_id = $1 AND namespace = $2 \
         AND NOT EXISTS (SELECT 1 FROM namespace_counters WHERE tenant_id = $1 AND namespace = $3)"
    )
    .bind(tenant_id)
    .bind(&source)
    .bind(&target)
    .execute(&mut *tx)
    .await;

    // Delete source counters if target already existed (data merged via golden_index)
    let _ = sqlx::query(
        "DELETE FROM namespace_counters WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&source)
    .execute(&mut *tx)
    .await;

    // 3. Rewrite namespace_acl: move source rules to target
    let _ = sqlx::query(
        "UPDATE namespace_acl SET namespace = $3 \
         WHERE tenant_id = $1 AND namespace = $2 \
         AND NOT EXISTS (SELECT 1 FROM namespace_acl WHERE tenant_id = $1 AND namespace = $3 AND agent_label = namespace_acl.agent_label)"
    )
    .bind(tenant_id)
    .bind(&source)
    .bind(&target)
    .execute(&mut *tx)
    .await;

    // Delete remaining source ACL rules (target already had rules for those agents)
    let _ = sqlx::query(
        "DELETE FROM namespace_acl WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&source)
    .execute(&mut *tx)
    .await;

    // Commit the transaction
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, "failed to commit merge transaction");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "error": "merge transaction failed",
            "detail": e.to_string(),
        }))).into_response();
    }

    tracing::info!(
        "Merge complete: {} memories moved from '{}' → '{}'",
        memories_moved, source, target
    );

    Json(json!({
        "status": "ok",
        "source": source,
        "target": target,
        "memories_moved": memories_moved,
    })).into_response()
}

/// DELETE /api/v1/admin/agents/:namespace — Delete all data for a namespace.
/// Query param: ?confirm=true (required as safety check)
pub async fn delete_agent(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
    axum::extract::Path(namespace): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;
    let namespace = crate::middleware::sanitize_namespace(&namespace);

    // Safety: require ?confirm=true
    if params.get("confirm").map(|v| v.as_str()) != Some("true") {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "error": "add ?confirm=true to confirm deletion",
            "namespace": namespace,
        }))).into_response();
    }

    // Count what we're about to delete
    let memory_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM golden_index WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&namespace)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if memory_count == 0 {
        return (StatusCode::NOT_FOUND, Json(json!({
            "error": "namespace not found or empty",
            "namespace": namespace,
        }))).into_response();
    }

    tracing::warn!(
        "Deleting namespace '{}' ({} memories) for tenant {}",
        namespace, memory_count, tenant_id
    );

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "failed to begin delete transaction");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "DB error"}))).into_response();
        }
    };

    // 1. Delete edges involving this namespace's nodes
    let edges_deleted = sqlx::query(
        "DELETE FROM golden_edges WHERE tenant_id = $1 AND (\
            source_id IN (SELECT id FROM golden_index WHERE tenant_id = $1 AND namespace = $2) OR \
            target_id IN (SELECT id FROM golden_index WHERE tenant_id = $1 AND namespace = $2))"
    )
    .bind(tenant_id)
    .bind(&namespace)
    .execute(&mut *tx)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);

    // 2. Delete all memories
    let memories_deleted = sqlx::query(
        "DELETE FROM golden_index WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&namespace)
    .execute(&mut *tx)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);

    // 3. Delete namespace counters
    let _ = sqlx::query(
        "DELETE FROM namespace_counters WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&namespace)
    .execute(&mut *tx)
    .await;

    // 4. Delete namespace ACL rules
    let acl_deleted = sqlx::query(
        "DELETE FROM namespace_acl WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&namespace)
    .execute(&mut *tx)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, "failed to commit delete transaction");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "error": "delete transaction failed",
        }))).into_response();
    }

    tracing::info!(
        "Namespace '{}' deleted: {} memories, {} edges, {} ACL rules",
        namespace, memories_deleted, edges_deleted, acl_deleted
    );

    Json(json!({
        "status": "deleted",
        "namespace": namespace,
        "memories_deleted": memories_deleted,
        "edges_deleted": edges_deleted,
        "acl_rules_deleted": acl_deleted,
    })).into_response()
}

// ═══════════════════════════════════════════════════════════════
// Agent Suspension
// ═══════════════════════════════════════════════════════════════

/// PATCH /api/v1/admin/agents/:namespace/status — Suspend or reactivate a namespace.
///
/// Body: `{ "suspended": true }` or `{ "suspended": false }`
///
/// When suspended:
/// - Sync writes are blocked with 403 `namespace_suspended`
/// - Reads (recall/search/hot-nodes) still work so history stays accessible
/// - The namespace and all memories are preserved; nothing is deleted
///
/// When reactivated (`suspended: false`), the namespace resumes normally.
#[derive(Deserialize)]
pub struct PatchStatusRequest {
    pub suspended: bool,
}

pub async fn patch_agent_status(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
    axum::extract::Path(namespace): axum::extract::Path<String>,
    Json(req): Json<PatchStatusRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;
    let namespace = crate::middleware::sanitize_namespace(&namespace);

    // Refuse to suspend the caller's own namespace (safety guard)
    if req.suspended && tenant_ctx.effective_namespace() == namespace {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "cannot_suspend_own_namespace",
                "message": "You cannot suspend the namespace you are authenticated as.",
            }))
        ).into_response();
    }

    // Ensure a namespace_counters row exists (upsert)
    let upsert_result = sqlx::query(
        "INSERT INTO namespace_counters (tenant_id, namespace, interaction_epoch, last_active_at) \
         VALUES ($1, $2, 0, now()) \
         ON CONFLICT (tenant_id, namespace) DO NOTHING"
    )
    .bind(tenant_id)
    .bind(&namespace)
    .execute(pool)
    .await;

    if let Err(e) = upsert_result {
        tracing::error!(error = %e, "failed to upsert namespace_counters row");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "DB error"}))).into_response();
    }

    // Check namespace actually has data (don't suspend ghost namespaces)
    let memory_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM golden_index WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&namespace)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if memory_count == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": "namespace_not_found",
                "namespace": namespace,
            }))
        ).into_response();
    }

    // Apply suspension / reactivation
    let result = if req.suspended {
        sqlx::query(
            "UPDATE namespace_counters \
             SET suspended_at = now(), suspended_by = $3 \
             WHERE tenant_id = $1 AND namespace = $2"
        )
        .bind(tenant_id)
        .bind(&namespace)
        .bind(&tenant_ctx.agent_label)
        .execute(pool)
        .await
    } else {
        sqlx::query(
            "UPDATE namespace_counters \
             SET suspended_at = NULL, suspended_by = NULL \
             WHERE tenant_id = $1 AND namespace = $2"
        )
        .bind(tenant_id)
        .bind(&namespace)
        .execute(pool)
        .await
    };

    match result {
        Ok(_) => {
            let status_label = if req.suspended { "suspended" } else { "active" };
            tracing::info!(
                namespace = %namespace,
                tenant = %tenant_id,
                status = status_label,
                "namespace suspension status changed"
            );
            Json(json!({
                "status": "ok",
                "namespace": namespace,
                "suspended": req.suspended,
                "action": if req.suspended { "suspended" } else { "reactivated" },
                "message": if req.suspended {
                    format!("Namespace '{}' is now suspended. Writes are blocked; memories are preserved.", namespace)
                } else {
                    format!("Namespace '{}' has been reactivated. Writes are allowed again.", namespace)
                },
            })).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to update suspension status");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "DB error"}))).into_response()
        }
    }
}

/// GET /api/v1/admin/agents/:namespace — Get detailed info for a single namespace.
pub async fn get_agent_detail(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<TenantContext>,
    axum::extract::Path(namespace): axum::extract::Path<String>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;
    let namespace = crate::middleware::sanitize_namespace(&namespace);

    // Memory stats
    let stats = sqlx::query(
        "SELECT \
            COUNT(*) as total, \
            COUNT(*) FILTER (WHERE current_heat >= 0.3 AND archived_at IS NULL) as hot, \
            COUNT(*) FILTER (WHERE current_heat < 0.3 AND archived_at IS NULL) as cold, \
            COUNT(*) FILTER (WHERE archived_at IS NOT NULL) as archived, \
            COUNT(*) FILTER (WHERE is_pinned = true) as pinned, \
            COALESCE(AVG(current_heat), 0) as avg_heat, \
            MIN(updated_at) as oldest, \
            MAX(updated_at) as newest \
         FROM golden_index WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&namespace)
    .fetch_one(pool)
    .await;

    let stats = match stats {
        Ok(row) => {
            let oldest: Option<chrono::DateTime<chrono::Utc>> = row.try_get("oldest").ok();
            let newest: Option<chrono::DateTime<chrono::Utc>> = row.try_get("newest").ok();
            json!({
                "total": row.get::<i64, _>("total"),
                "hot": row.get::<i64, _>("hot"),
                "cold": row.get::<i64, _>("cold"),
                "archived": row.get::<i64, _>("archived"),
                "pinned": row.get::<i64, _>("pinned"),
                "avg_heat": row.get::<f64, _>("avg_heat"),
                "oldest": oldest.map(|t| t.to_rfc3339()),
                "newest": newest.map(|t| t.to_rfc3339()),
            })
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to get agent detail");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "DB error"}))).into_response();
        }
    };

    // Memory type breakdown
    let types = sqlx::query(
        "SELECT COALESCE(memory_type, 'unknown') as mt, COUNT(*) as cnt \
         FROM golden_index WHERE tenant_id = $1 AND namespace = $2 \
         GROUP BY memory_type ORDER BY cnt DESC"
    )
    .bind(tenant_id)
    .bind(&namespace)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut type_map = json!({});
    for row in &types {
        let mt: String = row.get("mt");
        let cnt: i64 = row.get("cnt");
        type_map[mt] = json!(cnt);
    }

    // Suspension status
    let suspension = sqlx::query(
        "SELECT suspended_at, suspended_by FROM namespace_counters \
         WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(tenant_id)
    .bind(&namespace)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let (suspended, suspended_at, suspended_by) = if let Some(row) = suspension {
        let at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("suspended_at").ok().flatten();
        let by: Option<String> = row.try_get("suspended_by").ok().flatten();
        (at.is_some(), at.map(|t| t.to_rfc3339()), by)
    } else {
        (false, None, None)
    };

    Json(json!({
        "namespace": namespace,
        "stats": stats,
        "memory_types": type_map,
        "suspended": suspended,
        "suspended_at": suspended_at,
        "suspended_by": suspended_by,
    })).into_response()
}
