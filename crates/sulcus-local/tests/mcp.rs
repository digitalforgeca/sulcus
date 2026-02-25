mod common;

use serde_json::json;
use serde_json::Value;
use sqlx::Row;
use sulcus_core::StorageBackend;
use sulcus_local::McpHandler;

#[tokio::test]
async fn test_add_memory_via_mcp_and_active_index_resource() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    // call add_memory programmatically
    let node_id = handler.add_memory("hello world", None).await?;
    let fetched: Option<sulcus_core::graph::Node> = storage.get_node(node_id).await?;
    assert!(fetched.is_some());
    let fetched = fetched.unwrap();
    assert_eq!(fetched.pointer_summary, "hello world");
    assert!((fetched.current_heat - 1.0).abs() < f32::EPSILON);

    // WAL now active: add_memory records one pending op
    let ops = storage.list_memory_ops().await?;
    assert_eq!(
        ops.len(),
        1,
        "add_memory should record one pending memory op"
    );

    // resource request via JSON-RPC 2.0 -> `resources/read` returns contents[0].text (minified JSON string)
    let req = json!({ "jsonrpc": "2.0", "id": "1", "method": "resources/read", "params": { "uri": "memory://active_index", "limit": 10 } });
    let req_s = req.to_string();
    let resp_s = handler.handle_request(&req_s).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let contents = resp
        .get("result")
        .and_then(|r| r.get("contents"))
        .and_then(|c| c.as_array())
        .unwrap();
    let text = contents[0].get("text").and_then(|t| t.as_str()).unwrap();
    let arr: Value = serde_json::from_str(text)?;
    let list = arr.as_array().unwrap();
    assert!(!list.is_empty());
    // ensure the objects expose id/label/pointer_summary only (no raw_content)
    let first = &list[0];
    assert!(first.get("id").is_some());
    assert!(first.get("label").is_some());
    assert!(first.get("pointer_summary").is_some());
    assert!(first.get("raw_content").is_none());

    Ok(())
}

#[tokio::test]
async fn test_mcp_summarize_via_method_and_request() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    let text = "This is the first sentence. This is the second sentence. Extra details follow.";
    let summary = handler.summarize(text, 80).await?;
    assert!(!summary.is_empty());
    assert!(summary.len() <= 80);

    // `summarize` is now a programmatic helper (no longer exposed as a tools/call entry)

    Ok(())
}

#[tokio::test]
async fn test_describe_tools_mcp_method() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    let req = json!({ "jsonrpc": "2.0", "id": "t1", "method": "tools/list" });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let tools = resp.get("result").and_then(|r| r.get("tools")).unwrap();
    assert!(tools.as_array().is_some());

    Ok(())
}

#[tokio::test]
async fn test_upsert_and_get_node_via_mcp() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    let id = uuid::Uuid::from_u128(0x1234);
    let req = json!({ "jsonrpc": "2.0", "id": "u1", "method": "tools/call", "params": { "name": "upsert_node", "arguments": { "id": id.to_string(), "label": "node-x", "pointer_summary": "node-x summary", "current_heat": 0.42, "base_utility": 0.0, "is_pinned": false } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap();
    let inner: Value = serde_json::from_str(content_text)?;
    let node_id = inner.get("node_id").and_then(|n| n.as_str()).unwrap();
    assert_eq!(node_id, id.to_string());

    // get_node via tools/call
    let req = json!({ "jsonrpc": "2.0", "id": "g1", "method": "tools/call", "params": { "name": "get_node", "arguments": { "node_id": id.to_string() } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap();
    let inner: Value = serde_json::from_str(content_text)?;
    let node = inner.get("node").unwrap();
    assert_eq!(
        node.get("pointer_summary").and_then(|s| s.as_str()),
        Some("node-x summary")
    );
    let heat = node.get("current_heat").and_then(|h| h.as_f64()).unwrap();
    assert!((heat - 0.42).abs() < 1e-6);

    Ok(())
}

#[tokio::test]
async fn test_fetch_payload_reinforces_learning() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    let id = uuid::Uuid::from_u128(0x9999);
    storage
        .upsert_node(sulcus_core::graph::Node {
            id,
            label: "fetch-me".into(),
            pointer_summary: "fetch summary".into(),
            base_utility: 0.2,
            current_heat: 0.0,
            is_pinned: false,
            memory_type: "episodic".into(),
        })
        .await?;
    storage.insert_payload(id, "the secret content").await?;

    let req = json!({ "jsonrpc": "2.0", "id": "f1", "method": "tools/call", "params": { "name": "fetch_payload", "arguments": { "node_id": id.to_string() } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap();
    let inner: Value = serde_json::from_str(content_text)?;
    let got = inner.get("raw_content").and_then(|s| s.as_str()).unwrap();
    assert_eq!(got, "the secret content");

    // node should be reinforced: base_utility += 0.15 (cap at 1.0), heat set to 1.0 then
    // immediately decayed by tick (decay=0.85) → current_heat ≈ 0.85
    let n = storage.get_node(id).await?.unwrap();
    assert!((n.base_utility - 0.35).abs() < 1e-6);
    assert!(
        n.current_heat > 0.5,
        "heat should still be elevated after fetch+tick (got {})",
        n.current_heat
    );

    Ok(())
}

#[tokio::test]
async fn test_commit_memory_writes_node_payload_and_edges_transactionally() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    // create a node to connect to
    let other = uuid::Uuid::from_u128(0xfeed);
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: other,
            label: "other".into(),
            pointer_summary: "other".into(),
            base_utility: 0.0,
            current_heat: 0.1,
            is_pinned: false,
            memory_type: "episodic".into(),
        })
        .await?;

    let req = json!({ "jsonrpc": "2.0", "id": "c1", "method": "tools/call", "params": { "name": "commit_memory", "arguments": { "label": "new", "pointer_summary": "new summary", "raw_content": "payload here", "connected_node_ids": [ other.to_string() ] } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap();
    let inner: Value = serde_json::from_str(content_text)?;
    let new_id = inner.get("node_id").and_then(|n| n.as_str()).unwrap();
    let new_uuid = uuid::Uuid::parse_str(new_id)?;

    // node exists; heat starts at 1.0 but commit_memory runs tick (decay=0.85) afterward
    let n = storage.get_node(new_uuid).await?.unwrap();
    assert!(
        n.current_heat > 0.5,
        "heat={} should be > 0.5 after tick",
        n.current_heat
    );

    // payload present
    let p = storage.get_payload(new_uuid).await?;
    assert_eq!(p.unwrap(), "payload here");

    // edge exists
    let row = sqlx::query(
        "SELECT relationship_type, edge_weight FROM edges WHERE source_id = $1 AND target_id = $2",
    )
    .bind(new_id)
    .bind(other.to_string())
    .fetch_one(storage.pool())
    .await?;
    let rel: String = row.try_get("relationship_type")?;
    let w: f32 = row.try_get("edge_weight")?;
    assert_eq!(rel, "semantic");
    assert!((w - 0.5).abs() < 1e-6);

    Ok(())
}

#[tokio::test]
async fn test_tick_and_list_hot_nodes_via_mcp() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    // create nodes with different heats
    let a = uuid::Uuid::from_u128(1);
    let b = uuid::Uuid::from_u128(2);
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: a,
            label: "A".into(),
            pointer_summary: "A".into(),
            base_utility: 0.0,
            current_heat: 1.0,
            is_pinned: false,
            memory_type: "episodic".into(),
        })
        .await?;
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: b,
            label: "B".into(),
            pointer_summary: "B".into(),
            base_utility: 0.0,
            current_heat: 0.05,
            is_pinned: false,
            memory_type: "episodic".into(),
        })
        .await?;

    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    // force tick (use defaults) via tools/call
    let req = json!({ "jsonrpc": "2.0", "id": "t1", "method": "tools/call", "params": { "name": "tick", "arguments": {} } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap();
    let inner: Value = serde_json::from_str(content_text)?;
    assert_eq!(inner.get("ok").and_then(|b| b.as_bool()), Some(true));

    // list_hot_nodes via tools/call
    let req = json!({ "jsonrpc": "2.0", "id": "l1", "method": "tools/call", "params": { "name": "list_hot_nodes", "arguments": { "limit": 10 } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap();
    let arr: Value = serde_json::from_str(content_text)?;
    let arr = arr.as_array().unwrap();
    assert!(!arr.is_empty());
    assert_eq!(
        arr[0].get("pointer_summary").and_then(|s| s.as_str()),
        Some("A")
    );

    Ok(())
}

#[tokio::test]
async fn test_record_and_list_memory_ops_via_mcp() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    // record memory using the new `record_memory` tool and verify node appears in active_index
    let req = json!({ "jsonrpc": "2.0", "id": "r1", "method": "tools/call", "params": { "name": "record_memory", "arguments": { "content": "new node from test", "fold_name": "test-fold" } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap();
    let inner: Value = serde_json::from_str(content_text)?;
    let node_id = inner.get("node_id").and_then(|n| n.as_str()).unwrap();
    let nid = uuid::Uuid::parse_str(node_id)?;
    let fetched = storage.get_node(nid).await?;
    assert!(fetched.is_some());
    Ok(())
}

#[tokio::test]
async fn test_server_cursor_and_seq_via_mcp() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    // set/get server_cursor via tools/call (round-trips through client_meta table)
    let req = json!({ "jsonrpc": "2.0", "id": "s1", "method": "tools/call", "params": { "name": "set_server_cursor", "arguments": { "cursor": "c123" } } });
    let _ = handler.handle_request(&req.to_string()).await?;
    let req = json!({ "jsonrpc": "2.0", "id": "s2", "method": "tools/call", "params": { "name": "get_server_cursor", "arguments": {} } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap();
    let inner: Value = serde_json::from_str(content_text)?;
    assert_eq!(
        inner.get("cursor"),
        Some(&serde_json::Value::String("c123".to_string()))
    );

    // set/get last_seq via tools/call
    let req = json!({ "jsonrpc": "2.0", "id": "s3", "method": "tools/call", "params": { "name": "set_last_seq", "arguments": { "seq": 123 } } });
    let _ = handler.handle_request(&req.to_string()).await?;
    let req = json!({ "jsonrpc": "2.0", "id": "s4", "method": "tools/call", "params": { "name": "get_last_seq", "arguments": {} } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap();
    let inner: Value = serde_json::from_str(content_text)?;
    assert_eq!(
        inner.get("seq"),
        Some(&serde_json::Value::Number(serde_json::Number::from(123i64)))
    );

    Ok(())
}

#[tokio::test]
async fn test_sync_now_without_server_errors() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    // ensure SULCUS_SERVER_URL not set
    std::env::remove_var("SULCUS_SERVER_URL");
    let req = json!({ "jsonrpc": "2.0", "id": "x1", "method": "tools/call", "params": { "name": "sync_now", "arguments": {} } });
    let res = handler.handle_request(&req.to_string()).await;
    assert!(res.is_err());

    Ok(())
}

#[tokio::test]
async fn test_mcp_metrics_method() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    // create some nodes and ops
    let id = uuid::Uuid::from_u128(1);
    storage
        .upsert_node(sulcus_core::graph::Node {
            id,
            label: "m1".into(),
            pointer_summary: "m1".into(),
            base_utility: 0.0,
            current_heat: 0.1,
            is_pinned: false,
            memory_type: "episodic".into(),
        })
        .await?;
    let payload =
        serde_json::json!({ "id": id.to_string(), "pointer_summary": "m1", "current_heat": 0.1 });
    storage.record_memory_op("ADD", &payload).await?;

    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());
    let req = serde_json::json!({ "jsonrpc": "2.0", "id": "met1", "method": "tools/call", "params": { "name": "metrics", "arguments": {} } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: serde_json::Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap();
    let m: Value = serde_json::from_str(content_text)?;
    assert!(m.get("active_index_size").is_some());
    assert!(m.get("num_nodes").is_some());
    assert!(m.get("memory_ops_count").is_some());
    Ok(())
}
