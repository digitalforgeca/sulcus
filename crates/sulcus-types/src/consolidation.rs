//! Consolidation types and constants for the hot-cluster synthesis pass.

use serde::{Deserialize, Serialize};

/// Minimum number of hot nodes in a namespace cluster to trigger synthesis.
pub const MIN_CLUSTER_SIZE: usize = 2;

/// Maximum nodes to pull per namespace cluster per cycle (keeps prompts bounded).
pub const MAX_CLUSTER_NODES: i64 = 6;

/// Heat threshold for a node to be considered "hot" for consolidation purposes.
pub const HOT_THRESHOLD: f32 = 0.4;

/// Small heat bump applied to all cluster members after synthesis.
pub const CLUSTER_HEAT_BOOST: f32 = 0.05;

/// Additional decay multiplier applied to isolated hot nodes (heat ≥ HOT_THRESHOLD
/// but zero edges). Applied as `heat *= ISOLATION_PENALTY`.
pub const ISOLATION_PENALTY: f32 = 0.95;

/// Edge weight for the insight → cluster-member edge.
pub const INSIGHT_EDGE_WEIGHT: f32 = 0.7;

/// Initial heat assigned to a newly created synthesis node.
pub const SYNTHESIS_NODE_INITIAL_HEAT: f32 = 0.6;

/// Minimum cosine similarity to group two hot nodes into the same cluster.
pub const SIMILARITY_THRESHOLD: f32 = 0.82;

/// Maximum number of clusters to synthesise in a single pass.
pub const MAX_CLUSTERS_PER_PASS: usize = 5;

/// Minimum cooldown between consolidation passes to prevent redundant LLM usage.
pub const CONSOLIDATION_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(60);

/// A single member of a semantic cluster awaiting synthesis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterMember {
    pub id: String,
    pub label: String,
    pub summary: String,
    pub heat: f32,
    pub namespace: String,
    pub embedding: Option<Vec<f32>>,
}

/// A group of semantically related hot nodes in the same namespace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticCluster {
    pub namespace: String,
    pub members: Vec<ClusterMember>,
}
