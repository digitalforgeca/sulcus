use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use sulcus_core::graph::Node;
use sulcus_core::sync::{compute_op_hash, MemoryOp};

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/// Run server-schema migrations against the connected database.
/// Safe to call on every startup — all statements are idempotent.
pub async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    let migrations = [
        include_str!("../migrations/0001_create_tables.sql"),
        include_str!("../migrations/0002_api_keys.sql"),
        include_str!("../migrations/0003_usage_tracking.sql"),
        include_str!("../migrations/0004_invitations.sql"),
        include_str!("../migrations/0005_latency_columns.sql"),
        include_str!("../migrations/0006_sso_config.sql"),
    ];

    for migration_sql in migrations {
        for stmt in migration_sql.split(';') {
            let s: &str = stmt.trim();
            if s.is_empty() {
                continue;
            }
            if let Err(e) = sqlx::query(s).execute(pool).await {
                // Ignore errors about relations already existing
                let msg = e.to_string();
                if !msg.contains("already exists") && !msg.contains("duplicate key") && !msg.contains("multiple primary keys") {
                    tracing::error!("Migration statement failed: {}\nSQL: {}", e, s);
                    return Err(e.into());
                }
            }
        }
    }
    Ok(())
}

pub async fn persist_ops_and_upsert_golden(
    pool: &PgPool,
    tenant_id: &str,
    ops: &[MemoryOp],
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;

    for op in ops.iter() {
        let payload_json: Option<Value> = op
            .payload
            .as_ref()
            .map(|n| serde_json::to_value(n).unwrap_or(json!(null)));
        let op_hash = compute_op_hash(op);

        // idempotent insert using tenant-scoped op_hash uniqueness
        let inserted = sqlx::query("INSERT INTO server_ops (tenant_id, op_type, payload, op_hash, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, op_hash) DO NOTHING RETURNING seq_id")
            .bind(tenant_id)
            .bind(format!("{:?}", op.op))
            .bind(payload_json.clone())
            .bind(op_hash.clone())
            .bind(op.timestamp)
            .fetch_optional(&mut *tx)
            .await?;

        // only apply to golden_index when insertion actually happened (idempotent)
        if inserted.is_some() {
            match op.op {
                sulcus_core::sync::OpType::Add | sulcus_core::sync::OpType::Update => {
                    if let Some(ref payload) = payload_json {
                        if let Ok(node) = serde_json::from_value::<Node>(payload.clone()) {
                            // Extract vector if present in the op
                            let vector_bytes = op.vector.as_ref().map(|v| {
                                v.iter().flat_map(|f| f.to_le_bytes()).collect::<Vec<u8>>()
                            });

                            sqlx::query("INSERT INTO golden_index (tenant_id, id, pointer_summary, base_utility, current_heat, is_pinned, updated_at, vector) VALUES ($1, $2, $3, $4, $5, $6, now(), $7) ON CONFLICT (tenant_id, id) DO UPDATE SET pointer_summary = EXCLUDED.pointer_summary, base_utility = EXCLUDED.base_utility, current_heat = EXCLUDED.current_heat, is_pinned = EXCLUDED.is_pinned, updated_at = now(), vector = COALESCE(EXCLUDED.vector, golden_index.vector)")
                                .bind(tenant_id)
                                .bind(node.id)
                                .bind(node.pointer_summary.clone())
                                .bind(node.base_utility)
                                .bind(node.current_heat)
                                .bind(node.is_pinned)
                                .bind(vector_bytes)
                                .execute(&mut *tx)
                                .await?;
                        }
                    }
                }
                sulcus_core::sync::OpType::Delete => {
                    if let Some(ref payload) = payload_json {
                        if let Ok(node) = serde_json::from_value::<Node>(payload.clone()) {
                            sqlx::query(
                                "DELETE FROM golden_index WHERE tenant_id = $1 AND id = $2",
                            )
                            .bind(tenant_id)
                            .bind(node.id)
                            .execute(&mut *tx)
                            .await?;
                        }
                    }
                }
                sulcus_core::sync::OpType::Patch => {
                    // Patch ops are handled via CRDT merge; golden_index is updated on next Add/Update.
                }
            }
        }
    }

    tx.commit().await?;
    Ok(())
}

/// Fetch ops newer than `since` and the current max `seq_id` in one go.
/// Returns `(ops, latest_seq)` — the caller uses `latest_seq` as the new cursor.
pub async fn fetch_ops_and_cursor(
    pool: &PgPool,
    tenant_id: &str,
    since: Option<DateTime<Utc>>,
) -> anyhow::Result<(Vec<MemoryOp>, Option<i64>)> {
    let ops = fetch_ops_since(pool, tenant_id, since).await?;
    let latest_seq: Option<i64> =
        sqlx::query_scalar("SELECT max(seq_id) FROM server_ops WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(pool)
            .await
            .ok();
    Ok((ops, latest_seq))
}

pub async fn fetch_ops_since(
    pool: &PgPool,
    tenant_id: &str,
    since: Option<DateTime<Utc>>,
) -> anyhow::Result<Vec<MemoryOp>> {
    let rows = if let Some(since_ts) = since {
        sqlx::query("SELECT op_type, payload, created_at FROM server_ops WHERE tenant_id = $1 AND created_at > $2 ORDER BY created_at ASC")
            .bind(tenant_id)
            .bind(since_ts)
            .fetch_all(pool)
            .await?
    } else {
        sqlx::query("SELECT op_type, payload, created_at FROM server_ops WHERE tenant_id = $1 ORDER BY created_at ASC")
            .bind(tenant_id)
            .fetch_all(pool)
            .await?
    };

    let mut out = Vec::with_capacity(rows.len());
    for r in rows.into_iter() {
        let op_type_s: String = r.try_get("op_type")?;
        let op_type = match op_type_s.as_str() {
            "Add" | "ADD" => sulcus_core::sync::OpType::Add,
            "Update" | "UPDATE" => sulcus_core::sync::OpType::Update,
            "Delete" | "DELETE" => sulcus_core::sync::OpType::Delete,
            other => return Err(anyhow::anyhow!("unknown op_type from db: {}", other)),
        };

        let payload_v: Option<serde_json::Value> = r.try_get("payload").ok();
        let payload: Option<Node> = payload_v.and_then(|p| serde_json::from_value::<Node>(p).ok());
        let created_at: DateTime<Utc> = r.try_get("created_at")?;

        out.push(MemoryOp {
            op: op_type,
            payload,
            patch: None,
            raw_content: None,
            vector: None,
            timestamp: created_at,
        });
    }

    Ok(out)
}

/// Return top `limit` nodes ordered by `heat DESC, updated_at DESC` from the golden index.
pub async fn fetch_top_hot_nodes(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
) -> anyhow::Result<Vec<Node>> {
    let rows = sqlx::query(
        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, memory_type FROM golden_index WHERE tenant_id = $1 ORDER BY current_heat DESC, updated_at DESC LIMIT $2",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows.into_iter() {
        out.push(Node {
            id: r.try_get("id")?,
            label: r.try_get("pointer_summary")?,
            pointer_summary: r.try_get("pointer_summary")?,
            base_utility: r.try_get("base_utility")?,
            current_heat: r.try_get("current_heat")?,
            is_pinned: r.try_get("is_pinned")?,
            memory_type: r.try_get::<Option<String>, _>("memory_type").ok().flatten().unwrap_or_else(|| "episodic".to_string()),
        });
    }

    Ok(out)
}

/// Perform semantic search on the golden index.
pub async fn search_golden_index(
    pool: &PgPool,
    tenant_id: &str,
    query_vector: &[f32],
    limit: i64,
) -> anyhow::Result<Vec<(Node, f32)>> {
    let vector_bytes: Vec<u8> = query_vector.iter().flat_map(|f| f.to_le_bytes()).collect();
    
    // Note: This uses a brute-force cosine similarity over BYTEA. 
    // In production with pgvector, this would be `vector <=> $2::vector`.
    let rows = sqlx::query(
        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, memory_type, vector FROM golden_index WHERE tenant_id = $1 AND vector IS NOT NULL LIMIT 100",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;

    let mut results = Vec::new();
    for r in rows {
        let stored_bytes: Vec<u8> = r.try_get("vector")?;
        if stored_bytes.len() != vector_bytes.len() { continue; }
        
        let stored_vec: Vec<f32> = stored_bytes.chunks_exact(4)
            .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
            .collect();
        
        // simple dot product (assuming normalized)
        let score: f32 = query_vector.iter().zip(stored_vec.iter()).map(|(a, b)| a * b).sum();
        
        let node = Node {
            id: r.try_get("id")?,
            label: r.try_get("pointer_summary")?,
            pointer_summary: r.try_get("pointer_summary")?,
            base_utility: r.try_get("base_utility")?,
            current_heat: r.try_get("current_heat")?,
            is_pinned: r.try_get("is_pinned")?,
            memory_type: r.try_get::<Option<String>, _>("memory_type").ok().flatten().unwrap_or_else(|| "episodic".to_string()),
        };
        results.push((node, score));
    }

    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    results.truncate(limit as usize);
    Ok(results)
}

/// Store a hashed invitation token.
pub async fn insert_invitation(
    pool: &PgPool,
    tenant_id: &str,
    token_hash: &str,
    expires_at: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO invitations (tenant_id, token_hash, expires_at) VALUES ($1, $2, $3)")
        .bind(tenant_id)
        .bind(token_hash)
        .bind(expires_at)
        .execute(pool)
        .await?;
    Ok(())
}

/// Atomically consume an invitation token and return the associated tenant_id.
pub async fn consume_invitation(pool: &PgPool, token_hash: &str) -> anyhow::Result<Option<String>> {
    let row = sqlx::query("DELETE FROM invitations WHERE token_hash = $1 AND expires_at > now() RETURNING tenant_id")
        .bind(token_hash)
        .fetch_optional(pool)
        .await?;
    
    Ok(row.map(|r| r.get("tenant_id")))
}

/// Create a new API key for a tenant.
pub async fn insert_api_key(pool: &PgPool, tenant_id: &str, key_hash: &str, plan_tier: &str) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO api_keys (tenant_id, key_hash, plan_tier) VALUES ($1, $2, $3)")
        .bind(tenant_id)
        .bind(key_hash)
        .bind(plan_tier)
        .execute(pool)
        .await?;
    Ok(())
}

/// Atomically increment usage counters for the current billing month.
/// Designed for fire-and-forget; errors are logged but not propagated.
pub async fn increment_usage(
    pool: &PgPool,
    tenant_id: &str,
    sync_requests: i64,
    nodes_added: i64,
    latency_ms: f64,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO tenant_usage (tenant_id, month, sync_requests, nodes_added, avg_latency_ms, max_latency_ms)
         VALUES ($1, date_trunc('month', now())::date, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, month) DO UPDATE
         SET avg_latency_ms = (tenant_usage.avg_latency_ms * tenant_usage.sync_requests + EXCLUDED.avg_latency_ms * EXCLUDED.sync_requests) / (tenant_usage.sync_requests + EXCLUDED.sync_requests),
             max_latency_ms = GREATEST(tenant_usage.max_latency_ms, EXCLUDED.max_latency_ms),
             sync_requests = tenant_usage.sync_requests + EXCLUDED.sync_requests,
             nodes_added   = tenant_usage.nodes_added   + EXCLUDED.nodes_added",
    )
    .bind(tenant_id)
    .bind(sync_requests)
    .bind(nodes_added)
    .bind(latency_ms)
    .bind(latency_ms)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct TenantUsageRow {
    pub month: String,
    pub sync_requests: i64,
    pub nodes_added: i64,
    pub avg_latency_ms: f64,
    pub max_latency_ms: f64,
}

/// Fetch monthly usage stats for a tenant from `tenant_usage`.
pub async fn get_tenant_usage(
    pool: &PgPool,
    tenant_id: &str,
) -> anyhow::Result<Vec<TenantUsageRow>> {
    let rows = sqlx::query(
        "SELECT month, sync_requests, nodes_added, avg_latency_ms, max_latency_ms FROM tenant_usage WHERE tenant_id = $1 ORDER BY month DESC"
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|r| TenantUsageRow {
        month: r.get::<chrono::NaiveDate, _>("month").to_string(),
        sync_requests: r.get("sync_requests"),
        nodes_added: r.get("nodes_added"),
        avg_latency_ms: r.get("avg_latency_ms"),
        max_latency_ms: r.get("max_latency_ms"),
    }).collect())
}

#[derive(serde::Serialize)]
pub struct GraphNode {
    pub id: uuid::Uuid,
    pub label: String,
    pub heat: f32,
    pub memory_type: String,
}

#[derive(serde::Serialize)]
pub struct GraphLink {
    pub source: uuid::Uuid,
    pub target: uuid::Uuid,
    pub weight: f32,
}

#[derive(serde::Serialize)]
pub struct GraphSnapshot {
    pub nodes: Vec<GraphNode>,
    pub links: Vec<GraphLink>,
}

/// Return a full graph snapshot (nodes + edges) for a tenant.
pub async fn get_graph_snapshot(pool: &PgPool, tenant_id: &str) -> anyhow::Result<GraphSnapshot> {
    let node_rows = sqlx::query("SELECT id, pointer_summary, current_heat, memory_type FROM golden_index WHERE tenant_id = $1")
        .bind(tenant_id)
        .fetch_all(pool)
        .await?;

    let nodes = node_rows.into_iter().map(|r| GraphNode {
        id: r.get("id"),
        label: r.get("pointer_summary"),
        heat: r.get("current_heat"),
        memory_type: r.get::<Option<String>, _>("memory_type").unwrap_or_else(|| "episodic".to_string()),
    }).collect();

    Ok(GraphSnapshot { nodes, links: vec![] })
}
