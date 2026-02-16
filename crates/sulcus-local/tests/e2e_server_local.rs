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

                        // otherwise treat as a pull request: return one remote op
                        let remote_node = Node {
                            id: uuid::Uuid::from_u128(9999),
                            summary: "remote-e2e".into(),
                            heat: 42.0,
                        };
                        let remote_op = json!([{ "op": "Add", "payload": remote_node, "timestamp": chrono::Utc::now().to_rfc3339() }]);
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
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        if stmt.trim().is_empty() {
            continue;
        }
        sqlx::query(stmt).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;

    // add a pending WAL op
    let payload = json!({ "id": uuid::Uuid::from_u128(1).to_string(), "summary": "local-item", "heat": 10.0 });
    storage.record_memory_op("ADD", &payload).await?;

    // wire HTTP engine -> LocalSyncClient and run push
    let engine = HttpSyncEngine::new(format!("http://{}", local_addr), None);
    let mut client = LocalSyncClient::new(storage.clone());

    client.push_to_engine(&engine).await?;

    // server should have received the pushed op
    let guard = received.lock().await;
    assert_eq!(guard.len(), 1);

    // now pull and apply a remote op (server returns a remote op in the handler above)
    client.pull_from_engine_and_apply(&engine, None).await?;

    let fetched: Option<sulcus_core::graph::Node> =
        storage.get_node(uuid::Uuid::from_u128(9999)).await?;
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().summary, "remote-e2e");

    Ok(())
}
