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

#[tokio::test]
async fn test_upsert_and_get_node_via_mcp() -> anyhow::Result<()> {
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

    let id = uuid::Uuid::from_u128(0x1234);
    let req = json!({ "id": "u1", "method": "upsert_node", "params": { "id": id.to_string(), "summary": "node-x", "heat": 42.0 } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let node_id = resp.get("result").and_then(|r| r.get("node_id")).and_then(|n| n.as_str()).unwrap();
    assert_eq!(node_id, id.to_string());

    // get_node
    let req = json!({ "id": "g1", "method": "get_node", "params": { "node_id": id.to_string() } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let node = resp.get("result").and_then(|r| r.get("node")).unwrap();
    assert_eq!(node.get("summary").and_then(|s| s.as_str()), Some("node-x"));
    assert_eq!(node.get("heat").and_then(|h| h.as_f64()), Some(42.0));

    Ok(())
}

#[tokio::test]
async fn test_tick_and_list_hot_nodes_via_mcp() -> anyhow::Result<()> {
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
    // create nodes with different heats
    let a = uuid::Uuid::from_u128(1);
    let b = uuid::Uuid::from_u128(2);
    storage.upsert_node(sulcus_core::graph::Node { id: a, summary: "A".into(), heat: 100.0 }).await?;
    storage.upsert_node(sulcus_core::graph::Node { id: b, summary: "B".into(), heat: 5.0 }).await?;

    let handler = McpHandler::new(storage.clone());

    // force tick (use defaults)
    let req = json!({ "id": "t1", "method": "tick" });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    assert_eq!(resp.get("result").and_then(|r| r.get("ok")).and_then(|b| b.as_bool()), Some(true));

    // list_hot_nodes via MCP
    let req = json!({ "id": "l1", "method": "list_hot_nodes", "params": { "limit": 10 } });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let arr = resp.get("result").and_then(|r| r.as_array()).unwrap();
    assert!(!arr.is_empty());
    assert_eq!(arr[0].get("summary").and_then(|s| s.as_str()), Some("A"));

    Ok(())
}

#[tokio::test]
async fn test_record_and_list_memory_ops_via_mcp() -> anyhow::Result<()> {
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

    // record a raw memory op via MCP
    let payload = json!({ "foo": "bar" });
    let req = json!({ "id": "r1", "method": "record_memory_op", "params": { "op_type": "TEST", "payload": payload } });
    let _ = handler.handle_request(&req.to_string()).await?;

    // list_memory_ops
    let req = json!({ "id": "r2", "method": "list_memory_ops" });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let ops = resp.get("result").and_then(|r| r.as_array()).unwrap();
    assert!(!ops.is_empty());
    Ok(())
}

#[tokio::test]
async fn test_server_cursor_and_seq_via_mcp() -> anyhow::Result<()> {
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

    // set/get server_cursor
    let req = json!({ "id": "s1", "method": "set_server_cursor", "params": { "cursor": "c123" } });
    let _ = handler.handle_request(&req.to_string()).await?;
    let req = json!({ "id": "s2", "method": "get_server_cursor" });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    assert_eq!(resp.get("result").and_then(|r| r.get("cursor")).and_then(|c| c.as_str()), Some("c123"));

    // set/get last_seq
    let req = json!({ "id": "s3", "method": "set_last_seq", "params": { "seq": 123 } });
    let _ = handler.handle_request(&req.to_string()).await?;
    let req = json!({ "id": "s4", "method": "get_last_seq" });
    let resp_s = handler.handle_request(&req.to_string()).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    assert_eq!(resp.get("result").and_then(|r| r.get("seq")).and_then(|n| n.as_i64()), Some(123));

    Ok(())
}

#[tokio::test]
async fn test_sync_now_without_server_errors() -> anyhow::Result<()> {
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

    // ensure SULCUS_SERVER_URL not set
    std::env::remove_var("SULCUS_SERVER_URL");
    let req = json!({ "id": "x1", "method": "sync_now" });
    let res = handler.handle_request(&req.to_string()).await;
    assert!(res.is_err());

    Ok(())
}
