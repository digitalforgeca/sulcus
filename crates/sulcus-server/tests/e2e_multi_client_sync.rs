use serde_json::json;
use std::process::Stdio;
use std::sync::Arc;
use tempfile::NamedTempFile;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use sha2::Digest;
use sulcus_server::{make_app_with_state, AppState, SharedState};

async fn send_and_recv(
    stdin: &mut tokio::process::ChildStdin,
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    req: &serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let s = req.to_string() + "\n";
    stdin.write_all(s.as_bytes()).await?;
    stdin.flush().await?;

    // Keep reading lines until valid JSON arrives or the deadline expires.
    // Non-JSON lines (tracing output, startup messages) are silently skipped.
    let deadline = std::time::Duration::from_secs(10);
    let start = tokio::time::Instant::now();
    loop {
        let elapsed = start.elapsed();
        if elapsed >= deadline {
            return Err(anyhow::anyhow!("timeout waiting for JSON response"));
        }
        let remaining = deadline - elapsed;
        let line = tokio::time::timeout(remaining, lines.next_line()).await??;
        let line = line.ok_or_else(|| anyhow::anyhow!("child closed stdout"))?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(v) => return Ok(v),
            Err(_) => {
                // Not JSON — could be a log line or startup banner; skip and retry.
                eprintln!("[send_and_recv] skipping non-JSON line: {:?}", &line[..line.len().min(120)]);
                continue;
            }
        }
    }
}

fn find_sulcus_local_bin() -> Option<String> {
    // prefer Cargo-provided env var
    if let Ok(p) = std::env::var("CARGO_BIN_EXE_sulcus-local") {
        return Some(p);
    }

    // fallback: search upward for target/debug/sulcus-local
    let mut dir = std::env::current_dir().ok()?;
    loop {
        let cand = dir.join("target").join("debug").join("sulcus-local");
        if cand.exists() {
            return Some(cand.to_string_lossy().to_string());
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

#[tokio::test]
async fn e2e_server_with_multiple_sulcus_local_instances() -> anyhow::Result<()> {
    // find binary
    let sulcus_bin = match find_sulcus_local_bin() {
        Some(p) => p,
        None => {
            eprintln!("skipping e2e_multi_client_sync: sulcus-local binary not found; run `cargo build -p sulcus-local` first");
            return Ok(());
        }
    };

    // start server (in-memory state)
    let state: SharedState = Arc::new(AppState::new());
    let app = make_app_with_state(state.clone());
    // Start a small hyper server that delegates to the same handler functions
    // used by the axum router so we have a real HTTP endpoint for the test.
    use axum::extract::{Json as AxJson, Query as AxQuery, State as AxState};
    use hyper::service::{make_service_fn, service_fn};
    use hyper::{Body, Method, Request, Response, StatusCode};

    let app_state = state.clone();
    let make_svc = make_service_fn(move |_conn| {
        let state = app_state.clone();
        async move {
            Ok::<_, hyper::Error>(service_fn(move |req: Request<Body>| {
                let state = state.clone();
                async move {
                    match (req.method(), req.uri().path()) {
                        (&Method::POST, "/api/v1/agent/sync") => {
                            // derive tenant_id from Authorization header BEFORE consuming body
                            let tenant_id = req
                                .headers()
                                .get("authorization")
                                .and_then(|v| v.to_str().ok())
                                .and_then(|h| {
                                    if h.starts_with("Bearer ") {
                                        let token = h.trim_start_matches("Bearer ").trim();
                                        let mut hasher = sha2::Sha256::new();
                                        hasher.update(token.as_bytes());
                                        Some(hex::encode(hasher.finalize()))
                                    } else {
                                        None
                                    }
                                })
                                .unwrap_or_else(|| "test-tenant".to_string());

                            // parse incoming request as a sync request
                            let bytes = hyper::body::to_bytes(req.into_body())
                                .await
                                .unwrap_or_default();
                            let sync_req: sulcus_server::agent::SyncRequest =
                                serde_json::from_slice(&bytes).unwrap_or(
                                    sulcus_server::agent::SyncRequest {
                                        ops: vec![],
                                        last_cursor: None,
                                    },
                                );

                            // DB-backed path (tenant-scoped)
                            if let Some(pool) = state.pg_pool.as_ref() {
                                if !sync_req.ops.is_empty() {
                                    let _ = sulcus_server::db::persist_ops_and_upsert_golden(
                                        pool,
                                        &tenant_id,
                                        &sync_req.ops,
                                    )
                                    .await;
                                }

                                let since_ts: Option<chrono::DateTime<chrono::Utc>> =
                                    match sync_req.last_cursor {
                                        Some(ref s) => chrono::DateTime::parse_from_rfc3339(s)
                                            .ok()
                                            .map(|dt| dt.with_timezone(&chrono::Utc)),
                                        None => None,
                                    };

                                let new_ops =
                                    sulcus_server::db::fetch_ops_since(pool, &tenant_id, since_ts)
                                        .await
                                        .unwrap_or_default();
                                let latest_seq: Option<i64> = sqlx::query_scalar(
                                    "SELECT max(seq_id) FROM server_ops WHERE tenant_id = $1",
                                )
                                .bind(&tenant_id)
                                .fetch_one(pool)
                                .await
                                .ok();
                                let resp_body = serde_json::json!({ "new_ops": new_ops, "new_cursor": chrono::Utc::now().to_rfc3339(), "new_cursor_seq": latest_seq });
                                return Ok::<_, hyper::Error>(
                                    Response::builder()
                                        .status(StatusCode::OK)
                                        .header("content-type", "application/json")
                                        .body(Body::from(resp_body.to_string()))
                                        .unwrap(),
                                );
                            }

                            // in-memory fallback: merge into AppState (tenant-scoped)
                            for op in sync_req.ops.into_iter() {
                                let hash = sulcus_core::sync::compute_op_hash(&op);
                                let mut ops_map = state.ops.lock().await;
                                let tenant_wal =
                                    ops_map.entry(tenant_id.clone()).or_insert_with(Vec::new);
                                let duplicate = tenant_wal.iter().any(|existing| {
                                    sulcus_core::sync::compute_op_hash(existing) == hash
                                });
                                drop(ops_map);
                                if duplicate {
                                    continue;
                                }

                                match op.op {
                                    sulcus_core::sync::OpType::Add
                                    | sulcus_core::sync::OpType::Update => {
                                        if let Some(node) = op.payload.clone() {
                                            let mut golden_map = state.golden.lock().await;
                                            let tenant_golden = golden_map
                                                .entry(tenant_id.clone())
                                                .or_insert_with(std::collections::HashMap::new);
                                            tenant_golden.insert(node.id, node);
                                        }
                                    }
                                    sulcus_core::sync::OpType::Delete => {
                                        if let Some(node) = op.payload.clone() {
                                            let mut golden_map = state.golden.lock().await;
                                            if let Some(tenant_golden) =
                                                golden_map.get_mut(&tenant_id)
                                            {
                                                tenant_golden.remove(&node.id);
                                            }
                                        }
                                    }
                                    sulcus_core::sync::OpType::Patch => {
                                        // Patch ops: applied via CRDT merge; golden updated on next Add/Update.
                                    }
                                }

                                let mut ops_map = state.ops.lock().await;
                                let tenant_wal =
                                    ops_map.entry(tenant_id.clone()).or_insert_with(Vec::new);
                                tenant_wal.push(op);
                            }

                            // return WAL ops since cursor
                            let since_ts: Option<chrono::DateTime<chrono::Utc>> =
                                match sync_req.last_cursor {
                                    Some(ref s) => chrono::DateTime::parse_from_rfc3339(s)
                                        .ok()
                                        .map(|dt| dt.with_timezone(&chrono::Utc)),
                                    None => None,
                                };
                            let ops_map = state.ops.lock().await;
                            let tenant_wal = ops_map.get(&tenant_id).cloned().unwrap_or_default();
                            let new_ops: Vec<sulcus_core::sync::MemoryOp> = tenant_wal
                                .iter()
                                .cloned()
                                .filter(|o| match since_ts {
                                    Some(ref ts) => o.timestamp > *ts,
                                    None => true,
                                })
                                .collect();
                            let resp_body = serde_json::json!({ "new_ops": new_ops, "new_cursor": chrono::Utc::now().to_rfc3339(), "new_cursor_seq": (tenant_wal.len() as i64) });
                            return Ok::<_, hyper::Error>(
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header("content-type", "application/json")
                                    .body(Body::from(resp_body.to_string()))
                                    .unwrap(),
                            );
                        }
                        (&Method::GET, "/api/v1/agent/hot_nodes") => {
                            // parse optional limit
                            let limit = req.uri().query().and_then(|q| {
                                q.split('&').find_map(|pair| {
                                    let mut parts = pair.splitn(2, '=');
                                    let k = parts.next().unwrap_or("");
                                    let v = parts.next().unwrap_or("");
                                    if k == "limit" {
                                        v.parse::<u32>().ok()
                                    } else {
                                        None
                                    }
                                })
                            });

                            // derive tenant_id from Authorization header (if present)
                            let tenant_id = req
                                .headers()
                                .get("authorization")
                                .and_then(|v| v.to_str().ok())
                                .and_then(|h| {
                                    if h.starts_with("Bearer ") {
                                        let token = h.trim_start_matches("Bearer ").trim();
                                        let mut hasher = sha2::Sha256::new();
                                        hasher.update(token.as_bytes());
                                        Some(hex::encode(hasher.finalize()))
                                    } else {
                                        None
                                    }
                                })
                                .unwrap_or_else(|| "test-tenant".to_string());

                            if let Some(pool) = state.pg_pool.as_ref() {
                                let nodes = sulcus_server::db::fetch_top_hot_nodes(
                                    pool,
                                    &tenant_id,
                                    limit.unwrap_or(20) as i64,
                                )
                                .await
                                .unwrap_or_default();
                                let body = serde_json::to_string(&nodes)
                                    .unwrap_or_else(|_| "[]".to_string());
                                return Ok::<_, hyper::Error>(
                                    Response::builder()
                                        .status(StatusCode::OK)
                                        .header("content-type", "application/json")
                                        .body(Body::from(body))
                                        .unwrap(),
                                );
                            }
                            let golden_map = state.golden.lock().await;
                            let tenant_map = golden_map.get(&tenant_id);
                            let mut v: Vec<_> = match tenant_map {
                                Some(m) => m.values().cloned().collect(),
                                None => Vec::new(),
                            };
                            v.sort_by(|a, b| {
                                b.current_heat
                                    .partial_cmp(&a.current_heat)
                                    .unwrap_or(std::cmp::Ordering::Equal)
                            });
                            v.truncate(limit.unwrap_or(20) as usize);
                            let body =
                                serde_json::to_string(&v).unwrap_or_else(|_| "[]".to_string());
                            Ok::<_, hyper::Error>(
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header("content-type", "application/json")
                                    .body(Body::from(body))
                                    .unwrap(),
                            )
                        }
                        (&Method::GET, "/api/v1/metrics") => {
                            // derive tenant_id from Authorization header (if present)
                            let tenant_id = req
                                .headers()
                                .get("authorization")
                                .and_then(|v| v.to_str().ok())
                                .and_then(|h| {
                                    if h.starts_with("Bearer ") {
                                        let token = h.trim_start_matches("Bearer ").trim();
                                        let mut hasher = sha2::Sha256::new();
                                        hasher.update(token.as_bytes());
                                        Some(hex::encode(hasher.finalize()))
                                    } else {
                                        None
                                    }
                                })
                                .unwrap_or_else(|| "test-tenant".to_string());

                            let golden_index_size: i64 = if let Some(pool) = state.pg_pool.as_ref()
                            {
                                sqlx::query_scalar::<_, i64>(
                                    "SELECT count(*) FROM golden_index WHERE tenant_id = $1",
                                )
                                .bind(&tenant_id)
                                .fetch_one(pool)
                                .await
                                .unwrap_or(0)
                            } else {
                                let g = state.golden.lock().await;
                                g.get(&tenant_id).map(|m| m.len()).unwrap_or(0) as i64
                            };
                            let server_ops_count: i64 = if let Some(pool) = state.pg_pool.as_ref() {
                                sqlx::query_scalar::<_, i64>(
                                    "SELECT count(*) FROM server_ops WHERE tenant_id = $1",
                                )
                                .bind(&tenant_id)
                                .fetch_one(pool)
                                .await
                                .unwrap_or(0)
                            } else {
                                let ops = state.ops.lock().await;
                                ops.get(&tenant_id).map(|v| v.len()).unwrap_or(0) as i64
                            };
                            let db_size_bytes: i64 = if let Some(pool) = state.pg_pool.as_ref() {
                                sqlx::query_scalar::<_, i64>(
                                    "SELECT pg_database_size(current_database())",
                                )
                                .fetch_one(pool)
                                .await
                                .unwrap_or(0)
                            } else {
                                0
                            };
                            let metrics = serde_json::json!({ "golden_index_size": golden_index_size, "server_ops_count": server_ops_count, "db_size_bytes": db_size_bytes, "pg_enabled": state.pg_pool.is_some() });
                            Ok::<_, hyper::Error>(
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header("content-type", "application/json")
                                    .body(Body::from(metrics.to_string()))
                                    .unwrap(),
                            )
                        }
                        _ => Ok::<_, hyper::Error>(
                            Response::builder()
                                .status(StatusCode::NOT_FOUND)
                                .body(Body::empty())
                                .unwrap(),
                        ),
                    }
                }
            }))
        }
    });

    let server =
        hyper::Server::bind(&std::net::SocketAddr::from(([127, 0, 0, 1], 0))).serve(make_svc);
    let local_addr = server.local_addr();
    let _jh = tokio::spawn(server);
    let server_url = format!("http://{}", local_addr);

    // spawn two sulcus-local instances pointing at the server
    let tmp1 = NamedTempFile::new()?;
    let db1 = tmp1.path().to_str().unwrap().to_string();

    let mut child1 = Command::new(&sulcus_bin)
        .arg("stdio")
        .env("SULCUS_DB_PATH", &db1)
        .env("SULCUS_SERVER_URL", &server_url)
        .env("SULCUS_API_KEY", "test-key")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let tmp2 = NamedTempFile::new()?;
    let db2 = tmp2.path().to_str().unwrap().to_string();

    let mut child2 = Command::new(&sulcus_bin)
        .arg("stdio")
        .env("SULCUS_DB_PATH", &db2)
        .env("SULCUS_SERVER_URL", &server_url)
        .env("SULCUS_API_KEY", "test-key")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let mut stdin1 = child1.stdin.take().expect("child1 stdin");
    let stdout1 = child1.stdout.take().expect("child1 stdout");
    let stderr1 = child1.stderr.take().expect("child1 stderr");
    let mut lines1 = BufReader::new(stdout1).lines();
    let mut err_lines1 = BufReader::new(stderr1).lines();

    let mut stdin2 = child2.stdin.take().expect("child2 stdin");
    let stdout2 = child2.stdout.take().expect("child2 stdout");
    let stderr2 = child2.stderr.take().expect("child2 stderr");
    let mut lines2 = BufReader::new(stdout2).lines();
    let mut err_lines2 = BufReader::new(stderr2).lines();

    // quick sanity: ensure children haven't exited immediately
    if let Some(s) = child1.try_wait()? {
        let mut collected = String::new();
        loop {
            match tokio::time::timeout(std::time::Duration::from_millis(50), err_lines1.next_line())
                .await
            {
                Ok(Ok(Some(line))) => {
                    collected.push_str(&line);
                    collected.push('\n');
                }
                _ => break,
            }
        }
        anyhow::bail!(
            "sulcus-local child1 exited early: {}\nstderr:\n{}",
            s,
            collected
        );
    }
    if let Some(s) = child2.try_wait()? {
        let mut collected = String::new();
        loop {
            match tokio::time::timeout(std::time::Duration::from_millis(50), err_lines2.next_line())
                .await
            {
                Ok(Ok(Some(line))) => {
                    collected.push_str(&line);
                    collected.push('\n');
                }
                _ => break,
            }
        }
        anyhow::bail!(
            "sulcus-local child2 exited early: {}\nstderr:\n{}",
            s,
            collected
        );
    }

    // client1: add memory
    let req =
        json!({ "id": "c1-m1", "method": "add_memory", "params": { "content": "client1-memory" } });
    let resp = match send_and_recv(&mut stdin1, &mut lines1, &req).await {
        Ok(r) => r,
        Err(e) => {
            let mut collected = String::new();
            loop {
                match tokio::time::timeout(
                    std::time::Duration::from_millis(20),
                    err_lines1.next_line(),
                )
                .await
                {
                    Ok(Ok(Some(line))) => {
                        collected.push_str(&line);
                        collected.push('\n');
                    }
                    _ => break,
                }
            }
            anyhow::bail!("client1 add_memory failed: {}\nstderr:\n{}", e, collected);
        }
    };
    let id1 = resp
        .get("result")
        .and_then(|r| r.get("node_id"))
        .and_then(|n| n.as_str())
        .unwrap()
        .to_string();

    // client2: add memory
    let req =
        json!({ "id": "c2-m1", "method": "add_memory", "params": { "content": "client2-memory" } });
    let resp = match send_and_recv(&mut stdin2, &mut lines2, &req).await {
        Ok(r) => r,
        Err(e) => {
            let mut collected = String::new();
            loop {
                match tokio::time::timeout(
                    std::time::Duration::from_millis(20),
                    err_lines2.next_line(),
                )
                .await
                {
                    Ok(Ok(Some(line))) => {
                        collected.push_str(&line);
                        collected.push('\n');
                    }
                    _ => break,
                }
            }
            anyhow::bail!("client2 add_memory failed: {}\nstderr:\n{}", e, collected);
        }
    };
    let id2 = resp
        .get("result")
        .and_then(|r| r.get("node_id"))
        .and_then(|n| n.as_str())
        .unwrap()
        .to_string();

    // concurrently call sync_now on both clients
    let sync_req1 = json!({ "id": "s1", "method": "sync_now" });
    let sync_req2 = json!({ "id": "s2", "method": "sync_now" });
    let fut1 = send_and_recv(&mut stdin1, &mut lines1, &sync_req1);
    let fut2 = send_and_recv(&mut stdin2, &mut lines2, &sync_req2);
    let (r1, r2) = tokio::join!(fut1, fut2);
    if let Err(e) = &r1 {
        // capture child status + stderr if available
        let status = child1.try_wait()?;
        let mut collected = String::new();
        loop {
            match tokio::time::timeout(std::time::Duration::from_millis(20), err_lines1.next_line())
                .await
            {
                Ok(Ok(Some(line))) => {
                    collected.push_str(&line);
                    collected.push('\n');
                }
                _ => break,
            }
        }
        anyhow::bail!(
            "child1 sync_now failed: {}\nstatus: {:?}\nstderr:\n{}",
            e,
            status,
            collected
        );
    }
    if let Err(e) = &r2 {
        let status = child2.try_wait()?;
        let mut collected = String::new();
        loop {
            match tokio::time::timeout(std::time::Duration::from_millis(20), err_lines2.next_line())
                .await
            {
                Ok(Ok(Some(line))) => {
                    collected.push_str(&line);
                    collected.push('\n');
                }
                _ => break,
            }
        }
        anyhow::bail!(
            "child2 sync_now failed: {}\nstatus: {:?}\nstderr:\n{}",
            e,
            status,
            collected
        );
    }
    r1?;
    r2?;

    // give server a moment to process
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // verify server metrics (must report both nodes)
    let client = reqwest::Client::new();
    let metrics_url = format!("{}/api/v1/metrics", server_url.trim_end_matches('/'));
    let resp = client
        .get(&metrics_url)
        .bearer_auth("test-key")
        .send()
        .await?;
    assert!(resp.status().is_success());
    let m: serde_json::Value = resp.json().await?;
    let golden = m
        .get("golden_index_size")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    assert!(
        golden >= 2,
        "expected golden_index_size >= 2, got {}",
        golden
    );

    // verify each client pulled the other's node (get_node)
    let req = json!({ "id": "g1", "method": "get_node", "params": { "node_id": id2 } });
    let resp = send_and_recv(&mut stdin1, &mut lines1, &req).await?;
    assert!(resp.get("result").and_then(|r| r.get("node")).is_some());

    let req = json!({ "id": "g2", "method": "get_node", "params": { "node_id": id1 } });
    let resp = send_and_recv(&mut stdin2, &mut lines2, &req).await?;
    assert!(resp.get("result").and_then(|r| r.get("node")).is_some());

    // cleanup children
    child1.kill().await.ok();
    child1.wait().await.ok();
    child2.kill().await.ok();
    child2.wait().await.ok();

    Ok(())
}
