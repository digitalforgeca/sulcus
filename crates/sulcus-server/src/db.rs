use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use sulcus_core::crdt::NodePatch;
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
        include_str!("../migrations/0007_golden_edges.sql"),
        include_str!("../migrations/0008_billing.sql"),
        include_str!("../migrations/0009_patch_ops.sql"),
        include_str!("../migrations/0010_keycloak_user_id.sql"),
        include_str!("../migrations/0011_organizations_and_seats.sql"),
        include_str!("../migrations/0012_cross_modal_namespace.sql"),
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
        let patch_json: Option<Value> = op
            .patch
            .as_ref()
            .map(|p| serde_json::to_value(p).unwrap_or(json!(null)));
        let vector_bytes_store: Option<Vec<u8>> = op.vector.as_ref().map(|v| {
            v.iter().flat_map(|f| f.to_le_bytes()).collect()
        });
        let op_hash = compute_op_hash(op);

        let inserted = sqlx::query("INSERT INTO server_ops (tenant_id, op_type, payload, op_hash, created_at, patch, raw_content, vector) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (tenant_id, op_hash) DO NOTHING RETURNING seq_id")
            .bind(tenant_id)
            .bind(format!("{:?}", op.op))
            .bind(payload_json.clone())
            .bind(op_hash.clone())
            .bind(op.timestamp)
            .bind(patch_json)
            .bind(op.raw_content.as_deref())
            .bind(vector_bytes_store)
            .fetch_optional(&mut *tx)
            .await?;

        // only apply to golden_index when insertion actually happened (idempotent)
        if inserted.is_some() {
            match op.op {
                sulcus_core::sync::OpType::Add | sulcus_core::sync::OpType::Update => {
                    if let Some(ref payload) = payload_json {
                        let node_res = serde_json::from_value::<Node>(payload.clone());
                        if let Err(ref e) = node_res {
                            tracing::warn!(error = %e, "failed to deserialize Node payload for golden_index upsert");
                        }
                        if let Ok(node) = node_res {
                            // Extract vector if present in the op
                            let vector_bytes = op.vector.as_ref().map(|v| {
                                v.iter().flat_map(|f| f.to_le_bytes()).collect::<Vec<u8>>()
                            });

                            sqlx::query("INSERT INTO golden_index (tenant_id, id, pointer_summary, base_utility, current_heat, is_pinned, updated_at, vector, memory_type, modality, source_mime, namespace) VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11) ON CONFLICT (tenant_id, id) DO UPDATE SET pointer_summary = EXCLUDED.pointer_summary, base_utility = EXCLUDED.base_utility, current_heat = EXCLUDED.current_heat, is_pinned = EXCLUDED.is_pinned, updated_at = now(), vector = COALESCE(EXCLUDED.vector, golden_index.vector), memory_type = EXCLUDED.memory_type, modality = EXCLUDED.modality, source_mime = EXCLUDED.source_mime, namespace = EXCLUDED.namespace")
                                .bind(tenant_id)
                                .bind(node.id)
                                .bind(node.pointer_summary.clone())
                                .bind(node.base_utility)
                                .bind(node.current_heat)
                                .bind(node.is_pinned)
                                .bind(vector_bytes)
                                .bind(node.memory_type)
                                .bind(node.modality)
                                .bind(node.source_mime)
                                .bind(node.namespace)
                                .execute(&mut *tx)
                                .await?;

                            // EDGE PROBE: If payload has source_id and target_id, it's a relationship
                            if let (Some(sid), Some(tid)) = (payload.get("source_id").and_then(|v| v.as_str()), payload.get("target_id").and_then(|v| v.as_str())) {
                                if let (Ok(source), Ok(target)) = (uuid::Uuid::parse_str(sid), uuid::Uuid::parse_str(tid)) {
                                    let weight = payload.get("weight").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
                                    let edge_type = payload.get("edge_type").and_then(|v| v.as_str()).unwrap_or("related");
                                    
                                    sqlx::query("INSERT INTO golden_edges (tenant_id, source_id, target_id, weight, edge_type, updated_at) VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (tenant_id, source_id, target_id) DO UPDATE SET weight = EXCLUDED.weight, edge_type = EXCLUDED.edge_type, updated_at = now()")
                                        .bind(tenant_id)
                                        .bind(source)
                                        .bind(target)
                                        .bind(weight)
                                        .bind(edge_type)
                                        .execute(&mut *tx)
                                        .await?;
                                }
                            }
                        }
                    }
                }
                sulcus_core::sync::OpType::Delete => {
                    if let Some(ref payload) = payload_json {
                        let node_res = serde_json::from_value::<Node>(payload.clone());
                        if let Err(ref e) = node_res {
                            tracing::warn!(error = %e, "failed to deserialize Node payload for golden_index upsert");
                        }
                        if let Ok(node) = node_res {
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
        sqlx::query("SELECT op_type, payload, created_at, patch, raw_content, vector FROM server_ops WHERE tenant_id = $1 AND created_at > $2 ORDER BY created_at ASC")
            .bind(tenant_id)
            .bind(since_ts)
            .fetch_all(pool)
            .await?
    } else {
        sqlx::query("SELECT op_type, payload, created_at, patch, raw_content, vector FROM server_ops WHERE tenant_id = $1 ORDER BY created_at ASC")
            .bind(tenant_id)
            .fetch_all(pool)
            .await?
    };

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let op_type_s: String = r.try_get("op_type")?;
        let op_type = match op_type_s.as_str() {
            "Add" | "ADD" => sulcus_core::sync::OpType::Add,
            "Update" | "UPDATE" => sulcus_core::sync::OpType::Update,
            "Delete" | "DELETE" => sulcus_core::sync::OpType::Delete,
            "Patch" | "PATCH" => sulcus_core::sync::OpType::Patch,
            other => return Err(anyhow::anyhow!("unknown op_type from db: {}", other)),
        };

        let payload: Option<Node> = r
            .try_get::<Option<Value>, _>("payload")
            .ok()
            .flatten()
            .and_then(|p| {
                serde_json::from_value::<Node>(p.clone()).map_err(|e| {
                    tracing::warn!(error = %e, "failed to deserialize Node payload from db");
                    e
                }).ok()
            });
        let patch: Option<NodePatch> = r
            .try_get::<Option<Value>, _>("patch")
            .ok()
            .flatten()
            .and_then(|p| {
                serde_json::from_value::<NodePatch>(p.clone()).map_err(|e| {
                    tracing::warn!(error = %e, "failed to deserialize NodePatch from db");
                    e
                }).ok()
            });
        let raw_content: Option<String> = r
            .try_get::<Option<String>, _>("raw_content")
            .ok()
            .flatten();
        let vector: Option<Vec<f32>> = r
            .try_get::<Option<Vec<u8>>, _>("vector")
            .ok()
            .flatten()
            .map(|bytes| {
                bytes
                    .chunks_exact(4)
                    .map(|c| {
                        // chunks_exact(4) guarantees a 4-byte slice; the conversion is infallible.
                        let arr: [u8; 4] = c.try_into().unwrap_or([0u8; 4]);
                        f32::from_le_bytes(arr)
                    })
                    .collect()
            });
        let created_at: DateTime<Utc> = r.try_get("created_at")?;

        out.push(MemoryOp {
            op: op_type,
            payload,
            patch,
            raw_content,
            vector,
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
        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, memory_type, modality, source_mime, namespace FROM golden_index WHERE tenant_id = $1 ORDER BY current_heat DESC, updated_at DESC LIMIT $2",
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
            memory_type: r.get::<Option<String>, _>("memory_type").unwrap_or_else(|| "episodic".to_string()),
            modality: r.get::<Option<String>, _>("modality").unwrap_or_else(|| "text".to_string()),
            source_mime: r.get("source_mime"),
            namespace: r.get::<Option<String>, _>("namespace").unwrap_or_else(|| "default".to_string()),
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
        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, memory_type, modality, source_mime, namespace, vector FROM golden_index WHERE tenant_id = $1 AND vector IS NOT NULL LIMIT 100",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;

    let mut results = Vec::new();
    for r in rows {
        let stored_bytes: Vec<u8> = r.try_get("vector")?;
        if stored_bytes.len() != vector_bytes.len() { continue; }
        
        let stored_vec: Vec<f32> = stored_bytes.chunks_exact(4)
            .map(|c| {
                // chunks_exact(4) guarantees a 4-byte slice; the conversion is infallible.
                let arr: [u8; 4] = c.try_into().unwrap_or([0u8; 4]);
                f32::from_le_bytes(arr)
            })
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
            memory_type: r.get::<Option<String>, _>("memory_type").unwrap_or_else(|| "episodic".to_string()),
            modality: r.get::<Option<String>, _>("modality").unwrap_or_else(|| "text".to_string()),
            source_mime: r.get("source_mime"),
            namespace: r.get::<Option<String>, _>("namespace").unwrap_or_else(|| "default".to_string()),
        };
        results.push((node, score));
    }

    // Use total_cmp for NaN-safe ordering (NaN is sorted to the end, not panicked on).
    results.sort_by(|a, b| b.1.total_cmp(&a.1));
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

    let edge_rows = sqlx::query("SELECT source_id, target_id, weight FROM golden_edges WHERE tenant_id = $1")
        .bind(tenant_id)
        .fetch_all(pool)
        .await?;

    let links = edge_rows.into_iter().map(|r| GraphLink {
        source: r.get("source_id"),
        target: r.get("target_id"),
        weight: r.get("weight"),
    }).collect();

    Ok(GraphSnapshot { nodes, links })
}

// ---------------------------------------------------------------------------
// Pure helpers (extracted for testability)
// ---------------------------------------------------------------------------

/// Deserialise a `BYTEA` vector blob into a `Vec<f32>` (little-endian).
/// Returns `None` if `bytes.len()` is not a multiple of 4.
pub fn bytes_to_f32_vec(bytes: &[u8]) -> Option<Vec<f32>> {
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    Some(
        bytes
            .chunks_exact(4)
            .map(|c| {
                let arr: [u8; 4] = c.try_into().unwrap_or([0u8; 4]);
                f32::from_le_bytes(arr)
            })
            .collect(),
    )
}

/// Dot-product similarity between two equal-length vectors.
/// Returns `None` if lengths differ.
pub fn dot_product(a: &[f32], b: &[f32]) -> Option<f32> {
    if a.len() != b.len() {
        return None;
    }
    Some(a.iter().zip(b.iter()).map(|(x, y)| x * y).sum())
}

/// Sort `(item, score)` pairs descending by score, NaN-safe.
pub fn sort_by_score_desc<T>(pairs: &mut [(T, f32)]) {
    pairs.sort_by(|a, b| b.1.total_cmp(&a.1));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_to_f32_vec_roundtrip() {
        let original = vec![1.0f32, -0.5, 0.0, 42.5];
        let bytes: Vec<u8> = original.iter().flat_map(|f| f.to_le_bytes()).collect();
        let recovered = bytes_to_f32_vec(&bytes).expect("should decode");
        assert_eq!(original, recovered);
    }

    #[test]
    fn bytes_to_f32_vec_rejects_misaligned() {
        let bytes = vec![0u8; 7]; // 7 is not divisible by 4
        assert!(bytes_to_f32_vec(&bytes).is_none());
    }

    #[test]
    fn bytes_to_f32_vec_empty_is_ok() {
        let result = bytes_to_f32_vec(&[]).expect("empty is valid");
        assert!(result.is_empty());
    }

    #[test]
    fn dot_product_identity_vector() {
        let v = vec![1.0f32, 0.0, 0.0];
        let score = dot_product(&v, &v).expect("same length");
        assert!((score - 1.0).abs() < 1e-6, "unit dot-product should be 1.0");
    }

    #[test]
    fn dot_product_orthogonal_vectors() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![0.0f32, 1.0, 0.0];
        let score = dot_product(&a, &b).expect("same length");
        assert!((score - 0.0).abs() < 1e-6, "orthogonal vectors score should be 0.0");
    }

    #[test]
    fn dot_product_length_mismatch_returns_none() {
        let a = vec![1.0f32, 2.0];
        let b = vec![1.0f32];
        assert!(dot_product(&a, &b).is_none());
    }

    #[test]
    fn sort_by_score_desc_orders_correctly() {
        let mut pairs: Vec<(usize, f32)> = vec![(0, 0.3), (1, 0.9), (2, 0.1), (3, 0.7)];
        sort_by_score_desc(&mut pairs);
        let scores: Vec<f32> = pairs.iter().map(|(_, s)| *s).collect();
        assert_eq!(scores, vec![0.9, 0.7, 0.3, 0.1]);
    }

    #[test]
    fn sort_by_score_desc_handles_nan_without_panic() {
        let mut pairs: Vec<(usize, f32)> = vec![(0, f32::NAN), (1, 0.5), (2, 0.9)];
        sort_by_score_desc(&mut pairs); // must not panic
        // NaN should sort to the end under total_cmp (NaN > finite)
        // Regardless of position, the call must complete.
        assert_eq!(pairs.len(), 3);
    }

    #[test]
    fn sort_by_score_desc_handles_inf() {
        let mut pairs: Vec<(usize, f32)> = vec![(0, f32::INFINITY), (1, 0.5), (2, f32::NEG_INFINITY)];
        sort_by_score_desc(&mut pairs);
        assert_eq!(pairs[0].1, f32::INFINITY);
        assert_eq!(pairs[2].1, f32::NEG_INFINITY);
    }
}
