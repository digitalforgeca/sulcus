//! Fold types for memory export/import.

use serde::{Deserialize, Serialize};

/// Batch size: maximum nodes condensed per async-fold pass.
pub const FOLD_BATCH: i64 = 8;

/// Maximum character length for the dense fold summary stored in the warm cache.
pub const FOLD_SUMMARY_MAX: usize = 400;

/// Node payload exported in a Fold.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExportNode {
    pub id: String,
    pub label: String,
    pub pointer_summary: String,
    pub base_utility: f32,
    pub current_heat: f32,
    pub is_pinned: bool,
    /// Memory taxonomy: 'episodic' | 'semantic' | 'preference' | 'procedural'
    #[serde(default = "default_episodic")]
    pub memory_type: String,
    /// 'text' | 'image' | 'audio' | 'video' | 'mixed'
    pub modality: String,
    pub source_mime: Option<String>,
    pub namespace: String,
    /// optional raw content (territory)
    pub raw_content: Option<String>,
    /// vector stored as base64 to keep JSON deterministic
    pub vector_b64: Option<String>,
}

fn default_episodic() -> String {
    "episodic".to_string()
}

/// Edge exported in a Fold.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExportEdge {
    pub source_id: String,
    pub target_id: String,
    pub relationship_type: String,
    pub edge_weight: f32,
}

/// Fold payload serialized to disk for export/import.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FoldPayload {
    pub name: String,
    pub nodes: Vec<ExportNode>,
    pub edges: Vec<ExportEdge>,
}
