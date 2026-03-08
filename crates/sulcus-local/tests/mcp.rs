mod common;

use serde_json::json;
use serde_json::Value;
use sulcus_core::StorageBackend;
use sulcus_local::McpHandler;
use uuid::Uuid;

#[tokio::test]
async fn test_add_memory_via_mcp_and_active_index_resource() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    // call add_memory via tools/call
    let req = json!({ 
        "jsonrpc": "2.0", "id": "1", 
        "method": "tools/call", 
        "params": { "name": "record_memory", "arguments": { "content": "hello world" } } 
    });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
    let inner: Value = serde_json::from_str(content_text)?;
    let node_id_s = inner.get("node_id").and_then(|n| n.as_str()).expect(&format!("no text in response: {}", resp_s));
    let node_id = Uuid::parse_str(node_id_s)?;

    let fetched: Option<sulcus_core::graph::Node> = storage.get_node(node_id).await?;
    assert!(fetched.is_some());
    let fetched = fetched.expect(&format!("no text in response: {}", resp_s));
    assert_eq!(fetched.pointer_summary, "hello world");
    // Heat should be 1.0 (add_memory spikes heat then tick is NOT run by add_memory, but it is by commit_memory)
    // Actually add_memory in handlers.rs DOES NOT run tick.
    assert!((fetched.current_heat - 1.0).abs() < 1e-6);

    // WAL now active: add_memory records one pending op
    let ops = storage.list_memory_ops_internal().await?;
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
        .expect(&format!("no text in response: {}", resp_s));
    let text = contents[0].get("text").and_then(|t| t.as_str()).expect(&format!("no text in response: {}", resp_s));
    let arr: Value = serde_json::from_str(text)?;
    let list = arr.as_array().expect(&format!("no text in response: {}", resp_s));
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
    
    // summarize via tools/call
    let req = json!({ 
        "jsonrpc": "2.0", "id": "s1", 
        "method": "tools/call", 
        "params": { "name": "summarize", "arguments": { "text": text, "max_chars": 80 } } 
    });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
    let inner: Value = serde_json::from_str(content_text)?;
    let summary = inner.get("summary").and_then(|s| s.as_str()).expect(&format!("no text in response: {}", resp_s));
    
    assert!(!summary.is_empty());
    assert!(summary.len() <= 80);

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
    let tools = resp.get("result").and_then(|r| r.get("tools")).expect(&format!("no text in response: {}", resp_s));
    assert!(tools.as_array().is_some());

    Ok(())
}

#[tokio::test]
async fn test_upsert_and_get_node_via_mcp() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    let _id = uuid::Uuid::from_u128(0x1234);
    // upsert_node tool name is CommitMemory -> "commit_memory"
    let req = json!({ 
        "jsonrpc": "2.0", "id": "u1", 
        "method": "tools/call", 
        "params": { 
            "name": "commit_memory", 
            "arguments": { 
                "label": "node-x", 
                "pointer_summary": "node-x summary",
                "memory_type": "episodic"
            } 
        } 
    });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
    let inner: Value = serde_json::from_str(content_text)?;
    let node_id_s = inner.get("node_id").and_then(|n| n.as_str()).expect(&format!("no text in response: {}", resp_s));
    let _node_uuid = Uuid::parse_str(node_id_s)?;

    // get_node via tools/call
    let req = json!({ "jsonrpc": "2.0", "id": "g1", "method": "tools/call", "params": { "name": "get_node", "arguments": { "node_id": node_id_s } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
    let inner: Value = serde_json::from_str(content_text)?;
    let node = inner.get("node").expect(&format!("no text in response: {}", resp_s));
    assert_eq!(
        node.get("pointer_summary").and_then(|s| s.as_str()),
        Some("node-x summary")
    );
    // Heat should be > 0.5 because CommitMemory runs tick(0.85)
    let heat = node.get("current_heat").and_then(|h| h.as_f64()).expect(&format!("no text in response: {}", resp_s));
    assert!(heat > 0.5);

    Ok(())
}

// #[tokio::test]
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
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    storage.insert_payload(id, "the secret content").await?;

    let req = json!({ "jsonrpc": "2.0", "id": "f1", "method": "tools/call", "params": { "name": "get_node", "arguments": { "node_id": id.to_string() } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
    let inner: Value = serde_json::from_str(content_text)?;
    let got = inner.get("raw_content").and_then(|s| s.as_str()).expect(&format!("no text in response: {}", resp_s));
    assert_eq!(got, "the secret content");

    let n = storage.get_node(id).await?.expect(&format!("no text in response: {}", resp_s));
    assert!((n.base_utility - 0.35).abs() < 1e-6);
    assert!(
        n.current_heat > 0.5,
        "heat should still be elevated after fetch (got {})",
        n.current_heat
    );

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
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
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
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
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
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
    let inner: Value = serde_json::from_str(content_text)?;
    assert_eq!(inner.get("ok").and_then(|b| b.as_bool()), Some(true));

    // list_hot_nodes via tools/call
    let req = json!({ "jsonrpc": "2.0", "id": "l1", "method": "tools/call", "params": { "name": "list_hot_nodes", "arguments": { "limit": 10 } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
    let arr: Value = serde_json::from_str(content_text)?;
    let arr = arr.as_array().expect(&format!("no text in response: {}", resp_s));
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

    // record memory is AddMemory -> "add_memory"
    let req = json!({ "jsonrpc": "2.0", "id": "r1", "method": "tools/call", "params": { "name": "record_memory", "arguments": { "content": "new node from test" } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
    let inner: Value = serde_json::from_str(content_text)?;
    let node_id = inner.get("id").and_then(|n| n.as_str()).expect(&format!("no text in response: {}", resp_s));
    let nid = uuid::Uuid::parse_str(node_id)?;
    let fetched = storage.get_node(nid).await?;
    assert!(fetched.is_some());
    Ok(())
}

// #[tokio::test]
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
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
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
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
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
    // This tool is SynNow -> "sync_now"
    let res = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&res)?;
    // Should return an error because SULCUS_SERVER_URL is missing
    assert!(resp.get("error").is_some());

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
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
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
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .expect(&format!("no text in response: {}", resp_s));
    let m: Value = serde_json::from_str(content_text)?;
    assert!(m.get("active_index_size").is_some());
    assert!(m.get("num_nodes").is_some());
    assert!(m.get("memory_ops_count").is_some());
    Ok(())
}
