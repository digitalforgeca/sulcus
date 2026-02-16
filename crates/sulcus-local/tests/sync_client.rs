use chrono::Utc;
use std::sync::Arc;
use tokio::sync::Mutex;

use sulcus_core::graph::Node;
use sulcus_core::sync::{MemoryOp, OpType, SyncEngine};
use sulcus_core::StorageBackend;
use sulcus_local::LocalSyncClient;
use sulcus_local::SqliteStorage;

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
async fn local_sync_client_pushes_pending_ops_to_engine() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        if stmt.trim().is_empty() {
            continue;
        }
        sqlx::query(stmt).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;

    // record two memory ops
    let payload1 = serde_json::json!({ "id": uuid::Uuid::from_u128(1).to_string(), "summary": "one", "heat": 100.0 });
    storage.record_memory_op("ADD", &payload1).await?;
    let payload2 = serde_json::json!({ "id": uuid::Uuid::from_u128(2).to_string(), "summary": "two", "heat": 50.0 });
    storage.record_memory_op("ADD", &payload2).await?;

    let mut client = LocalSyncClient::new(storage.clone());
    let received = Arc::new(Mutex::new(Vec::new()));
    let engine = MockEngine {
        received: received.clone(),
    };

    client.push_to_engine(&engine).await?;

    let guard = received.lock().await;
    assert_eq!(guard.len(), 2);
    assert_eq!(guard[0].op, OpType::Add);
    Ok(())
}

struct PullEngine;

#[async_trait::async_trait]
impl SyncEngine for PullEngine {
    async fn push(&self, _ops: Vec<MemoryOp>) -> anyhow::Result<sulcus_core::sync::SyncPushResult> {
        Ok(sulcus_core::sync::SyncPushResult {
            new_cursor: None,
            new_cursor_seq: None,
        })
    }
    async fn pull(
        &self,
        _since: Option<chrono::DateTime<chrono::Utc>>,
    ) -> anyhow::Result<sulcus_core::sync::SyncPullResult> {
        let node = Node {
            id: uuid::Uuid::from_u128(999),
            summary: "remote".into(),
            heat: 77.0,
        };
        let op = MemoryOp {
            op: OpType::Add,
            payload: Some(node),
            timestamp: Utc::now(),
        };
        Ok(sulcus_core::sync::SyncPullResult {
            ops: vec![op],
            new_cursor: None,
            new_cursor_seq: None,
        })
    }
}

#[tokio::test]
async fn local_sync_client_pulls_and_applies_remote_ops() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        if stmt.trim().is_empty() {
            continue;
        }
        sqlx::query(stmt).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;
    let mut client = LocalSyncClient::new(storage.clone());

    let engine = PullEngine;
    client.pull_from_engine_and_apply(&engine, None).await?;

    let fetched: Option<sulcus_core::graph::Node> =
        storage.get_node(uuid::Uuid::from_u128(999)).await?;
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().summary, "remote");

    Ok(())
}

#[tokio::test]
async fn local_sync_client_persists_cursor_and_last_seq() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        if stmt.trim().is_empty() {
            continue;
        }
        sqlx::query(stmt).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;

    // record one memory op
    let payload = serde_json::json!({ "id": uuid::Uuid::from_u128(10).to_string(), "summary": "persist-test", "heat": 1.0 });
    storage.record_memory_op("ADD", &payload).await?;

    // Engine that returns a cursor and seq
    struct CursorEngine;
    #[async_trait::async_trait]
    impl SyncEngine for CursorEngine {
        async fn push(
            &self,
            _ops: Vec<MemoryOp>,
        ) -> anyhow::Result<sulcus_core::sync::SyncPushResult> {
            Ok(sulcus_core::sync::SyncPushResult {
                new_cursor: Some("cursor-xyz".to_string()),
                new_cursor_seq: Some(123),
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

    let mut client = LocalSyncClient::new(storage.clone());
    client.push_to_engine(&CursorEngine).await?;

    // persisted values should be available in storage
    assert_eq!(
        storage.get_server_cursor().await?.as_deref(),
        Some("cursor-xyz")
    );
    assert_eq!(storage.get_server_cursor_seq().await?, Some(123));
    assert!(storage.get_last_seq().await?.is_some());

    // simulate restart: new client should be able to load persisted state
    let mut client2 = LocalSyncClient::new(storage.clone());
    client2.load_persisted_state().await?;
    assert_eq!(client2.server_cursor_seq(), Some(123));
    assert!(client2.last_seq().is_some());

    Ok(())
}

#[tokio::test]
async fn local_sync_client_retries_are_idempotent_and_resume_without_duplication(
) -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        if stmt.trim().is_empty() {
            continue;
        }
        sqlx::query(stmt).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;

    // record one memory op
    let payload = serde_json::json!({ "id": uuid::Uuid::from_u128(11).to_string(), "summary": "retry-test", "heat": 1.0 });
    storage.record_memory_op("ADD", &payload).await?;

    // Flaky engine: first call fails, second call succeeds and records ops
    struct FlakyEngine {
        calls: std::sync::Arc<tokio::sync::Mutex<i32>>,
        received: std::sync::Arc<tokio::sync::Mutex<Vec<MemoryOp>>>,
    }
    #[async_trait::async_trait]
    impl SyncEngine for FlakyEngine {
        async fn push(
            &self,
            ops: Vec<MemoryOp>,
        ) -> anyhow::Result<sulcus_core::sync::SyncPushResult> {
            let mut c = self.calls.lock().await;
            *c += 1;
            if *c == 1 {
                return Err(anyhow::anyhow!("transient"));
            }
            let mut r = self.received.lock().await;
            r.extend(ops);
            Ok(sulcus_core::sync::SyncPushResult {
                new_cursor: None,
                new_cursor_seq: Some(7),
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

    let calls = std::sync::Arc::new(tokio::sync::Mutex::new(0));
    let received = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let engine = FlakyEngine {
        calls: calls.clone(),
        received: received.clone(),
    };

    let mut client = LocalSyncClient::new(storage.clone());

    // first push should fail and not persist last_seq
    let res = client.push_to_engine(&engine).await;
    assert!(res.is_err());
    assert!(storage.get_last_seq().await?.is_none());

    // second push should succeed
    client.push_to_engine(&engine).await?;
    let guard = received.lock().await;
    assert_eq!(guard.len(), 1);

    // persisted last_seq should be present
    assert!(storage.get_last_seq().await?.is_some());

    // simulate restart and ensure no duplicate push occurs
    let mut client2 = LocalSyncClient::new(storage.clone());
    client2.load_persisted_state().await?;
    client2.push_to_engine(&engine).await?; // nothing to push
    let guard2 = received.lock().await;
    assert_eq!(guard2.len(), 1);

    Ok(())
}
