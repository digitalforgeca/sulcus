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
use uuid::Uuid;

use crate::LocalStorage;

/// Minimum number of hot nodes in a namespace cluster to trigger synthesis.
const MIN_CLUSTER_SIZE: usize = 2;

/// Maximum nodes to pull per namespace cluster per cycle (keeps prompts bounded).
const MAX_CLUSTER_NODES: i64 = 6;

/// Heat threshold for a node to be considered "hot" for consolidation purposes.
const HOT_THRESHOLD: f32 = 0.4;

/// Small heat bump applied to all cluster members after synthesis.
const CLUSTER_HEAT_BOOST: f32 = 0.05;

/// Additional decay multiplier applied to isolated hot nodes (heat ≥ HOT_THRESHOLD
/// but zero edges). Applied as `heat *= ISOLATION_PENALTY`.
const ISOLATION_PENALTY: f32 = 0.95;

/// Edge weight for the insight → cluster-member edge.
const INSIGHT_EDGE_WEIGHT: f32 = 0.7;

/// Initial heat assigned to a newly created synthesis node.
const SYNTHESIS_NODE_INITIAL_HEAT: f32 = 0.6;

// —— Public entry point ————————————————————————————————————————————————————————

/// Run one consolidation pass. Returns the number of namespaces synthesised.
///
/// This is called from the thermodynamics worker after each tick so that
/// consolidation is already scoped to the warm subset of the graph.
pub async fn consolidate_hot_clusters(storage: &LocalStorage) -> anyhow::Result<usize> {
    // 1. Enumerate distinct namespaces that have at least MIN_CLUSTER_SIZE hot nodes.
    let ns_rows = sqlx::query(
        "SELECT namespace, COUNT(*) AS cnt \
         FROM nodes \
         WHERE current_heat >= $1 AND is_pinned = FALSE \
           AND memory_type != 'synthesis' \
         GROUP BY namespace \
         HAVING COUNT(*) >= $2 \
         ORDER BY AVG(current_heat) DESC \
         LIMIT 10",
    )
    .bind(HOT_THRESHOLD)
    .bind(MIN_CLUSTER_SIZE as i64)
    .fetch_all(storage.pool())
    .await?;

    let mut synthesised = 0usize;

    if !ns_rows.is_empty() {
        for ns_row in ns_rows.iter() {
            let namespace: String = ns_row.try_get("namespace")?;

            // 2. Pull the hottest nodes in this namespace.
            let node_rows = sqlx::query(
                "SELECT id, label, pointer_summary, current_heat \
                 FROM nodes \
                 WHERE namespace = $1 \
                   AND current_heat >= $2 \
                   AND memory_type != 'synthesis' \
                   AND is_pinned = FALSE \
                 ORDER BY current_heat DESC \
                 LIMIT $3",
            )
            .bind(&namespace)
            .bind(HOT_THRESHOLD)
            .bind(MAX_CLUSTER_NODES)
            .fetch_all(storage.pool())
            .await?;

            if node_rows.len() < MIN_CLUSTER_SIZE {
                continue;
            }

            // 3. Collect member ids, labels, and summaries.
            let mut member_ids: Vec<String> = Vec::with_capacity(node_rows.len());
            let mut cluster_heat_sum: f64 = 0.0;
            let mut corpus_parts: Vec<String> = Vec::with_capacity(node_rows.len());

            for row in node_rows.iter() {
                let id: String = row.try_get("id")?;
                let label: String = row.try_get("label")?;
                let summary: String = row.try_get("pointer_summary")?;
                let heat: f32 = row.try_get("current_heat")?;
                cluster_heat_sum += heat as f64;
                corpus_parts.push(format!("* [{label}]: {summary}"));
                member_ids.push(id);
            }

            let cluster_avg_heat = (cluster_heat_sum / node_rows.len() as f64) as f32;
            let corpus = corpus_parts.join("\n");

            // 4. Synthesise a cluster insight (LLM or extractive fallback).
            let insight = synthesise_cluster(&corpus, &namespace).await;

            // 5. Upsert the synthesis node for this namespace cluster.
            let synthesis_id = synthesise_node_id(&namespace, &member_ids);
            let synthesis_label = format!("Synthesis: {namespace}");

            sqlx::query(
                "INSERT INTO nodes \
                   (id, label, pointer_summary, base_utility, current_heat, \
                    is_pinned, memory_type, namespace, modality, \
                    last_accessed_at, stability) \
                 VALUES ($1, $2, $3, 0.5, $4, FALSE, 'synthesis', $5, 'text', NOW(), 1.2) \
                 ON CONFLICT(id) DO UPDATE SET \
                   pointer_summary  = EXCLUDED.pointer_summary, \
                   current_heat     = GREATEST(nodes.current_heat, $4), \
                   last_accessed_at = NOW()",
            )
            .bind(&synthesis_id)
            .bind(&synthesis_label)
            .bind(&insight)
            .bind(SYNTHESIS_NODE_INITIAL_HEAT.max(cluster_avg_heat))
            .bind(&namespace)
            .execute(storage.pool())
            .await?;

            // 6. Write insight edges: synthesis_node → each cluster member.
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

            // 7. Boost cluster member heat (co-activation signal).
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
                namespace = %namespace,
                cluster_size = member_ids.len(),
                avg_heat = %cluster_avg_heat,
                synthesis_id = %synthesis_id,
                insight_len = insight.len(),
                "consolidation: synthesised hot cluster insight"
            );

            synthesised += 1;
        }
    }

    // 8. Penalty pass: isolated hot nodes (no edges) decay marginally faster.
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

    Ok(synthesised)
}

// —— LLM synthesis ————————————————————————————————————————————————————————————

/// Build a synthesis prompt for the cluster corpus.
fn cluster_prompt(corpus: &str, namespace: &str) -> String {
    format!(
        "You are a memory synthesis engine. Given a cluster of related memory nodes \
         from namespace \"{namespace}\", identify the single unifying insight or pattern \
         they share. Output 1-2 concise sentences suitable as a semantic anchor. \
         Preserve named entities and key relationships.\n\nMemory cluster:\n{corpus}\n\nInsight:"
    )
}

/// Extractive fallback: take first sentence of each node summary, truncated.
fn extractive_cluster_summary(corpus: &str) -> String {
    let lines: Vec<&str> = corpus
        .lines()
        .filter_map(|l| {
            let trimmed = l.trim_start_matches('*').trim();
            trimmed
                .find("]: ")
                .map(|pos| trimmed[pos + 3..].trim())
                .filter(|s| !s.is_empty())
        })
        .take(3)
        .collect();

    let joined = lines.join(" | ");
    if joined.len() > 280 {
        format!("{}...", &joined[..277])
    } else {
        joined
    }
}

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
}

/// Attempt LLM synthesis via local Ollama, fall back to extractive summary.
async fn synthesise_cluster(corpus: &str, namespace: &str) -> String {
    let base_url = std::env::var("SULCUS_LLM_URL")
        .unwrap_or_else(|_| "http://localhost:11434".to_string());
    let model = std::env::var("SULCUS_LLM_MODEL").unwrap_or_else(|_| "llama3.2".to_string());

    let prompt = cluster_prompt(corpus, namespace);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return extractive_cluster_summary(corpus),
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
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<OllamaResponse>().await {
                Ok(r) => {
                    let trimmed = r.response.trim().to_string();
                    if trimmed.is_empty() {
                        extractive_cluster_summary(corpus)
                    } else {
                        trimmed
                    }
                }
                Err(_) => extractive_cluster_summary(corpus),
            }
        }
        _ => extractive_cluster_summary(corpus),
    }
}

// —— Helpers ——————————————————————————————————————————————————————————————————

/// Derive a stable, deterministic UUID for a synthesis node from its namespace
/// and cluster members.
fn synthesise_node_id(namespace: &str, member_ids: &[String]) -> String {
    let mut sorted = member_ids.to_vec();
    sorted.sort();
    let key = format!("consolidation:{}:{}", namespace, sorted.join(","));
    Uuid::new_v5(&Uuid::NAMESPACE_DNS, key.as_bytes()).to_string()
}

// —— Unit tests ———————————————————————————————————————————————————————————————

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthesis_node_id_is_deterministic() {
        let ns = "default";
        let members = vec![
            "aaa-111".to_string(),
            "bbb-222".to_string(),
            "ccc-333".to_string(),
        ];
        let id1 = synthesise_node_id(ns, &members);
        let mut shuffled = members.clone();
        shuffled.reverse();
        let id2 = synthesise_node_id(ns, &shuffled);
        assert_eq!(id1, id2, "synthesis node id must be order-independent");
    }

    #[test]
    fn synthesis_node_id_differs_by_namespace() {
        let members = vec!["aaa-111".to_string(), "bbb-222".to_string()];
        let id_a = synthesise_node_id("alpha", &members);
        let id_b = synthesise_node_id("beta", &members);
        assert_ne!(id_a, id_b);
    }

    #[test]
    fn synthesis_node_id_is_valid_uuid() {
        let id = synthesise_node_id("test", &["x-1".to_string(), "x-2".to_string()]);
        assert!(Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn extractive_summary_truncates() {
        let corpus = "* [A]: First thing\n* [B]: Second thing\n* [C]: Third thing\n* [D]: Fourth thing";
        let summary = extractive_cluster_summary(corpus);
        assert!(summary.contains("First thing"));
        assert!(summary.contains("Second thing"));
        assert!(summary.contains("Third thing"));
        assert!(!summary.contains("Fourth thing"));
    }

    #[test]
    fn extractive_summary_strips_label_prefix() {
        let corpus = "* [MyLabel]: The actual content here";
        let summary = extractive_cluster_summary(corpus);
        assert!(!summary.contains("MyLabel"));
        assert!(summary.contains("actual content"));
    }
}
