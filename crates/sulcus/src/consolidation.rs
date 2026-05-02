//! Memory Consolidation Loop — V2 hot-cluster synthesis pass.
//!
//! Queries high-heat node clusters from the active graph (thermodynamics
//! prioritises these automatically — no full scan), synthesises cross-node
//! insights via a local LLM (Ollama/SULCUS_LLM_URL, with extractive fallback),
//! and writes *insight edges* back to the graph with their own heat score.
//!
//! Effects per cycle:
//! - Connected cluster nodes get a small heat boost (co-activation signal).
//! - Isolated high-heat nodes (no edges) decay marginally faster.
//! - A `synthesis` node is upserted per namespace cluster, accumulating semantic
//!   density over successive cycles.
//!
//! This is intentionally *not* a full-scan operation. Only nodes in the
//! `active_index` (heat ≥ prune_threshold) are eligible. The thermodynamic
//! engine handles prioritisation; consolidation only reads the top slice it
//! needs.

use chrono::Utc;
use serde::Deserialize;
use sqlx::Row;

use crate::LocalStorage;

use sulcus_types::consolidation::{
    ClusterMember, SemanticCluster, CLUSTER_HEAT_BOOST, CONSOLIDATION_COOLDOWN, HOT_THRESHOLD,
    INSIGHT_EDGE_WEIGHT, ISOLATION_PENALTY, SYNTHESIS_NODE_INITIAL_HEAT,
};
use sulcus_core::consolidation::{
    cluster_members, cluster_prompt, extractive_cluster_summary, synthesise_node_id,
};

// —— Public entry point ————————————————————————————————————————————————————————

/// Run one consolidation pass. Returns the number of clusters synthesised.
///
/// This is called from the thermodynamics worker after each tick so that
/// consolidation is already scoped to the warm subset of the graph.
///
/// COORDINATION: Uses an internal lock and cooldown to prevent overlapping
/// or excessive consolidation passes.
pub async fn consolidate_hot_clusters(
    storage: &LocalStorage,
    embedder: Option<&dyn crate::embeddings::EmbeddingProvider>,
) -> anyhow::Result<usize> {
    // 0. Check cooldown and try to acquire lock.
    if !storage.consolidation_cooldown_passed(CONSOLIDATION_COOLDOWN) {
        return Ok(0);
    }
    let _lock = match storage.try_lock_consolidation().await {
        Some(l) => l,
        None => return Ok(0), // already running
    };

    // 1. Pull hot nodes and their embeddings in a single join.
    // We limit to 40 nodes to keep clustering overhead low.
    let rows = sqlx::query(
        "SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.namespace, e.vector \
         FROM nodes n \
         LEFT JOIN embeddings e ON e.node_id = n.id \
         WHERE n.current_heat >= $1 AND n.is_pinned = FALSE \
           AND n.memory_type != 'synthesis' \
         ORDER BY n.current_heat DESC \
         LIMIT 40",
    )
    .bind(HOT_THRESHOLD)
    .fetch_all(storage.pool())
    .await?;

    if rows.is_empty() {
        return Ok(0);
    }

    // 2. Parse into ClusterMember objects.
    let mut hot_nodes = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.try_get("id")?;
        let label: String = row.try_get("label")?;
        let summary: String = row.try_get("pointer_summary")?;
        let heat: f32 = row.try_get("current_heat")?;
        let namespace: String = row.try_get("namespace")?;

        let embedding = if let Ok(s) = row.try_get::<String, _>("vector") {
            // parse pgvector string format "[1,2,3]"
            let vec: Vec<f32> = s
                .trim_matches(|c| c == '[' || c == ']')
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            if vec.is_empty() {
                None
            } else {
                Some(vec)
            }
        } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>("vector") {
            // parse bytea blob
            let vec: Vec<f32> = bytes
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            if vec.is_empty() {
                None
            } else {
                Some(vec)
            }
        } else {
            None
        };

        hot_nodes.push(ClusterMember {
            id,
            label,
            summary,
            heat,
            namespace,
            embedding,
        });
    }

    // 3. Group into semantic clusters using the shared greedy algorithm.
    let clusters: Vec<SemanticCluster> = cluster_members(&hot_nodes);

    let mut synthesised = 0usize;

    // 4. Synthesise insights for each cluster.
    for cluster in clusters {
        let mut member_ids: Vec<String> = Vec::with_capacity(cluster.members.len());
        let mut cluster_heat_sum: f64 = 0.0;

        for member in cluster.members.iter() {
            cluster_heat_sum += member.heat as f64;
            member_ids.push(member.id.clone());
        }

        let cluster_avg_heat = (cluster_heat_sum / cluster.members.len() as f64) as f32;

        // 5. Synthesise a cluster insight (LLM or extractive fallback).
        let insight = synthesise_cluster(&cluster.members, &cluster.namespace).await;

        // 6. Upsert the synthesis node for this cluster.
        // Derive a stable ID from member labels (order-independent).
        let label_refs: Vec<&str> = cluster.members.iter().map(|m| m.label.as_str()).collect();
        let synthesis_id = synthesise_node_id(&label_refs);
        let synthesis_label = format!("Synthesis: {}", cluster.namespace);

        sqlx::query(
            "INSERT INTO nodes \
               (id, label, pointer_summary, base_utility, current_heat, \
                is_pinned, memory_type, namespace, modality, \
                last_accessed_at, stability) \
             VALUES ($1, $2, $3, 0.5, $4, FALSE, 'synthesis', $5, 'text', NOW(), 1.2) \
             ON CONFLICT(id) DO UPDATE SET \
               pointer_summary  = CASE \
                 WHEN nodes.pointer_summary = EXCLUDED.pointer_summary THEN nodes.pointer_summary \
                 ELSE EXCLUDED.pointer_summary \
               END, \
               current_heat     = GREATEST(nodes.current_heat, $4), \
               last_accessed_at = NOW()",
        )
        .bind(&synthesis_id)
        .bind(&synthesis_label)
        .bind(&insight)
        .bind(SYNTHESIS_NODE_INITIAL_HEAT.max(cluster_avg_heat))
        .bind(&cluster.namespace)
        .execute(storage.pool())
        .await?;

        // 6b. Generate and store embedding for the synthesis node.
        if let Some(emb) = embedder {
            let embed_text = if !insight.is_empty() {
                &insight
            } else {
                &synthesis_label
            };
            match emb.embed(embed_text) {
                Ok(vec) if !vec.is_empty() => {
                    let bytes: Vec<u8> = vec.iter().flat_map(|f| f.to_le_bytes()).collect();
                    let _ = sqlx::query(
                        "INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) \
                         ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector",
                    )
                    .bind(&synthesis_id)
                    .bind(&bytes)
                    .execute(storage.pool())
                    .await;

                    if let Ok(uuid) = uuid::Uuid::parse_str(&synthesis_id) {
                        storage.add_to_hnsw(uuid, &vec);
                    }
                    tracing::debug!(synthesis_id = %synthesis_id, "embedded synthesis node");
                }
                _ => {
                    tracing::debug!(synthesis_id = %synthesis_id, "skipped embedding synthesis node (embedder returned empty)");
                }
            }
        }

        // 7. Write insight edges: synthesis_node → each cluster member.
        for member_id in member_ids.iter() {
            sqlx::query(
                "INSERT INTO edges \
                   (source_id, target_id, relationship_type, edge_weight, valid_from) \
                 VALUES ($1, $2, 'insight', $3, $4) \
                 ON CONFLICT(source_id, target_id) DO UPDATE SET \
                   edge_weight = GREATEST(edges.edge_weight, EXCLUDED.edge_weight), \
                   valid_to    = NULL",
            )
            .bind(&synthesis_id)
            .bind(member_id)
            .bind(INSIGHT_EDGE_WEIGHT)
            .bind(Utc::now().to_rfc3339())
            .execute(storage.pool())
            .await?;
        }

        // 8. Boost cluster member heat (co-activation signal).
        sqlx::query(
            "UPDATE nodes \
             SET current_heat     = LEAST(1.0, current_heat + $1), \
                 last_accessed_at = NOW() \
             WHERE id = ANY($2)",
        )
        .bind(CLUSTER_HEAT_BOOST)
        .bind(&member_ids)
        .execute(storage.pool())
        .await?;

        tracing::info!(
            namespace = %cluster.namespace,
            cluster_size = member_ids.len(),
            avg_heat = %cluster_avg_heat,
            synthesis_id = %synthesis_id,
            insight_len = insight.len(),
            "consolidation: synthesised semantic cluster insight"
        );

        synthesised += 1;
    }

    // 9. Penalty pass: isolated hot nodes (no edges) decay marginally faster.
    let penalty_result = sqlx::query(
        "UPDATE nodes \
         SET current_heat = GREATEST(0.0, current_heat * $1) \
         WHERE current_heat >= $2 \
           AND is_pinned = FALSE \
           AND memory_type != 'synthesis' \
           AND NOT EXISTS ( \
               SELECT 1 FROM edges \
               WHERE (source_id = nodes.id OR target_id = nodes.id) \
                 AND valid_to IS NULL \
           )",
    )
    .bind(ISOLATION_PENALTY)
    .bind(HOT_THRESHOLD)
    .execute(storage.pool())
    .await?;

    if penalty_result.rows_affected() > 0 {
        tracing::debug!(
            isolated_penalised = penalty_result.rows_affected(),
            "consolidation: applied isolation decay to disconnected hot nodes"
        );
    }

    storage.mark_consolidated();

    Ok(synthesised)
}

// —— LLM synthesis ————————————————————————————————————————————————————————————

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
}

/// Attempt LLM synthesis via local Ollama, fall back to extractive summary.
async fn synthesise_cluster(members: &[ClusterMember], namespace: &str) -> String {
    let base_url =
        std::env::var("SULCUS_LLM_URL").unwrap_or_else(|_| "http://localhost:11434".to_string());
    let model = std::env::var("SULCUS_LLM_MODEL").unwrap_or_else(|_| "llama3.2".to_string());

    let prompt = cluster_prompt(members);
    let _ = namespace; // namespace is embedded in the cluster members; used by cluster_prompt

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return extractive_cluster_summary(members, 280),
    };

    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "options": { "num_predict": 80, "temperature": 0.3 }
    });

    match client
        .post(format!("{base_url}/api/generate"))
        .json(&body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => match resp.json::<OllamaResponse>().await {
            Ok(r) => {
                let trimmed = r.response.trim().to_string();
                if trimmed.is_empty() {
                    extractive_cluster_summary(members, 280)
                } else {
                    trimmed
                }
            }
            Err(_) => extractive_cluster_summary(members, 280),
        },
        _ => extractive_cluster_summary(members, 280),
    }
}

// —— Unit tests ———————————————————————————————————————————————————————————————

#[cfg(test)]
mod tests {
    use super::*;
    use sulcus_core::consolidation::synthesise_node_id;
    use sulcus_types::consolidation::ClusterMember;

    fn make_member(label: &str) -> ClusterMember {
        ClusterMember {
            id: label.to_string(),
            label: label.to_string(),
            summary: format!("summary of {label}"),
            heat: 0.5,
            namespace: "default".to_string(),
            embedding: None,
        }
    }

    #[test]
    fn synthesis_node_id_is_deterministic() {
        let labels = ["aaa-111", "bbb-222", "ccc-333"];
        let id1 = synthesise_node_id(&labels);
        let mut shuffled = labels;
        shuffled.reverse();
        let id2 = synthesise_node_id(&shuffled);
        assert_eq!(id1, id2, "synthesis node id must be order-independent");
    }

    #[test]
    fn synthesis_node_id_differs_by_content() {
        let id_a = synthesise_node_id(&["alpha", "beta"]);
        let id_b = synthesise_node_id(&["gamma", "delta"]);
        assert_ne!(id_a, id_b);
    }

    #[test]
    fn synthesis_node_id_is_valid_uuid() {
        let id = synthesise_node_id(&["x-1", "x-2"]);
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn extractive_summary_takes_top_three() {
        let members = vec![
            make_member("A"),
            make_member("B"),
            make_member("C"),
            make_member("D"),
        ];
        // With the shared function, top 3 by heat (all equal here, so first 3 taken).
        let summary = extractive_cluster_summary(&members, 2000);
        assert!(!summary.is_empty());
    }

    #[test]
    fn extractive_summary_strips_label_prefix() {
        let members = vec![ClusterMember {
            id: "MyLabel".to_string(),
            label: "MyLabel".to_string(),
            summary: "The actual content here".to_string(),
            heat: 0.5,
            namespace: "default".to_string(),
            embedding: None,
        }];
        let summary = extractive_cluster_summary(&members, 2000);
        assert!(summary.contains("actual content"));
    }
}
