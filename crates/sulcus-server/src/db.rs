use chrono::{DateTime, Utc};
use pgvector::Vector;
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
        include_str!("../migrations/0013_teams.sql"),
        include_str!("../migrations/0014_entitlements.sql"),
        include_str!("../migrations/0015_org_members.sql"),
        include_str!("../migrations/0016_api_keys_label.sql"),
        include_str!("../migrations/0017_normalize_plan_tiers.sql"),
        include_str!("../migrations/0018_api_keys_unique_hash.sql"),
        include_str!("../migrations/0019_activity_log.sql"),
        include_str!("../migrations/0020_gamification.sql"),
        include_str!("../migrations/0021_thermo_config.sql"),
        include_str!("../migrations/0022_telemetry.sql"),
        include_str!("../migrations/0023_prune_batch_edges.sql"),
        include_str!("../migrations/0024_prune_batch_edges_v2.sql"),
        include_str!("../migrations/0025_triggers.sql"),
        include_str!("../migrations/0026_waitlist.sql"),
        include_str!("../migrations/0027_memory_lock.sql"),
        include_str!("../migrations/0028_extension_downloads.sql"),
        include_str!("../migrations/0029_enable_age.sql"),
        include_str!("../migrations/0030_encryption_config.sql"),
        include_str!("../migrations/0031_pgvector_hnsw.sql"),
        include_str!("../migrations/0032_platform_invites.sql"),
        include_str!("../migrations/0033_namespace_acl.sql"),
        include_str!("../migrations/0034_multi_key_per_tenant.sql"),
        include_str!("../migrations/0035_oidc_tenant_links.sql"),
        include_str!("../migrations/0036_siu_config.sql"),
        include_str!("../migrations/0037_fts_index.sql"),
        include_str!("../migrations/0038_training_signals.sql"),
        include_str!("../migrations/0039_trigger_feedback.sql"),
        include_str!("../migrations/0040_soft_delete.sql"),
        include_str!("../migrations/0041_entities.sql"),
        include_str!("../migrations/0042_agent_siu_config.sql"),
        include_str!("../migrations/0043_interaction_epoch.sql"),
        include_str!("../migrations/0044_v2_3_0.sql"),
        include_str!("../migrations/0045_output_evaluations.sql"),
        include_str!("../migrations/0046_api_keys_namespace.sql"),
        include_str!("../migrations/0047_password_reset_tokens.sql"),
        include_str!("../migrations/0048_tenant_kc_orgs.sql"),
        include_str!("../migrations/0049_recall_sessions.sql"),
        include_str!("../migrations/0050_normalize_namespaces.sql"),
        include_str!("../migrations/0053_siru_recall_sessions.sql"),
        include_str!("../migrations/0054_parallel_fts_bm25.sql"),
        include_str!("../migrations/0055_temporal_graph_edges.sql"),
        include_str!("../migrations/0056_fix_namespace_normalization.sql"),
        include_str!("../migrations/0057_namespace_suspend.sql"),
        include_str!("../migrations/0058_decay_batch_fix.sql"),
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
                if !msg.contains("already exists")
                    && !msg.contains("duplicate key")
                    && !msg.contains("multiple primary keys")
                {
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
    // Collect (namespace) values touched by Add/Update ops so we can increment epochs after commit.
    let mut touched_namespaces: std::collections::HashSet<String> = std::collections::HashSet::new();

    for op in ops.iter() {
        let payload_json: Option<Value> = op
            .payload
            .as_ref()
            .map(|n| serde_json::to_value(n).unwrap_or(json!(null)));
        let patch_json: Option<Value> = op
            .patch
            .as_ref()
            .map(|p| serde_json::to_value(p).unwrap_or(json!(null)));
        let vector_bytes_store: Option<Vec<u8>> = op
            .vector
            .as_ref()
            .map(|v| v.iter().flat_map(|f| f.to_le_bytes()).collect());
        let op_embedding = op.vector.as_ref().map(|v| Vector::from(v.clone()));
        let op_hash = compute_op_hash(op);

        let inserted = sqlx::query("INSERT INTO server_ops (tenant_id, op_type, payload, op_hash, created_at, patch, raw_content, vector, embedding) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (tenant_id, op_hash) DO NOTHING RETURNING seq_id")
            .bind(tenant_id)
            .bind(format!("{:?}", op.op))
            .bind(payload_json.clone())
            .bind(op_hash.clone())
            .bind(op.timestamp)
            .bind(patch_json)
            .bind(op.raw_content.as_deref())
            .bind(vector_bytes_store)
            .bind(&op_embedding)
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
                            // ── INGEST QUALITY FILTER ──
                            // Reject raw conversation dumps and JSON blobs at the source.
                            // These waste storage and pollute context injection.
                            let ps = node.pointer_summary.as_str();
                            let is_junk = ps.contains(r#""type":"text""#)
                                || ps.contains("message_id")
                                || ps.contains("Conversation info")
                                || ps.contains("[cron:")
                                || ps.contains(r#""sender_id""#)
                                || ps.contains(r#""chat_type""#)
                                || ps.starts_with("user: [")
                                || ps.starts_with("assistant: [")
                                || ps.starts_with("system: [")
                                || ps.trim().len() < 10;
                            if is_junk {
                                tracing::debug!(id = %node.id, "ingest filter: rejected junk node");
                                // Still record the op in the log (for sync), just skip golden_index
                            } else {
                                // Extract vector if present in the op — store both BYTEA (compat) and pgvector
                                let vector_bytes = op.vector.as_ref().map(|v| {
                                    v.iter().flat_map(|f| f.to_le_bytes()).collect::<Vec<u8>>()
                                });
                                let embedding = op.vector.as_ref().map(|v| Vector::from(v.clone()));

                                sqlx::query("INSERT INTO golden_index (tenant_id, id, pointer_summary, base_utility, current_heat, is_pinned, updated_at, vector, embedding, memory_type, modality, source_mime, namespace) VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11, $12) ON CONFLICT (tenant_id, id) DO UPDATE SET pointer_summary = EXCLUDED.pointer_summary, base_utility = EXCLUDED.base_utility, current_heat = EXCLUDED.current_heat, is_pinned = EXCLUDED.is_pinned, updated_at = now(), vector = COALESCE(EXCLUDED.vector, golden_index.vector), embedding = COALESCE(EXCLUDED.embedding, golden_index.embedding), memory_type = EXCLUDED.memory_type, modality = EXCLUDED.modality, source_mime = EXCLUDED.source_mime, namespace = EXCLUDED.namespace")
                                .bind(tenant_id)
                                .bind(node.id)
                                .bind(node.pointer_summary.clone())
                                .bind(node.base_utility)
                                .bind(node.current_heat)
                                .bind(node.is_pinned)
                                .bind(vector_bytes)
                                .bind(&embedding)
                                .bind(node.memory_type)
                                .bind(node.modality)
                                .bind(node.source_mime)
                                .bind(node.namespace.clone())
                                .execute(&mut *tx)
                                .await?;

                                // Track namespace for epoch increment after commit
                                let ns_str = if node.namespace.is_empty() {
                                    "default".to_string()
                                } else {
                                    node.namespace.clone()
                                };
                                touched_namespaces.insert(ns_str);

                                // EDGE PROBE: If payload has source_id and target_id, it's a relationship
                                if let (Some(sid), Some(tid)) = (
                                    payload.get("source_id").and_then(|v| v.as_str()),
                                    payload.get("target_id").and_then(|v| v.as_str()),
                                ) {
                                    if let (Ok(source), Ok(target)) =
                                        (uuid::Uuid::parse_str(sid), uuid::Uuid::parse_str(tid))
                                    {
                                        let weight = payload
                                            .get("weight")
                                            .and_then(|v| v.as_f64())
                                            .unwrap_or(1.0)
                                            as f32;
                                        let edge_type = payload
                                            .get("edge_type")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("related");

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
                            } // end else (not junk)
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

    // Increment interaction epoch for each touched namespace (fire-and-forget, non-fatal)
    for ns in touched_namespaces {
        if let Err(e) = increment_namespace_epoch(pool, tenant_id, &ns).await {
            tracing::debug!(error = %e, namespace = %ns, "epoch increment failed (non-fatal)");
        }
    }

    Ok(())
}

/// Return all tenant_ids in the same team(s) as `tenant_id` (including self).
pub async fn fetch_team_tenant_ids(pool: &PgPool, tenant_id: &str) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT tm2.tenant_id
         FROM team_memberships tm1
         JOIN team_memberships tm2 ON tm1.team_id = tm2.team_id
         WHERE tm1.tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;

    let mut ids = rows;
    if !ids.contains(&tenant_id.to_string()) {
        ids.push(tenant_id.to_string());
    }
    Ok(ids)
}

/// Fetch ops newer than `since` and the current max `seq_id` in one go.
/// Returns `(ops, latest_seq)` — the caller uses `latest_seq` as the new cursor.
pub async fn fetch_ops_and_cursor(
    pool: &PgPool,
    tenant_ids: &[String],
    since: Option<DateTime<Utc>>,
) -> anyhow::Result<(Vec<MemoryOp>, Option<i64>)> {
    let ops = fetch_ops_since(pool, tenant_ids, since).await?;
    let latest_seq: Option<i64> =
        sqlx::query_scalar("SELECT max(seq_id) FROM server_ops WHERE tenant_id = ANY($1)")
            .bind(tenant_ids)
            .fetch_one(pool)
            .await
            .ok();
    Ok((ops, latest_seq))
}

pub async fn fetch_ops_since(
    pool: &PgPool,
    tenant_ids: &[String],
    since: Option<DateTime<Utc>>,
) -> anyhow::Result<Vec<MemoryOp>> {
    let rows = if let Some(since_ts) = since {
        sqlx::query("SELECT op_type, payload, created_at, patch, raw_content, vector FROM server_ops WHERE tenant_id = ANY($1) AND created_at > $2 ORDER BY created_at ASC")
            .bind(tenant_ids)
            .bind(since_ts)
            .fetch_all(pool)
            .await?
    } else {
        sqlx::query("SELECT op_type, payload, created_at, patch, raw_content, vector FROM server_ops WHERE tenant_id = ANY($1) ORDER BY created_at ASC")
            .bind(tenant_ids)
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

        let payload: Option<Node> =
            r.try_get::<Option<Value>, _>("payload")
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
                serde_json::from_value::<NodePatch>(p.clone())
                    .map_err(|e| {
                        tracing::warn!(error = %e, "failed to deserialize NodePatch from db");
                        e
                    })
                    .ok()
            });
        let raw_content: Option<String> =
            r.try_get::<Option<String>, _>("raw_content").ok().flatten();
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
    tenant_ids: &[String],
    limit: i64,
) -> anyhow::Result<Vec<Node>> {
    let rows = sqlx::query(
        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, memory_type, modality, source_mime, namespace FROM golden_index WHERE tenant_id = ANY($1) AND archived_at IS NULL ORDER BY current_heat DESC, updated_at DESC LIMIT $2",
    )
    .bind(tenant_ids)
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
            memory_type: r
                .get::<Option<String>, _>("memory_type")
                .unwrap_or_else(|| "episodic".to_string()),
            modality: r
                .get::<Option<String>, _>("modality")
                .unwrap_or_else(|| "text".to_string()),
            source_mime: r.get("source_mime"),
            namespace: r
                .get::<Option<String>, _>("namespace")
                .unwrap_or_else(|| "default".to_string()),
        });
    }

    Ok(out)
}

/// Like fetch_top_hot_nodes, but with optional namespace filter applied in SQL (before LIMIT).
pub async fn fetch_top_hot_nodes_ns(
    pool: &PgPool,
    tenant_ids: &[String],
    namespace: Option<&str>,
    limit: i64,
) -> anyhow::Result<Vec<Node>> {
    let rows = if let Some(ns) = namespace {
        sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, memory_type, modality, source_mime, namespace \
             FROM golden_index WHERE tenant_id = ANY($1) AND namespace = $2 AND archived_at IS NULL \
             ORDER BY current_heat DESC, updated_at DESC LIMIT $3",
        )
        .bind(tenant_ids)
        .bind(ns)
        .bind(limit)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, memory_type, modality, source_mime, namespace \
             FROM golden_index WHERE tenant_id = ANY($1) AND archived_at IS NULL \
             ORDER BY current_heat DESC, updated_at DESC LIMIT $2",
        )
        .bind(tenant_ids)
        .bind(limit)
        .fetch_all(pool)
        .await?
    };

    let mut out = Vec::with_capacity(rows.len());
    for r in rows.into_iter() {
        out.push(Node {
            id: r.try_get("id")?,
            label: r.try_get("pointer_summary")?,
            pointer_summary: r.try_get("pointer_summary")?,
            base_utility: r.try_get("base_utility")?,
            current_heat: r.try_get("current_heat")?,
            is_pinned: r.try_get("is_pinned")?,
            memory_type: r
                .get::<Option<String>, _>("memory_type")
                .unwrap_or_else(|| "episodic".to_string()),
            modality: r
                .get::<Option<String>, _>("modality")
                .unwrap_or_else(|| "text".to_string()),
            source_mime: r.get("source_mime"),
            namespace: r
                .get::<Option<String>, _>("namespace")
                .unwrap_or_else(|| "default".to_string()),
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
    search_golden_index_ns(pool, tenant_id, query_vector, limit, None).await
}

/// Vector search with optional namespace filtering and relevance-weighted scoring.
/// When namespace is Some, only searches within that namespace.
/// When None, searches across all namespaces (legacy behavior, ACL filters post-hoc).
///
/// Scoring: `final_score = (similarity * similarity_weight) + (current_heat * heat_weight)`
/// Weights default to 0.7/0.3 per RecallConfig. Fetch a larger batch (limit * 3) then
/// re-rank so heat-boosted results aren't cut off by the ORDER BY distance LIMIT.
pub async fn search_golden_index_ns(
    pool: &PgPool,
    tenant_id: &str,
    query_vector: &[f32],
    limit: i64,
    namespace: Option<&str>,
) -> anyhow::Result<Vec<(Node, f32)>> {
    search_golden_index_ns_weighted(pool, tenant_id, query_vector, limit, namespace, 0.7, 0.3).await
}

/// Like `search_golden_index_ns` but with explicit similarity/heat weights.
pub async fn search_golden_index_ns_weighted(
    pool: &PgPool,
    tenant_id: &str,
    query_vector: &[f32],
    limit: i64,
    namespace: Option<&str>,
    similarity_weight: f32,
    heat_weight: f32,
) -> anyhow::Result<Vec<(Node, f32)>> {
    // Wrap flat weights into a minimal RecallConfig for the type-aware path.
    let recall_config = sulcus_types::thermo::RecallConfig {
        similarity_weight,
        heat_weight,
        type_heat_weights: std::collections::HashMap::new(), // empty = always use global
        ..Default::default()
    };
    search_golden_index_ns_type_aware(pool, tenant_id, query_vector, limit, namespace, &recall_config).await
}

/// Vector search with **type-aware** scoring.
///
/// Each result's `memory_type` determines its effective heat weight via
/// `RecallConfig::heat_weight_for(type)`. Knowledge types (fact, procedural,
/// semantic) get lower heat influence so relevance dominates, while episodic
/// types retain stronger recency signal.
///
/// Scoring per-row:
///   `score = (similarity * sim_weight_for_type) + (heat * heat_weight_for_type)`
///
/// Falls back to global `heat_weight` when no per-type override exists.
pub async fn search_golden_index_ns_type_aware(
    pool: &PgPool,
    tenant_id: &str,
    query_vector: &[f32],
    limit: i64,
    namespace: Option<&str>,
    recall_config: &sulcus_types::thermo::RecallConfig,
) -> anyhow::Result<Vec<(Node, f32)>> {
    let query_vec = Vector::from(query_vector.to_vec());
    // Fetch a larger candidate set so re-ranking by heat doesn't lose good results.
    let fetch_limit = (limit * 3).max(30);

    // Use pgvector HNSW index with cosine distance operator (<=>).
    // Falls back to brute-force BYTEA if the embedding column is empty.
    let rows = if let Some(ns) = namespace {
        sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                    memory_type, modality, source_mime, namespace, \
                    (embedding <=> $2::vector) AS distance \
             FROM golden_index \
             WHERE tenant_id = $1 AND embedding IS NOT NULL AND namespace = $4 \
             AND archived_at IS NULL \
             ORDER BY embedding <=> $2::vector \
             LIMIT $3",
        )
        .bind(tenant_id)
        .bind(&query_vec)
        .bind(fetch_limit)
        .bind(ns)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                    memory_type, modality, source_mime, namespace, \
                    (embedding <=> $2::vector) AS distance \
             FROM golden_index \
             WHERE tenant_id = $1 AND embedding IS NOT NULL \
             AND archived_at IS NULL \
             ORDER BY embedding <=> $2::vector \
             LIMIT $3",
        )
        .bind(tenant_id)
        .bind(&query_vec)
        .bind(fetch_limit)
        .fetch_all(pool)
        .await
    };

    match rows {
        Ok(rows) if !rows.is_empty() => {
            let mut results: Vec<(Node, f32)> = rows
                .into_iter()
                .map(|r| {
                    let distance: f64 = r.try_get("distance").unwrap_or(1.0);
                    // Cosine distance → similarity: similarity = 1 - distance
                    let similarity = (1.0 - distance) as f32;
                    let heat: f32 = r.try_get("current_heat").unwrap_or(0.5);
                    let mtype: String = r
                        .get::<Option<String>, _>("memory_type")
                        .unwrap_or_else(|| "episodic".to_string());
                    // Type-aware scoring: knowledge types score on relevance,
                    // episodic types retain stronger recency influence.
                    let eff_sim_w = recall_config.similarity_weight_for(&mtype);
                    let eff_heat_w = recall_config.heat_weight_for(&mtype);
                    let score = (similarity * eff_sim_w) + (heat * eff_heat_w);
                    let node = Node {
                        id: r.try_get("id").unwrap_or_default(),
                        label: r.try_get("pointer_summary").unwrap_or_default(),
                        pointer_summary: r.try_get("pointer_summary").unwrap_or_default(),
                        base_utility: r.try_get("base_utility").unwrap_or(0.5),
                        current_heat: r.try_get("current_heat").unwrap_or(0.5),
                        is_pinned: r.try_get("is_pinned").unwrap_or(false),
                        memory_type: mtype,
                        modality: r
                            .get::<Option<String>, _>("modality")
                            .unwrap_or_else(|| "text".to_string()),
                        source_mime: r.get("source_mime"),
                        namespace: r
                            .get::<Option<String>, _>("namespace")
                            .unwrap_or_else(|| "default".to_string()),
                    };
                    (node, score)
                })
                .collect();
            // Re-rank by blended score and trim to the requested limit
            results.sort_by(|a, b| b.1.total_cmp(&a.1));
            results.truncate(limit as usize);
            Ok(results)
        }
        _ => {
            // Fallback: brute-force over BYTEA (for pre-migration data or if pgvector unavailable)
            search_golden_index_bytea_fallback(pool, tenant_id, query_vector, limit).await
        }
    }
}

/// Brute-force BYTEA fallback for search (pre-pgvector migration compat).
async fn search_golden_index_bytea_fallback(
    pool: &PgPool,
    tenant_id: &str,
    query_vector: &[f32],
    limit: i64,
) -> anyhow::Result<Vec<(Node, f32)>> {
    let rows = sqlx::query(
        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                memory_type, modality, source_mime, namespace, vector \
         FROM golden_index \
         WHERE tenant_id = $1 AND vector IS NOT NULL \
         LIMIT 500",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;

    let mut results = Vec::new();
    for r in rows {
        let stored_bytes: Vec<u8> = r.try_get("vector")?;
        if stored_bytes.len() != query_vector.len() * 4 {
            continue;
        }

        let stored_vec: Vec<f32> = stored_bytes
            .chunks_exact(4)
            .map(|c| {
                let arr: [u8; 4] = c.try_into().unwrap_or([0u8; 4]);
                f32::from_le_bytes(arr)
            })
            .collect();

        let score: f32 = query_vector
            .iter()
            .zip(stored_vec.iter())
            .map(|(a, b)| a * b)
            .sum();

        let node = Node {
            id: r.try_get("id")?,
            label: r.try_get("pointer_summary")?,
            pointer_summary: r.try_get("pointer_summary")?,
            base_utility: r.try_get("base_utility")?,
            current_heat: r.try_get("current_heat")?,
            is_pinned: r.try_get("is_pinned")?,
            memory_type: r
                .get::<Option<String>, _>("memory_type")
                .unwrap_or_else(|| "episodic".to_string()),
            modality: r
                .get::<Option<String>, _>("modality")
                .unwrap_or_else(|| "text".to_string()),
            source_mime: r.get("source_mime"),
            namespace: r
                .get::<Option<String>, _>("namespace")
                .unwrap_or_else(|| "default".to_string()),
        };
        results.push((node, score));
    }

    results.sort_by(|a, b| b.1.total_cmp(&a.1));
    results.truncate(limit as usize);
    Ok(results)
}

// ---------------------------------------------------------------------------
// Interaction Epoch Tracking
// ---------------------------------------------------------------------------

/// Increment the namespace interaction epoch counter and return the new epoch.
/// Creates the row if it doesn't exist (upsert).
pub async fn increment_namespace_epoch(
    pool: &PgPool,
    tenant_id: &str,
    namespace: &str,
) -> anyhow::Result<i64> {
    let epoch: i64 = sqlx::query_scalar(
        "INSERT INTO namespace_counters (tenant_id, namespace, interaction_epoch, last_active_at)
         VALUES ($1, $2, 1, now())
         ON CONFLICT (tenant_id, namespace) DO UPDATE SET
           interaction_epoch = namespace_counters.interaction_epoch + 1,
           last_active_at = now()
         RETURNING interaction_epoch",
    )
    .bind(tenant_id)
    .bind(namespace)
    .fetch_one(pool)
    .await?;
    Ok(epoch)
}

/// Stamp a node with the current namespace epoch and increment its recall_count.
pub async fn stamp_node_epoch(
    pool: &PgPool,
    tenant_id: &str,
    namespace: &str,
    node_id: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE golden_index SET
           interaction_epoch = (SELECT interaction_epoch FROM namespace_counters
                                WHERE tenant_id = $1 AND namespace = $2),
           last_recalled_at = now(),
           recall_count = recall_count + 1
         WHERE tenant_id = $1 AND id = $3::uuid",
    )
    .bind(tenant_id)
    .bind(namespace)
    .bind(node_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Backfill existing BYTEA vectors into the pgvector embedding column.
/// Called once at startup. Idempotent — skips rows that already have embeddings.
pub async fn backfill_pgvector_embeddings(pool: &PgPool) -> anyhow::Result<usize> {
    // Count first to avoid loading everything into memory
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM golden_index \
         WHERE vector IS NOT NULL AND embedding IS NULL AND octet_length(vector) = 1536",
    )
    .fetch_one(pool)
    .await?;

    if count == 0 {
        return Ok(0);
    }

    tracing::info!(count, "backfilling BYTEA vectors to pgvector embeddings (batched)");

    let mut migrated = 0usize;
    let batch_size = 100i64;

    loop {
        let rows = sqlx::query(
            "SELECT tenant_id, id, vector FROM golden_index \
             WHERE vector IS NOT NULL AND embedding IS NULL AND octet_length(vector) = 1536 \
             LIMIT $1",
        )
        .bind(batch_size)
        .fetch_all(pool)
        .await?;

        if rows.is_empty() {
            break;
        }

        for r in &rows {
            let tenant_id: String = r.try_get("tenant_id")?;
            let id: uuid::Uuid = r.try_get("id")?;
            let bytes: Vec<u8> = r.try_get("vector")?;

            let floats: Vec<f32> = bytes
                .chunks_exact(4)
                .map(|c| {
                    let arr: [u8; 4] = c.try_into().unwrap_or([0u8; 4]);
                    f32::from_le_bytes(arr)
                })
                .collect();

            let vec = Vector::from(floats);
            sqlx::query("UPDATE golden_index SET embedding = $1 WHERE tenant_id = $2 AND id = $3")
                .bind(&vec)
                .bind(&tenant_id)
                .bind(&id)
                .execute(pool)
                .await?;

            migrated += 1;
        }

        // Yield between batches to avoid monopolizing connections
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    tracing::info!(migrated, "pgvector backfill complete");
    Ok(migrated)
}

/// Backfill embeddings for memories that have no embedding at all.
/// Uses the server's fastembed model to generate 384-dim vectors.
pub async fn backfill_missing_embeddings(
    pool: &PgPool,
    state: &crate::AppState,
    tenant_id: Option<&str>,
) -> anyhow::Result<usize> {
    let count: i64 = if let Some(tid) = tenant_id {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM golden_index WHERE embedding IS NULL AND vector IS NULL AND tenant_id = $1",
        )
        .bind(tid)
        .fetch_one(pool)
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM golden_index WHERE embedding IS NULL AND vector IS NULL",
        )
        .fetch_one(pool)
        .await?
    };

    if count == 0 {
        return Ok(0);
    }

    tracing::info!(count, "backfilling missing embeddings from text");

    let mut backfilled = 0usize;
    let batch_size = 50i64;

    loop {
        let rows = if let Some(tid) = tenant_id {
            sqlx::query(
                "SELECT tenant_id, id, pointer_summary FROM golden_index \
                 WHERE embedding IS NULL AND vector IS NULL AND tenant_id = $1 \
                 LIMIT $2",
            )
            .bind(tid)
            .bind(batch_size)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query(
                "SELECT tenant_id, id, pointer_summary FROM golden_index \
                 WHERE embedding IS NULL AND vector IS NULL \
                 LIMIT $1",
            )
            .bind(batch_size)
            .fetch_all(pool)
            .await?
        };

        if rows.is_empty() {
            break;
        }

        for r in &rows {
            let tid: String = r.try_get("tenant_id")?;
            let id: uuid::Uuid = r.try_get("id")?;
            let text: String = r.try_get("pointer_summary")?;

            if let Some(embedding) = state.embed_query(&text) {
                let vec = pgvector::Vector::from(embedding);
                sqlx::query(
                    "UPDATE golden_index SET embedding = $1 WHERE tenant_id = $2 AND id = $3",
                )
                .bind(&vec)
                .bind(&tid)
                .bind(&id)
                .execute(pool)
                .await?;
                backfilled += 1;
            } else {
                tracing::warn!(id = %id, "failed to embed memory text");
            }
        }

        tracing::info!(backfilled, "embedding backfill batch complete");
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    tracing::info!(backfilled, "embedding backfill complete");
    Ok(backfilled)
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

/// Check an invitation token without consuming it. Returns the tenant_id if valid.
pub async fn peek_invitation(pool: &PgPool, token_hash: &str) -> anyhow::Result<Option<String>> {
    let row = sqlx::query(
        "SELECT tenant_id FROM invitations WHERE token_hash = $1 AND expires_at > now()",
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| r.get("tenant_id")))
}

/// Atomically consume an invitation token and return the associated tenant_id.
pub async fn consume_invitation(pool: &PgPool, token_hash: &str) -> anyhow::Result<Option<String>> {
    let row = sqlx::query(
        "DELETE FROM invitations WHERE token_hash = $1 AND expires_at > now() RETURNING tenant_id",
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| r.get("tenant_id")))
}

/// Create a new API key for a tenant.
pub async fn insert_api_key(
    pool: &PgPool,
    tenant_id: &str,
    key_hash: &str,
    plan_tier: &str,
) -> anyhow::Result<()> {
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

    Ok(rows
        .into_iter()
        .map(|r| TenantUsageRow {
            month: r.get::<chrono::NaiveDate, _>("month").to_string(),
            sync_requests: r.get("sync_requests"),
            nodes_added: r.get("nodes_added"),
            avg_latency_ms: r.get("avg_latency_ms"),
            max_latency_ms: r.get("max_latency_ms"),
        })
        .collect())
}

#[derive(serde::Serialize)]
pub struct GraphNode {
    pub id: uuid::Uuid,
    pub label: String,
    pub heat: f32,
    pub memory_type: String,
    pub namespace: Option<String>,
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
    pub total_nodes: i64,
    /// Offset used to produce this page (echoed back for client convenience)
    pub offset: i64,
    /// Page size requested (echoed back)
    pub page_size: i64,
    /// True if more nodes exist beyond this page
    pub has_more: bool,
}

/// Return a graph snapshot (nodes + edges) for a tenant, with optional pagination.
///
/// - `limit`: max nodes per page (capped at 2000 server-side). Default 500.
/// - `offset`: number of hottest nodes to skip. Enables progressive chunked loading.
/// - `namespace`: filter to a single namespace.
/// - `compact`: omit labels for lightweight rendering.
///
/// When `offset > 0`, edges are **not** returned — the first page (offset=0) delivers
/// all edges between the visible node set, and subsequent pages are node-only patches.
/// This keeps page sizes small and avoids re-fetching the full edge set per chunk.
pub async fn get_graph_snapshot(
    pool: &PgPool,
    tenant_id: &str,
    limit: Option<i64>,
    offset: i64,
    namespace: Option<&str>,
    compact: bool,
) -> anyhow::Result<GraphSnapshot> {
    let label_expr = if compact {
        "''"
    } else {
        "LEFT(pointer_summary, 128)"
    };
    let mut sql = format!(
        "SELECT id, {} AS pointer_summary, current_heat, memory_type, namespace FROM golden_index WHERE tenant_id = $1",
        label_expr
    );
    let mut bind_idx = 2u32;

    if namespace.is_some() {
        sql.push_str(&format!(" AND namespace = ${bind_idx}"));
        bind_idx += 1;
    }

    sql.push_str(" ORDER BY current_heat DESC");

    if limit.is_some() {
        sql.push_str(&format!(" LIMIT ${bind_idx}"));
        bind_idx += 1;
    }

    // Always apply OFFSET for pagination (0 = no skip, which is a no-op but explicit)
    sql.push_str(&format!(" OFFSET ${bind_idx}"));
    let _ = bind_idx;

    let mut q = sqlx::query(&sql).bind(tenant_id);
    if let Some(ns) = namespace {
        q = q.bind(ns);
    }
    if let Some(lim) = limit {
        q = q.bind(lim);
    }
    q = q.bind(offset);

    // Total count (unfiltered by limit, but respecting namespace filter)
    let count_sql = if namespace.is_some() {
        "SELECT COUNT(*) as cnt FROM golden_index WHERE tenant_id = $1 AND namespace = $2"
    } else {
        "SELECT COUNT(*) as cnt FROM golden_index WHERE tenant_id = $1"
    };
    let mut count_q = sqlx::query(count_sql).bind(tenant_id);
    if let Some(ns) = namespace {
        count_q = count_q.bind(ns);
    }
    let total_nodes: i64 = count_q.fetch_one(pool).await?.get("cnt");

    let node_rows = q.fetch_all(pool).await?;

    let nodes: Vec<GraphNode> = node_rows
        .into_iter()
        .map(|r| GraphNode {
            id: r.get("id"),
            label: r.get("pointer_summary"),
            heat: r.get("current_heat"),
            memory_type: r
                .get::<Option<String>, _>("memory_type")
                .unwrap_or_else(|| "episodic".to_string()),
            namespace: r.get::<Option<String>, _>("namespace"),
        })
        .collect();

    // Collect node IDs for edge filtering
    let node_ids: std::collections::HashSet<uuid::Uuid> = nodes.iter().map(|n| n.id).collect();
    let page_size = limit.unwrap_or(500);
    let has_more = (nodes.len() as i64) == page_size && (offset + page_size) < total_nodes;

    // Edges are only fetched for the first page (offset == 0).
    // Subsequent pages are node-only patches — the client merges them into the graph
    // without re-fetching edges, keeping response sizes small.
    let links = if offset == 0 {
        let edge_rows = sqlx::query(
            "SELECT source_id, target_id, weight FROM golden_edges WHERE tenant_id = $1",
        )
        .bind(tenant_id)
        .fetch_all(pool)
        .await?;

        // Only include edges where BOTH endpoints are in the fetched node set
        edge_rows
            .into_iter()
            .filter_map(|r| {
                let source: uuid::Uuid = r.get("source_id");
                let target: uuid::Uuid = r.get("target_id");
                if node_ids.contains(&source) && node_ids.contains(&target) {
                    Some(GraphLink {
                        source,
                        target,
                        weight: r.get("weight"),
                    })
                } else {
                    None
                }
            })
            .collect()
    } else {
        // Paginated pages: skip edge fetch entirely
        Vec::new()
    };

    Ok(GraphSnapshot {
        nodes,
        links,
        total_nodes,
        offset,
        page_size,
        has_more,
    })
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
        assert!(
            (score - 0.0).abs() < 1e-6,
            "orthogonal vectors score should be 0.0"
        );
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
        let mut pairs: Vec<(usize, f32)> =
            vec![(0, f32::INFINITY), (1, 0.5), (2, f32::NEG_INFINITY)];
        sort_by_score_desc(&mut pairs);
        assert_eq!(pairs[0].1, f32::INFINITY);
        assert_eq!(pairs[2].1, f32::NEG_INFINITY);
    }
}

// ---------------------------------------------------------------------------
// Namespace ACL
// ---------------------------------------------------------------------------

/// Preloaded namespace ACL for a specific agent. Enables O(1) checks per namespace.
pub struct NamespaceAcl {
    /// Explicit rules: namespace -> "allow" | "deny"
    rules: std::collections::HashMap<String, String>,
    /// Tenant default policy — "allow" if not set
    default_policy: String,
    /// Whether this agent has an identity (non-empty label)
    pub has_identity: bool,
}

impl NamespaceAcl {
    /// Check if access to a namespace is allowed.
    pub fn is_allowed(&self, namespace: &str) -> bool {
        if !self.has_identity {
            return true; // dashboard/OIDC user — always allow
        }
        match self.rules.get(namespace) {
            Some(policy) => policy == "allow",
            None => self.default_policy == "allow",
        }
    }
}

/// Load the full namespace ACL for an agent in one query. Use for batch filtering.
pub async fn load_namespace_acl(
    pool: &PgPool,
    tenant_id: &str,
    agent_label: &str,
) -> NamespaceAcl {
    if agent_label.is_empty() {
        return NamespaceAcl {
            rules: std::collections::HashMap::new(),
            default_policy: "allow".to_string(),
            has_identity: false,
        };
    }

    let rows = sqlx::query(
        "SELECT namespace, policy FROM namespace_acl WHERE tenant_id = $1 AND agent_label = $2"
    )
    .bind(tenant_id)
    .bind(agent_label)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut rules = std::collections::HashMap::new();
    for r in &rows {
        let ns: String = r.get("namespace");
        let policy: String = r.get("policy");
        rules.insert(ns, policy);
    }

    let default_policy = sqlx::query_scalar::<_, String>(
        "SELECT default_policy FROM namespace_defaults WHERE tenant_id = $1"
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None)
    .unwrap_or_else(|| "allow".to_string());

    NamespaceAcl {
        rules,
        default_policy,
        has_identity: true,
    }
}

/// Check if an agent is allowed to access a namespace (single check, hits DB).
/// For batch filtering, prefer load_namespace_acl() + acl.is_allowed().
pub async fn check_namespace_access(
    pool: &PgPool,
    tenant_id: &str,
    agent_label: &str,
    namespace: &str,
) -> bool {
    let acl = load_namespace_acl(pool, tenant_id, agent_label).await;
    acl.is_allowed(namespace)
}

/// Get all namespace ACL rules for a tenant.
pub async fn list_namespace_acl(pool: &PgPool, tenant_id: &str) -> anyhow::Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        "SELECT id, agent_label, namespace, policy, created_at FROM namespace_acl WHERE tenant_id = $1 ORDER BY agent_label, namespace"
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.iter().map(|r| {
        serde_json::json!({
            "id": r.get::<uuid::Uuid, _>("id").to_string(),
            "agent_label": r.get::<String, _>("agent_label"),
            "namespace": r.get::<String, _>("namespace"),
            "policy": r.get::<String, _>("policy"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        })
    }).collect())
}

/// Get tenant's default namespace policy.
pub async fn get_namespace_default(pool: &PgPool, tenant_id: &str) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT default_policy FROM namespace_defaults WHERE tenant_id = $1"
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None)
    .unwrap_or_else(|| "allow".to_string())
}

/// Set or update a namespace ACL rule.
pub async fn upsert_namespace_acl(
    pool: &PgPool,
    tenant_id: &str,
    agent_label: &str,
    namespace: &str,
    policy: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO namespace_acl (tenant_id, agent_label, namespace, policy)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, agent_label, namespace) DO UPDATE SET policy = $4"
    )
    .bind(tenant_id)
    .bind(agent_label)
    .bind(namespace)
    .bind(policy)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a namespace ACL rule.
pub async fn delete_namespace_acl(pool: &PgPool, tenant_id: &str, rule_id: &str) -> anyhow::Result<bool> {
    let id: uuid::Uuid = rule_id.parse().map_err(|_| anyhow::anyhow!("invalid UUID"))?;
    let result = sqlx::query("DELETE FROM namespace_acl WHERE tenant_id = $1 AND id = $2")
        .bind(tenant_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Set the tenant-level default namespace policy.
pub async fn set_namespace_default(pool: &PgPool, tenant_id: &str, policy: &str) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO namespace_defaults (tenant_id, default_policy, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (tenant_id) DO UPDATE SET default_policy = $2, updated_at = now()"
    )
    .bind(tenant_id)
    .bind(policy)
    .execute(pool)
    .await?;
    Ok(())
}

/// Get all distinct namespaces for a tenant.
pub async fn list_namespaces(pool: &PgPool, tenant_id: &str) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT namespace FROM golden_index WHERE tenant_id = $1 ORDER BY namespace"
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Get all distinct agent labels for a tenant.
pub async fn list_agent_labels(pool: &PgPool, tenant_id: &str) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT label FROM api_keys WHERE tenant_id = $1 AND label IS NOT NULL AND label != '' ORDER BY label"
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
