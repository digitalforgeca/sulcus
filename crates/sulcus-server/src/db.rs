use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use sulcus_core::graph::Node;
use sulcus_core::sync::{compute_op_hash, MemoryOp};

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
                            sqlx::query("INSERT INTO golden_index (tenant_id, id, pointer_summary, base_utility, current_heat, is_pinned, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT (tenant_id, id) DO UPDATE SET pointer_summary = EXCLUDED.pointer_summary, base_utility = EXCLUDED.base_utility, current_heat = EXCLUDED.current_heat, is_pinned = EXCLUDED.is_pinned, updated_at = now()")
                                .bind(tenant_id)
                                .bind(node.id)
                                .bind(node.pointer_summary.clone())
                                .bind(node.base_utility)
                                .bind(node.current_heat)
                                .bind(node.is_pinned)
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
            }
        }
    }

    tx.commit().await?;
    Ok(())
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
            raw_content: None,
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
        "SELECT id, pointer_summary, current_heat FROM golden_index WHERE tenant_id = $1 ORDER BY current_heat DESC, updated_at DESC LIMIT $2",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows.into_iter() {
        let id: uuid::Uuid = r.try_get("id")?;
        let pointer_summary: String = r.try_get("pointer_summary")?;
        let current_heat: f32 = r.try_get("current_heat")?;
        out.push(Node {
            id,
            label: pointer_summary.clone(),
            pointer_summary,
            base_utility: 0.0,
            current_heat,
            is_pinned: false,
        });
    }

    Ok(out)
}
