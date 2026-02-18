use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Method, Request, Response, Server, StatusCode};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;

use sulcus_core::{graph::Node, StorageBackend};
use sulcus_local::{HttpSyncEngine, LocalSyncClient, SqliteStorage};

#[tokio::test]
async fn e2e_local_to_http_server_sync() -> anyhow::Result<()> {
    // shared recorder for server-received payloads
    let received: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
    let rcv = received.clone();

    let make_svc = make_service_fn(move |_conn| {
        let rcv = rcv.clone();
        async move {
            Ok::<_, hyper::Error>(service_fn(move |req: Request<Body>| {
                let rcv = rcv.clone();
                async move {
                    if req.method() == Method::POST && req.uri().path() == "/api/v1/agent/sync" {
                        let bytes = hyper::body::to_bytes(req.into_body()).await?;
                        let v: serde_json::Value =
                            serde_json::from_slice(&bytes).unwrap_or(json!({}));

                        // distinguish push vs pull by presence of `ops` array content
                        let ops = v
                            .get("ops")
                            .and_then(|o| o.as_array())
                            .cloned()
                            .unwrap_or_default();
                        if !ops.is_empty() {
                            // record pushed ops and respond with empty new_ops
                            rcv.lock().await.extend(ops);
                            let resp = json!({ "new_ops": [], "new_cursor": chrono::Utc::now().to_rfc3339() });
                            return Ok::<_, hyper::Error>(
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header("content-type", "application/json")
                                    .body(Body::from(resp.to_string()))
                                    .unwrap(),
                            );
                        }

                        // otherwise treat as a pull request: return one remote op (include `raw_content` territory)
                        let remote_node = Node {
                            id: uuid::Uuid::from_u128(9999),
                            label: "remote-e2e".into(),
                            pointer_summary: "remote-e2e".into(),
                            base_utility: 0.0,
                            current_heat: 0.42,
                            is_pinned: false,
                        };
                        let remote_payload = json!({
                            "id": remote_node.id.to_string(),
                            "label": remote_node.label,
                            "pointer_summary": remote_node.pointer_summary,
                            "base_utility": remote_node.base_utility,
                            "current_heat": remote_node.current_heat,
                            "is_pinned": remote_node.is_pinned
                        });
                        // include raw_content at the MemoryOp (DTO) level so serde -> MemoryOp.raw_content is populated
                        let remote_op = json!([{
                            "op": "Add",
                            "payload": remote_payload,
                            "raw_content": "remote-e2e territory content",
                            "timestamp": chrono::Utc::now().to_rfc3339()
                        }]);
                        let resp = json!({ "new_ops": remote_op, "new_cursor": chrono::Utc::now().to_rfc3339() });
                        return Ok::<_, hyper::Error>(
                            Response::builder()
                                .status(StatusCode::OK)
                                .header("content-type", "application/json")
                                .body(Body::from(resp.to_string()))
                                .unwrap(),
                        );
                    }

                    Ok::<_, hyper::Error>(
                        Response::builder()
                            .status(StatusCode::NOT_FOUND)
                            .body(Body::empty())
                            .unwrap(),
                    )
                }
            }))
        }
    });

    let server = Server::bind(&SocketAddr::from(([127, 0, 0, 1], 0))).serve(make_svc);
    let local_addr = server.local_addr();
    let _jh = tokio::spawn(server);

    // prepare a temporary sqlite DB and storage
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);
    let pool = sqlx::SqlitePool::connect(&db_url).await?;

    // ensure clean DB state (drop possibly stale tables from prior runs)
    let _ = sqlx::query("DROP TABLE IF EXISTS payloads")
        .execute(&pool)
        .await;
    let _ = sqlx::query("DROP TABLE IF EXISTS nodes")
        .execute(&pool)
        .await;
    let _ = sqlx::query("DROP TABLE IF EXISTS edges")
        .execute(&pool)
        .await;
    let _ = sqlx::query("DROP TABLE IF EXISTS embeddings")
        .execute(&pool)
        .await;
    let _ = sqlx::query("DROP TABLE IF EXISTS active_index")
        .execute(&pool)
        .await;

    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() {
            continue;
        }
        println!(
            "MIGRATION STMT: {}",
            s.chars().take(120).collect::<String>()
        );
        sqlx::query(s).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;

    // add a pending WAL op (use pointer_summary/current_heat form)
    let payload = json!({ "id": uuid::Uuid::from_u128(1).to_string(), "pointer_summary": "local-item", "current_heat": 0.10 });
    storage.record_memory_op("ADD", &payload).await?;

    // wire HTTP engine -> LocalSyncClient and run push
    let engine = HttpSyncEngine::new(format!("http://{}", local_addr), None);
    let mut client = LocalSyncClient::new(storage.clone());

    client.push_to_engine(&engine).await?;

    // server should have received the pushed op
    let guard = received.lock().await;
    assert_eq!(guard.len(), 1);

    // now pull and apply a remote op (server returns a remote op in the handler above)
    println!("TEST: about to call pull_from_engine_and_apply");
    let pull_res = client.pull_from_engine_and_apply(&engine, None).await;
    println!("TEST: pull_from_engine_and_apply -> {:?}", pull_res);
    pull_res?;
    println!("TEST: pull_from_engine_and_apply returned");

    let fetched: Option<sulcus_core::graph::Node> =
        storage.get_node(uuid::Uuid::from_u128(9999)).await?;
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().pointer_summary, "remote-e2e");

    Ok(())
}
