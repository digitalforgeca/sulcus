mod common;
use sulcus_local::sync::LocalSyncClient;
use sulcus_core::sync::{SyncEngine, MemoryOp, SyncPushResult, SyncPullResult};
use sulcus_core::StorageBackend;
use uuid::Uuid;
use std::sync::{Arc, Mutex};
use async_trait::async_trait;

struct MockEngine {
    pushed_ops: Arc<Mutex<Vec<MemoryOp>>>,
}

#[async_trait]
impl SyncEngine for MockEngine {
    async fn push(&self, ops: Vec<MemoryOp>) -> anyhow::Result<SyncPushResult> {
        let mut lock = self.pushed_ops.lock().unwrap();
        lock.extend(ops);
        Ok(SyncPushResult { new_cursor: None, new_cursor_seq: None })
    }
    async fn pull(&self, _since: Option<chrono::DateTime<chrono::Utc>>) -> anyhow::Result<SyncPullResult> {
        Ok(SyncPullResult { ops: vec![], new_cursor: None, new_cursor_seq: None })
    }
}

#[tokio::test]
async fn test_differential_sync_filters_by_heat() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let pushed_ops = Arc::new(Mutex::new(Vec::new()));
    let engine = MockEngine { pushed_ops: pushed_ops.clone() };
    let hot_id = Uuid::from_u128(1001);
    let cold_id = Uuid::from_u128(1002);
    storage.upsert_node(sulcus_core::graph::Node {
        id: hot_id, label: "Hot".into(), pointer_summary: "Hot".into(), base_utility: 0.0, current_heat: 1.0, is_pinned: false, memory_type: "episodic".into(), modality: "text".into(), source_mime: None, namespace: "default".into(),
    }).await?;
    storage.record_memory_op("ADD", &serde_json::json!({"id": hot_id.to_string(), "label": "Hot"})).await?;
    storage.upsert_node(sulcus_core::graph::Node {
        id: cold_id, label: "Cold".into(), pointer_summary: "Cold".into(), base_utility: 0.0, current_heat: 0.1, is_pinned: false, memory_type: "episodic".into(), modality: "text".into(), source_mime: None, namespace: "default".into(),
    }).await?;
    storage.record_memory_op("ADD", &serde_json::json!({"id": cold_id.to_string(), "label": "Cold"})).await?;
    let mut client = LocalSyncClient::new_with_threshold(storage.clone(), 0.5);
    client.push_to_engine(&engine).await?;
    {
        let pushed = pushed_ops.lock().unwrap();
        assert_eq!(pushed.len(), 1);
        assert_eq!(pushed[0].payload.as_ref().unwrap().id, hot_id);
    }
    let mut client2 = LocalSyncClient::new_with_threshold(storage, 0.0);
    client2.push_to_engine(&engine).await?;
    {
        let pushed = pushed_ops.lock().unwrap();
        assert!(pushed.iter().any(|op| op.payload.as_ref().map(|n| n.id == cold_id).unwrap_or(false)));
    }
    Ok(())
}
