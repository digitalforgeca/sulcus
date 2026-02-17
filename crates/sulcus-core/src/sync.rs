use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::graph::Node;

/// Operation types used in the WAL / sync payloads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OpType {
    Add,
    Update,
    Delete,
}

/// A delta that can be pushed/pulled between clients and the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryOp {
    pub op: OpType,
    pub payload: Option<Node>,
    #[serde(default)]
    pub raw_content: Option<String>,
    pub timestamp: DateTime<Utc>,
}

/// Results returned by a push operation on a SyncEngine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPushResult {
    pub new_cursor: Option<String>,
    pub new_cursor_seq: Option<i64>,
}

/// Results returned by a pull operation on a SyncEngine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPullResult {
    pub ops: Vec<MemoryOp>,
    pub new_cursor: Option<String>,
    pub new_cursor_seq: Option<i64>,
}

/// Sync engine trait (implemented by server-side adapter).
#[async_trait]
pub trait SyncEngine: Send + Sync {
    /// Push local ops to the remote server and return any durable cursor info.
    async fn push(&self, ops: Vec<MemoryOp>) -> anyhow::Result<SyncPushResult>;

    /// Pull remote ops since a timestamp and return them along with cursor metadata.
    async fn pull(&self, since: Option<DateTime<Utc>>) -> anyhow::Result<SyncPullResult>;
}

/// Storage backend trait (implemented by local sqlite adapter or postgres adapter).
#[async_trait]
pub trait StorageBackend: Send + Sync {
    async fn get_node(&self, id: Uuid) -> anyhow::Result<Option<Node>>;
    async fn upsert_node(&self, node: Node) -> anyhow::Result<()>;
    async fn list_hot_nodes(&self, limit: usize) -> anyhow::Result<Vec<Node>>;
}

/// Deterministic fingerprint used for server/client WAL deduplication.
/// Uses `OpType` + JSON-serialized `payload` when present.
pub fn compute_op_hash(op: &MemoryOp) -> String {
    let payload_json = op
        .payload
        .as_ref()
        .map(|n| serde_json::to_string(n).unwrap_or_default())
        .unwrap_or_default();
    let input = format!("{:?}|{}", op.op, payload_json);
    let mut hasher = sha2::Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn memoryop_serde_roundtrip() {
        let node = crate::graph::Node {
            id: Uuid::from_u128(100),
            label: "payload".into(),
            pointer_summary: "payload".into(),
            base_utility: 0.0,
            current_heat: 0.42,
            is_pinned: false,
        };
        let op = MemoryOp {
            op: OpType::Add,
            payload: Some(node.clone()),
            raw_content: None,
            timestamp: Utc::now(),
        };

        let s = serde_json::to_string(&op).expect("serialize");
        assert!(s.contains("\"op\":\"Add\""));

        let parsed: MemoryOp = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(parsed.op, OpType::Add);
        assert!(parsed.payload.is_some());
        assert_eq!(
            parsed.payload.unwrap().pointer_summary,
            node.pointer_summary
        );
    }

    #[test]
    fn memoryop_roundtrip_with_and_without_raw_content() {
        let node = crate::graph::Node {
            id: Uuid::from_u128(1234),
            label: "n".into(),
            pointer_summary: "n".into(),
            base_utility: 0.0,
            current_heat: 0.0,
            is_pinned: false,
        };

        let with_raw = MemoryOp {
            op: OpType::Add,
            payload: Some(node.clone()),
            raw_content: Some("territory text".into()),
            timestamp: Utc::now(),
        };
        let s = serde_json::to_string(&with_raw).expect("serialize with");
        let parsed: MemoryOp = serde_json::from_str(&s).expect("deserialize with");
        assert_eq!(parsed.raw_content.as_deref(), Some("territory text"));

        let without_raw = MemoryOp {
            op: OpType::Delete,
            payload: None,
            raw_content: None,
            timestamp: Utc::now(),
        };
        let s2 = serde_json::to_string(&without_raw).expect("serialize without");
        let parsed2: MemoryOp = serde_json::from_str(&s2).expect("deserialize without");
        assert!(parsed2.raw_content.is_none());
    }

    #[test]
    fn compute_op_hash_is_deterministic_and_sensitive() {
        use crate::graph::Node;
        let node_a = Node {
            id: Uuid::from_u128(1),
            label: "a".into(),
            pointer_summary: "a".into(),
            base_utility: 0.0,
            current_heat: 1.0,
            is_pinned: false,
        };
        let node_b = Node {
            id: Uuid::from_u128(2),
            label: "b".into(),
            pointer_summary: "b".into(),
            base_utility: 0.0,
            current_heat: 1.0,
            is_pinned: false,
        };

        let op1 = MemoryOp {
            op: OpType::Add,
            payload: Some(node_a.clone()),
            raw_content: None,
            timestamp: Utc::now(),
        };
        let op2 = MemoryOp {
            op: OpType::Add,
            payload: Some(node_a.clone()),
            raw_content: None,
            timestamp: Utc::now(),
        };
        let op3 = MemoryOp {
            op: OpType::Add,
            payload: Some(node_b.clone()),
            raw_content: None,
            timestamp: Utc::now(),
        };
        let op4 = MemoryOp {
            op: OpType::Delete,
            payload: None,
            raw_content: None,
            timestamp: Utc::now(),
        };

        assert_eq!(compute_op_hash(&op1), compute_op_hash(&op2));
        assert_ne!(compute_op_hash(&op1), compute_op_hash(&op3));
        assert!(!compute_op_hash(&op4).is_empty());
    }
}
