mod common;

use serde_json::json;
use serde_json::Value;
use sulcus::McpHandler;

#[tokio::test]
async fn record_and_query_memory_via_mcp_tooling() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let embedder: std::sync::Arc<dyn sulcus::embeddings::EmbeddingProvider> =
        std::sync::Arc::new(sulcus::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone(), 20);

    // create a fold and record a memory into it
    let req = json!({ "jsonrpc": "2.0", "id": "r1", "method": "tools/call", "params": { "name": "record_memory", "arguments": { "content": "important note", "fold_name": "team" } } });
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

    // search_memory is the correct tool name; fold scoping uses namespace param
    let req = json!({ "jsonrpc": "2.0", "id": "q1", "method": "tools/call", "params": { "name": "search_memory", "arguments": { "query": "important", "limit": 10 } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or_else(|| panic!("no text in search_memory response: {}", resp_s));
    let inner: Value = serde_json::from_str(content_text)?;
    let results = inner
        .get("results")
        .and_then(|r| r.as_array())
        .expect("no results array in response");
    // node_id must appear somewhere in the result set (FTS on pointer_summary)
    assert!(
        results
            .iter()
            .any(|r| r.get("id").and_then(|i| i.as_str()) == Some(node_id)),
        "stored node {} not found in search results: {:?}",
        node_id,
        results
    );

    Ok(())
}
