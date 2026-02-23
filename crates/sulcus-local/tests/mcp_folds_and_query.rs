use serde_json::json;
use serde_json::Value;
use sulcus_local::McpHandler;
use sulcus_local::SqliteStorage;

#[tokio::test]
async fn record_and_query_memory_via_mcp_tooling() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() { continue; }
        sqlx::query(s).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;
    let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> = std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder.clone());

    // create a fold and record a memory into it
    let req = json!({ "jsonrpc": "2.0", "id": "r1", "method": "tools/call", "params": { "name": "record_memory", "arguments": { "content": "important note", "fold_name": "team" } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp.get("result").and_then(|r| r.get("content")).and_then(|c| c[0].get("text")).and_then(|t| t.as_str()).unwrap();
    let inner: Value = serde_json::from_str(content_text)?;
    let node_id = inner.get("node_id").and_then(|n| n.as_str()).unwrap();

    // query scoped to the fold
    let req = json!({ "jsonrpc": "2.0", "id": "q1", "method": "tools/call", "params": { "name": "query_memory", "arguments": { "query": "important", "limit": 3, "fold_name": "team" } } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let content_text = resp.get("result").and_then(|r| r.get("content")).and_then(|c| c[0].get("text")).and_then(|t| t.as_str()).unwrap();
    let inner: Value = serde_json::from_str(content_text)?;
    let results = inner.get("results").and_then(|r| r.as_array()).unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0].get("id").and_then(|i| i.as_str()).unwrap(), node_id);

    Ok(())
}
