mod common;

use chrono::Utc;
use std::sync::Arc;
use tokio::sync::Mutex;

use sulcus_core::graph::Node;
use sulcus_core::sync::{MemoryOp, OpType, SyncEngine};
use sulcus_core::StorageBackend;
use sulcus_local::LocalSyncClient;

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
    let storage = common::make_storage().await?;

    // record two memory ops (payload uses pointer_summary/current_heat)
    let payload1 = serde_json::json!({ "id": uuid::Uuid::from_u128(1).to_string(), "pointer_summary": "one", "current_heat": 1.0 });
    storage.record_memory_op("ADD", &payload1).await?;
    let payload2 = serde_json::json!({ "id": uuid::Uuid::from_u128(2).to_string(), "pointer_summary": "two", "current_heat": 0.5 });
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
            label: "remote".into(),
            pointer_summary: "remote".into(),
            base_utility: 0.0,
            current_heat: 0.77,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: Node::default_modality(),
            source_mime: None,
            namespace: Node::default_namespace(),
        };
        let op = MemoryOp {
            op: OpType::Add,
            payload: Some(node),
            patch: None,
            raw_content: None,
            vector: None,
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
    let storage = common::make_storage().await?;
    let mut client = LocalSyncClient::new(storage.clone());

    let engine = PullEngine;
    client.pull_from_engine_and_apply(&engine, None).await?;

    let fetched: Option<sulcus_core::graph::Node> =
        storage.get_node(uuid::Uuid::from_u128(999)).await?;
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().pointer_summary, "remote");

    Ok(())
}

#[tokio::test]
async fn local_sync_client_transaction_rolls_back_on_payload_error() -> anyhow::Result<()> {
    // setup DB via common helper (runs migrations inside fresh PG schema)
    let storage = common::make_storage().await?;

    // Trigger behavior check: raise exception when raw_content = 'BOOM'
    sqlx::query("
        CREATE FUNCTION boom_trigger_fn() RETURNS trigger AS $$
        BEGIN
            IF NEW.raw_content = 'BOOM' THEN
                RAISE EXCEPTION 'boom';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    ")
    .execute(storage.pool())
    .await?;
    sqlx::query("
        CREATE TRIGGER fail_payload_insert
        BEFORE INSERT ON payloads
        FOR EACH ROW EXECUTE FUNCTION boom_trigger_fn()
    ")
    .execute(storage.pool())
    .await?;
    let mut client = LocalSyncClient::new(storage.clone());

    // Engine that returns a single op whose raw_content triggers the DB error
    struct BoomEngine;
    #[async_trait::async_trait]
    impl SyncEngine for BoomEngine {
        async fn push(&self, _ops: Vec<sulcus_core::sync::MemoryOp>) -> anyhow::Result<sulcus_core::sync::SyncPushResult> {
            Ok(sulcus_core::sync::SyncPushResult { new_cursor: None, new_cursor_seq: None })
        }
        async fn pull(&self, _since: Option<chrono::DateTime<chrono::Utc>>) -> anyhow::Result<sulcus_core::sync::SyncPullResult> {
            let id = uuid::Uuid::from_u128(0xDEADBEEF);
            let node = sulcus_core::graph::Node { 
                id, 
                label: "boom".into(), 
                pointer_summary: "boom".into(), 
                base_utility: 0.0, 
                current_heat: 0.0, 
                is_pinned: false, 
                memory_type: "episodic".into(),
                modality: sulcus_core::graph::Node::default_modality(),
                source_mime: None,
                namespace: sulcus_core::graph::Node::default_namespace(),
            };
            let op = sulcus_core::sync::MemoryOp { 
                op: sulcus_core::sync::OpType::Add, 
                payload: Some(node), 
                patch: None, 
                raw_content: Some("BOOM".to_string()), 
                vector: None,
                timestamp: chrono::Utc::now() 
            };
            Ok(sulcus_core::sync::SyncPullResult { ops: vec![op], new_cursor: None, new_cursor_seq: None })
        }
    }

    // Pull + apply should return an error due to payload trigger; node must NOT be present afterwards
    let res = client.pull_from_engine_and_apply(&BoomEngine, None).await;
    assert!(res.is_err());

    let fetched = storage.get_node(uuid::Uuid::from_u128(0xDEADBEEF)).await?;
    assert!(fetched.is_none(), "node must not be committed when payload insert fails");

    Ok(())
}

#[tokio::test]
async fn local_sync_client_persists_cursor_and_last_seq() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;

    // record one memory op
    let payload = serde_json::json!({ "id": uuid::Uuid::from_u128(10).to_string(), "pointer_summary": "persist-test", "current_heat": 1.0 });
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
    let storage = common::make_storage().await?;

    // record one memory op (legacy payload shape)
    let payload = serde_json::json!({ "id": uuid::Uuid::from_u128(11).to_string(), "pointer_summary": "retry-test", "current_heat": 1.0 });
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
    println!("TEST: before first push");
    let res = client.push_to_engine(&engine).await;
    println!("TEST: after first push -> {:?}", res);
    assert!(res.is_err());
    assert!(storage.get_last_seq().await?.is_none());

    // second push should succeed
    println!("TEST: before second push");
    client.push_to_engine(&engine).await?;
    println!("TEST: after second push");
    let guard = received.lock().await;
    assert_eq!(guard.len(), 1);
    drop(guard); // release lock so subsequent checks / pushes can proceed

    // persisted last_seq should be present
    assert!(storage.get_last_seq().await?.is_some());

    // simulate restart and ensure no duplicate push occurs
    println!("TEST: before client2.load_persisted_state");
    let mut client2 = LocalSyncClient::new(storage.clone());
    client2.load_persisted_state().await?;
    println!("TEST: after client2.load_persisted_state");
    println!("TEST: before client2.push_to_engine (should be no-op)");
    client2.push_to_engine(&engine).await?; // nothing to push
    println!("TEST: after client2.push_to_engine");
    let guard2 = received.lock().await;
    assert_eq!(guard2.len(), 1);

    Ok(())
}
