//! Pure consolidation logic for the hot-cluster synthesis pass.
//!
//! All functions in this module are pure in-memory computations with zero I/O.
//! They operate on [`ClusterMember`] and [`SemanticCluster`] types from
//! `sulcus_types::consolidation` and can be called from any runtime context.
//!
//! The impure parts (SQL queries, HTTP calls to Ollama, tokio async tasks) remain
//! in `sulcus`.

use std::collections::HashSet;
use uuid::Uuid;

use sulcus_types::consolidation::{
    ClusterMember, SemanticCluster, MAX_CLUSTER_NODES, MAX_CLUSTERS_PER_PASS, MIN_CLUSTER_SIZE,
    SIMILARITY_THRESHOLD,
};
use sulcus_types::math::cosine_similarity;

// ── Public API ─────────────────────────────────────────────────────────────────

/// Derive a deterministic UUID v5 for a synthesis node from cluster member labels.
///
/// The result is order-independent: sorting the labels before hashing guarantees
/// that the same set of labels always produces the same UUID regardless of input
/// ordering.
///
/// # Examples
///
/// ```
/// use sulcus_core::consolidation::synthesise_node_id;
///
/// let id1 = synthesise_node_id(&["alpha", "beta", "gamma"]);
/// let id2 = synthesise_node_id(&["gamma", "alpha", "beta"]);
/// assert_eq!(id1, id2);
/// ```
pub fn synthesise_node_id(cluster_labels: &[&str]) -> String {
    let mut sorted: Vec<&str> = cluster_labels.to_vec();
    sorted.sort();
    let key = format!("consolidation:{}", sorted.join(","));
    Uuid::new_v5(&Uuid::NAMESPACE_DNS, key.as_bytes()).to_string()
}

/// Extractive cluster summary: picks the highest-heat members' labels and
/// truncates to `max_len` bytes.
///
/// Sorts members by heat descending, takes the top three, and joins their
/// summaries with ` | `. If the result exceeds `max_len`, it is truncated on
/// a valid UTF-8 boundary and suffixed with `...`.
pub fn extractive_cluster_summary(members: &[ClusterMember], max_len: usize) -> String {
    let mut sorted: Vec<&ClusterMember> = members.iter().collect();
    sorted.sort_by(|a, b| b.heat.partial_cmp(&a.heat).unwrap_or(std::cmp::Ordering::Equal));

    let lines: Vec<&str> = sorted
        .iter()
        .take(3)
        .map(|m| m.summary.as_str())
        .filter(|s| !s.is_empty())
        .collect();

    let joined = lines.join(" | ");

    if joined.len() > max_len {
        // Truncate on a valid UTF-8 char boundary.
        let trunc = max_len.saturating_sub(3); // room for "..."
        let mut end = trunc;
        while end > 0 && !joined.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &joined[..end])
    } else {
        joined
    }
}

/// Format a prompt for LLM synthesis of a semantic cluster.
///
/// Produces a structured prompt that instructs the model to identify a single
/// unifying insight across the cluster members. Preserves named entities and
/// key relationships.
pub fn cluster_prompt(members: &[ClusterMember]) -> String {
    // All members must share the same namespace; use the first one's.
    let namespace = members.first().map(|m| m.namespace.as_str()).unwrap_or("default");

    let corpus: String = members
        .iter()
        .map(|m| format!("* [{}]: {}", m.label, m.summary))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "You are a memory synthesis engine. Given a cluster of related memory nodes \
         from namespace \"{namespace}\", identify the single unifying insight or pattern \
         they share. Output 1-2 concise sentences suitable as a semantic anchor. \
         Preserve named entities and key relationships.\n\nMemory cluster:\n{corpus}\n\nInsight:"
    )
}

/// Greedy semantic clustering algorithm.
///
/// Groups `nodes` into [`SemanticCluster`]s using cosine similarity when both
/// nodes have embeddings, falling back to word-overlap heuristics when either
/// node lacks an embedding.
///
/// Constraints (inherited from consolidation constants):
/// - Only clusters with ≥ [`MIN_CLUSTER_SIZE`] members are emitted.
/// - Clusters are capped at [`MAX_CLUSTER_NODES`] members.
/// - At most [`MAX_CLUSTERS_PER_PASS`] clusters are returned.
/// - Two nodes are only clustered if they share the same `namespace`.
///
/// This is a pure in-memory computation: no SQL, no network, no allocator
/// beyond the standard heap.
pub fn cluster_members(nodes: &[ClusterMember]) -> Vec<SemanticCluster> {
    let mut clusters: Vec<SemanticCluster> = Vec::new();
    let mut assigned = vec![false; nodes.len()];

    for i in 0..nodes.len() {
        if assigned[i] {
            continue;
        }

        let pivot = &nodes[i];
        let mut members = vec![pivot.clone()];
        assigned[i] = true;

        for j in (i + 1)..nodes.len() {
            if assigned[j] {
                continue;
            }
            let candidate = &nodes[j];

            // Nodes must share a namespace to be clustered together.
            if candidate.namespace != pivot.namespace {
                continue;
            }

            let is_related = match (&pivot.embedding, &candidate.embedding) {
                (Some(p_emb), Some(c_emb)) => {
                    cosine_similarity(p_emb, c_emb) >= SIMILARITY_THRESHOLD
                }
                // Fallback: word-overlap heuristic when embeddings are absent.
                // Requires ≥ 2 shared words, or 1 long shared word.
                _ => {
                    let p_words: HashSet<String> = pivot
                        .label
                        .to_lowercase()
                        .split_whitespace()
                        .map(|s| s.to_string())
                        .collect();
                    let c_words: HashSet<String> = candidate
                        .label
                        .to_lowercase()
                        .split_whitespace()
                        .map(|s| s.to_string())
                        .collect();
                    let overlap = p_words.intersection(&c_words).count();
                    overlap >= 2
                        || (overlap >= 1
                            && pivot.label.len() > 4
                            && candidate.label.len() > 4)
                }
            };

            if is_related {
                members.push(candidate.clone());
                assigned[j] = true;
                if members.len() >= MAX_CLUSTER_NODES as usize {
                    break;
                }
            }
        }

        if members.len() >= MIN_CLUSTER_SIZE {
            clusters.push(SemanticCluster {
                namespace: pivot.namespace.clone(),
                members,
            });
        }

        if clusters.len() >= MAX_CLUSTERS_PER_PASS {
            break;
        }
    }

    clusters
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── synthesise_node_id ────────────────────────────────────────────────────

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
        assert!(Uuid::parse_str(&id).is_ok());
    }

    // ── extractive_cluster_summary ────────────────────────────────────────────

    fn make_member(label: &str, summary: &str, heat: f32) -> ClusterMember {
        ClusterMember {
            id: label.to_string(),
            label: label.to_string(),
            summary: summary.to_string(),
            heat,
            namespace: "default".to_string(),
            embedding: None,
        }
    }

    #[test]
    fn extractive_summary_takes_top_three_by_heat() {
        let members = vec![
            make_member("A", "First thing", 0.9),
            make_member("B", "Second thing", 0.8),
            make_member("C", "Third thing", 0.7),
            make_member("D", "Fourth thing", 0.6),
        ];
        let summary = extractive_cluster_summary(&members, 280);
        assert!(summary.contains("First thing"));
        assert!(summary.contains("Second thing"));
        assert!(summary.contains("Third thing"));
        assert!(!summary.contains("Fourth thing"));
    }

    #[test]
    fn extractive_summary_truncates_at_max_len() {
        let members = vec![
            make_member("A", "Hello world this is a long summary sentence", 1.0),
            make_member("B", "Another long summary sentence here for testing", 0.9),
        ];
        let summary = extractive_cluster_summary(&members, 20);
        assert!(summary.len() <= 20, "got len {}", summary.len());
        assert!(summary.ends_with("..."));
    }

    #[test]
    fn extractive_summary_empty_members_returns_empty() {
        let summary = extractive_cluster_summary(&[], 280);
        assert_eq!(summary, "");
    }

    // ── cluster_prompt ────────────────────────────────────────────────────────

    #[test]
    fn cluster_prompt_contains_namespace_and_labels() {
        let members = vec![
            make_member("NodeA", "Summary A", 0.8),
            make_member("NodeB", "Summary B", 0.7),
        ];
        let prompt = cluster_prompt(&members);
        assert!(prompt.contains("default"), "prompt should contain namespace");
        assert!(prompt.contains("NodeA"));
        assert!(prompt.contains("Summary A"));
        assert!(prompt.contains("NodeB"));
        assert!(prompt.contains("Summary B"));
        assert!(prompt.contains("Insight:"));
    }

    #[test]
    fn cluster_prompt_empty_members() {
        let prompt = cluster_prompt(&[]);
        assert!(prompt.contains("default"));
        assert!(prompt.contains("Insight:"));
    }

    // ── cluster_members ───────────────────────────────────────────────────────

    fn make_member_with_embedding(
        label: &str,
        namespace: &str,
        heat: f32,
        embedding: Vec<f32>,
    ) -> ClusterMember {
        ClusterMember {
            id: label.to_string(),
            label: label.to_string(),
            summary: format!("Summary of {label}"),
            heat,
            namespace: namespace.to_string(),
            embedding: Some(embedding),
        }
    }

    #[test]
    fn cluster_members_groups_similar_nodes() {
        // Two identical embeddings → cosine similarity = 1.0, above threshold.
        let emb = vec![1.0f32, 0.0, 0.0];
        let nodes = vec![
            make_member_with_embedding("A", "ns", 0.9, emb.clone()),
            make_member_with_embedding("B", "ns", 0.8, emb.clone()),
        ];
        let clusters = cluster_members(&nodes);
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].members.len(), 2);
    }

    #[test]
    fn cluster_members_does_not_group_different_namespaces() {
        let emb = vec![1.0f32, 0.0, 0.0];
        let nodes = vec![
            make_member_with_embedding("A", "ns1", 0.9, emb.clone()),
            make_member_with_embedding("B", "ns2", 0.8, emb.clone()),
        ];
        let clusters = cluster_members(&nodes);
        // Different namespaces → no cluster (each is a singleton, below MIN_CLUSTER_SIZE).
        assert_eq!(clusters.len(), 0);
    }

    #[test]
    fn cluster_members_does_not_group_orthogonal_embeddings() {
        let nodes = vec![
            make_member_with_embedding("A", "ns", 0.9, vec![1.0f32, 0.0, 0.0]),
            make_member_with_embedding("B", "ns", 0.8, vec![0.0f32, 1.0, 0.0]),
        ];
        let clusters = cluster_members(&nodes);
        // Cosine similarity = 0.0, below SIMILARITY_THRESHOLD (0.82).
        assert_eq!(clusters.len(), 0);
    }

    #[test]
    fn cluster_members_fallback_word_overlap() {
        // No embeddings → fall back to word-overlap heuristic.
        let nodes = vec![
            ClusterMember {
                id: "A".to_string(),
                label: "machine learning model".to_string(),
                summary: "about ML".to_string(),
                heat: 0.9,
                namespace: "ns".to_string(),
                embedding: None,
            },
            ClusterMember {
                id: "B".to_string(),
                label: "machine learning pipeline".to_string(),
                summary: "about pipelines".to_string(),
                heat: 0.8,
                namespace: "ns".to_string(),
                embedding: None,
            },
        ];
        let clusters = cluster_members(&nodes);
        // "machine" and "learning" overlap → should cluster.
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].members.len(), 2);
    }

    #[test]
    fn cluster_members_respects_max_clusters_per_pass() {
        // Build MAX_CLUSTERS_PER_PASS + 2 pairs of similar nodes in distinct namespaces.
        let emb = vec![1.0f32, 0.0, 0.0];
        let mut nodes = Vec::new();
        for i in 0..(MAX_CLUSTERS_PER_PASS + 2) {
            let ns = format!("ns{i}");
            nodes.push(make_member_with_embedding(&format!("A{i}"), &ns, 0.9, emb.clone()));
            nodes.push(make_member_with_embedding(&format!("B{i}"), &ns, 0.8, emb.clone()));
        }
        let clusters = cluster_members(&nodes);
        assert!(
            clusters.len() <= MAX_CLUSTERS_PER_PASS,
            "got {} clusters, expected ≤ {}",
            clusters.len(),
            MAX_CLUSTERS_PER_PASS
        );
    }
}
