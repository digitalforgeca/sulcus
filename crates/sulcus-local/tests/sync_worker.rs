use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::Duration;

use sulcus_local::SqliteStorage;
use sulcus_local::LocalSyncClient;
use sulcus_local::LocalSyncClient as LSC;
use sulcus_core::sync::{SyncEngine, MemoryOp, OpType};

struct MockEngine { pub received: Arc<Mutex<Vec<MemoryOp>>> }

#[async_trait::async_trait]
impl SyncEngine for MockEngine {
    async fn push(&self, ops: Vec<MemoryOp>) -> anyhow::Result<sulcus_core::sync::SyncPushResult> {
        let mut guard = self.received.lock().await;
        guard.extend(ops);
        Ok(sulcus_core::sync::SyncPushResult { new_cursor: None, new_cursor_seq: None })
    }

    async fn pull(&self, _since: Option<chrono::DateTime<chrono::Utc>>) -> anyhow::Result<sulcus_core::sync::SyncPullResult> {
        Ok(sulcus_core::sync::SyncPullResult { ops: Vec::new(), new_cursor: None, new_cursor_seq: None })
    }
}

#[tokio::test]
async fn spawn_sync_worker_pushes_wal_ops_periodically() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') { if stmt.trim().is_empty() { continue; } sqlx::query(stmt).execute(&pool).await?; }

    let storage = SqliteStorage::new(&db_url).await?;

    // record a memory_op
    let payload = serde_json::json!({ "id": uuid::Uuid::from_u128(42).to_string(), "summary": "syncme", "heat": 100.0 });
    storage.record_memory_op("ADD", &payload).await?;

    let received = Arc::new(Mutex::new(Vec::new()));
    let engine = MockEngine { received: received.clone() };
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
