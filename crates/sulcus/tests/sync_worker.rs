// NOTE: Gated pending sync API stabilization (LocalSyncClient/HttpSyncEngine refactor)
#![cfg(feature = "integration-tests")]
mod common;

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use sulcus_core::sync::{MemoryOp, OpType, SyncEngine};
use sulcus_core::StorageBackend;
use sulcus::LocalSyncClient as LSC;

struct MockEngine {
    pub received: Arc<Mutex<Vec<MemoryOp>>>,
}

#[async_trait::async_trait]
impl SyncEngine for MockEngine {
    async fn push(&self, ops: Vec<MemoryOp>) -> anyhow::Result<sulcus_core::sync::SyncPushResult> {
        let mut guard = self.received.lock().await;
        guard.extend(ops);
        Ok(sulcus_core::sync::SyncPushResult {
            new_cursor: None,
            new_cursor_seq: None,
        })
    }

    async fn pull(
        &self,
        _since: Option<chrono::DateTime<chrono::Utc>>,
    ) -> anyhow::Result<sulcus_core::sync::SyncPullResult> {
        Ok(sulcus_core::sync::SyncPullResult {
            ops: Vec::new(),
            new_cursor: None,
            new_cursor_seq: None,
        })
    }
}

#[tokio::test]
async fn spawn_sync_worker_pushes_wal_ops_periodically() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;

    // record a memory_op (pointer-only payload uses pointer_summary/current_heat)
    let payload = serde_json::json!({ "id": uuid::Uuid::from_u128(42).to_string(), "pointer_summary": "syncme", "current_heat": 1.0 });
    storage.record_memory_op("ADD", &payload).await?;

    let received = Arc::new(Mutex::new(Vec::new()));
    let engine = MockEngine {
        received: received.clone(),
    };
    let engine_arc: Arc<dyn SyncEngine + Send + Sync> = Arc::new(engine);

    let handle = LSC::spawn_sync_worker(engine_arc, storage.clone(), Duration::from_millis(50));

    // wait for a couple intervals
    tokio::time::sleep(Duration::from_millis(160)).await;

    let guard = received.lock().await;
    assert!(!guard.is_empty());
    assert_eq!(guard[0].op, OpType::Add);

    handle.abort();
    Ok(())
}
