use serde::{Deserialize, Serialize};

/// Lightweight pointer abstraction used across the codebase (legacy `Node` API).
/// This type is intentionally minimal and focused on the pointer/summary (the
/// "map"); large `raw_content` territory is carried separately on MemoryOp.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Node {
    pub id: uuid::Uuid,
    pub label: String,
    pub pointer_summary: String,
    pub base_utility: f32,
    pub current_heat: f32,
    pub is_pinned: bool,
    /// Memory taxonomy: 'episodic' | 'semantic' | 'preference' | 'procedural'
    /// Controls decay rate: episodic decays fastest, procedural decays slowest.
    #[serde(default = "Node::default_memory_type")]
    pub memory_type: String,
}

impl Node {
    pub fn default_memory_type() -> String {
        "episodic".to_string()
    }
}
