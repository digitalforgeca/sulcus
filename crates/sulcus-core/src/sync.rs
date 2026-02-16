use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn memoryop_serde_roundtrip() {
        let node = crate::graph::Node {
            id: Uuid::from_u128(100),
            summary: "payload".into(),
            heat: 42.0,
        };
        let op = MemoryOp {
            op: OpType::Add,
            payload: Some(node.clone()),
            timestamp: Utc::now(),
        };

        let s = serde_json::to_string(&op).expect("serialize");
        assert!(s.contains("\"op\":\"Add\""));

        let parsed: MemoryOp = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(parsed.op, OpType::Add);
        assert!(parsed.payload.is_some());
        assert_eq!(parsed.payload.unwrap().summary, node.summary);
    }
}
