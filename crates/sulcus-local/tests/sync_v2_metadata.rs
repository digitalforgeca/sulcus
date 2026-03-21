// NOTE: Gated pending sync API stabilization (LocalSyncClient/HttpSyncEngine refactor)
#![cfg(feature = "integration-tests")]
mod common;

use chrono::Utc;
use sulcus_core::graph::Node;
use sulcus_core::sync::{MemoryOp, OpType, SyncEngine, SyncPullResult, SyncPushResult};
use sulcus_core::StorageBackend;
use sulcus_local::LocalSyncClient;
use uuid::Uuid;

struct V2MetadataEngine {
    pub node_id: Uuid,
}

#[async_trait::async_trait]
impl SyncEngine for V2MetadataEngine {
    async fn push(&self, _ops: Vec<MemoryOp>) -> anyhow::Result<SyncPushResult> {
        Ok(SyncPushResult {
            new_cursor: None,
            new_cursor_seq: None,
        })
    }

    async fn pull(
        &self,
        _since: Option<chrono::DateTime<chrono::Utc>>,
    ) -> anyhow::Result<SyncPullResult> {
        let node = Node {
            id: self.node_id,
            label: "v2-node".into(),
            pointer_summary: "v2-summary".into(),
            base_utility: 0.5,
            current_heat: 0.9,
            is_pinned: true,
            memory_type: "semantic".into(),
            modality: "image".into(),
            source_mime: Some("image/png".to_string()),
            namespace: "research".into(),
        };
        let op = MemoryOp {
            op: OpType::Add,
            payload: Some(node),
            patch: None,
            raw_content: Some("image content".to_string()),
            vector: Some(vec![0.1, 0.2, 0.3]),
            timestamp: Utc::now(),
        };
        Ok(SyncPullResult {
            ops: vec![op],
            new_cursor: Some("v2-cursor".to_string()),
            new_cursor_seq: Some(1),
        })
    }
}

#[tokio::test]
async fn test_sync_pull_preserves_v2_metadata() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let mut client = LocalSyncClient::new(storage.clone());

    let node_id = Uuid::now_v7();
    let engine = V2MetadataEngine { node_id };

    client.pull_from_engine_and_apply(&engine, None).await?;

    let fetched = storage
        .get_node(node_id)
        .await?
        .expect("node not found after sync");

    assert_eq!(fetched.modality, "image");
    assert_eq!(fetched.source_mime, Some("image/png".to_string()));
    assert_eq!(fetched.namespace, "research");
    assert_eq!(fetched.memory_type, "semantic");
    assert!(fetched.is_pinned);

    Ok(())
}
