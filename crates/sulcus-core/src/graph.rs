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
    /// 'text' | 'image' | 'audio' | 'video' | 'mixed'
    #[serde(default = "Node::default_modality")]
    pub modality: String,
    /// Optional mime type for the raw content source.
    pub source_mime: Option<String>,
    /// Logical grouping of memories for P2P/Federated isolation.
    #[serde(default = "Node::default_namespace")]
    pub namespace: String,
}

impl Node {
    pub fn default_memory_type() -> String {
        "episodic".to_string()
    }

    pub fn default_modality() -> String {
        "text".to_string()
    }

    pub fn default_namespace() -> String {
        "default".to_string()
    }

    /// Validate the node structure. Returns Err if invariants are violated.
    pub fn validate(&self) -> Result<(), String> {
        if self.label.trim().is_empty() {
            return Err("Node label cannot be empty".into());
        }
        if self.current_heat < 0.0 || self.current_heat > 1.0 {
            return Err(format!("Node heat must be in [0, 1], got {}", self.current_heat));
        }
        if self.base_utility < 0.0 {
            return Err("Node base_utility cannot be negative".into());
        }
        
        match self.memory_type.as_str() {
            "episodic" | "semantic" | "preference" | "procedural" | "synthesis" => {},
            _ => return Err(format!("Invalid memory_type: {}", self.memory_type)),
        }

        match self.modality.as_str() {
            "text" | "image" | "audio" | "video" | "mixed" => {},
            _ => return Err(format!("Invalid modality: {}", self.modality)),
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn test_node_validation_valid() {
        let node = Node {
            id: Uuid::new_v4(),
            label: "Valid Node".into(),
            pointer_summary: "Summary".into(),
            base_utility: 0.5,
            current_heat: 0.8,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: "text".into(),
            source_mime: None,
            namespace: "default".into(),
        };
        assert!(node.validate().is_ok());
    }

    #[test]
    fn test_node_validation_invalid_heat() {
        let mut node = Node {
            id: Uuid::new_v4(),
            label: "Invalid Heat".into(),
            pointer_summary: "Summary".into(),
            base_utility: 0.5,
            current_heat: 1.5,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: "text".into(),
            source_mime: None,
            namespace: "default".into(),
        };
        assert!(node.validate().is_err());
        node.current_heat = -0.1;
        assert!(node.validate().is_err());
    }

    #[test]
    fn test_node_validation_empty_label() {
        let node = Node {
            id: Uuid::new_v4(),
            label: "  ".into(),
            pointer_summary: "Summary".into(),
            base_utility: 0.5,
            current_heat: 0.5,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: "text".into(),
            source_mime: None,
            namespace: "default".into(),
        };
        assert!(node.validate().is_err());
    }

    #[test]
    fn test_node_validation_invalid_memory_type() {
        let node = Node {
            id: Uuid::new_v4(),
            label: "Invalid Type".into(),
            pointer_summary: "Summary".into(),
            base_utility: 0.5,
            current_heat: 0.5,
            is_pinned: false,
            memory_type: "garbage".into(),
            modality: "text".into(),
            source_mime: None,
            namespace: "default".into(),
        };
        assert!(node.validate().is_err());
    }
}
