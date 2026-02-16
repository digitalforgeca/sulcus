use serde_json::json;
use serde_json::Value;
use sulcus_core::StorageBackend;
use sulcus_local::McpHandler;
use sulcus_local::SqliteStorage;

#[tokio::test]
async fn test_add_memory_via_mcp_and_active_index_resource() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() {
            continue;
        }
        sqlx::query(s).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;
    let handler = McpHandler::new(storage.clone());

    // call add_memory programmatically
    let node_id = handler.add_memory("hello world", None).await?;
    let fetched: Option<sulcus_core::graph::Node> = storage.get_node(node_id).await?;
    assert!(fetched.is_some());
    let fetched = fetched.unwrap();
    assert_eq!(fetched.summary, "hello world");
    assert!((fetched.heat - 100.0).abs() < f32::EPSILON);

    // memory_ops recorded
    let ops = storage.list_memory_ops().await?;
    assert!(!ops.is_empty());
    assert_eq!(ops[0].1, "ADD");

    // resource request via JSON
    let req = json!({ "id": "1", "method": "resource", "params": { "resource": "memory://active_index", "limit": 10 } });
    let req_s = req.to_string();
    let resp_s = handler.handle_request(&req_s).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let list = resp.get("result").and_then(|r| r.as_array()).unwrap();
    assert!(!list.is_empty());

    Ok(())
}

#[tokio::test]
async fn test_mcp_summarize_via_method_and_request() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() {
            continue;
        }
        sqlx::query(s).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;
    let handler = McpHandler::new(storage.clone());

    let text = "This is the first sentence. This is the second sentence. Extra details follow.";
    let summary = handler.summarize(text, 80).await?;
    assert!(!summary.is_empty());
    assert!(summary.len() <= 80);

    // via JSON request
    let req =
        json!({ "id": "s1", "method": "summarize", "params": { "text": text, "max_chars": 80 } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let got = resp
        .get("result")
        .and_then(|r| r.get("summary"))
        .and_then(|s| s.as_str())
        .unwrap_or("");
    assert!(!got.is_empty());

    Ok(())
}

#[tokio::test]
async fn test_describe_tools_mcp_method() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() {
            continue;
        }
        sqlx::query(s).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;
    let handler = McpHandler::new(storage.clone());

    let req = json!({ "id": "t1", "method": "describe_tools" });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let manifest = resp.get("result").unwrap();
    assert!(manifest.get("tools").and_then(|t| t.as_array()).is_some());

    Ok(())
}
