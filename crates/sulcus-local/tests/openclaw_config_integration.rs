use serde_json::json;
use serde_json::Value;
use std::io::Write;
use std::process::Stdio;
use tempfile::NamedTempFile;
use tokio::process::Command;

// Helper: spawn sulcus-local with given INI and DB paths and return stdin/stdout lines iterator
async fn spawn_with_config(
    db_url: &str,
    ini_path: &str,
) -> anyhow::Result<(
    reqwest::Client,
    String, // session_id
    tokio::sync::mpsc::Receiver<String>,
    tokio::process::Child,
)> {
    // Path to compiled binary provided by Cargo during integration tests
    let bin = std::env::var("CARGO_BIN_EXE_sulcus-local").ok().or_else(|| {
        // fallback to workspace target/debug/sulcus-local when env var not provided
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let workspace = std::path::Path::new(manifest_dir).parent().and_then(|p| p.parent()).map(|p| p.to_path_buf());
        if let Some(ws) = workspace {
            let candidate = ws.join("target/debug/sulcus-local");
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        None
    }).expect("sulcus-local binary not found; build with `cargo build -p sulcus-local` before running this test");

    let mut child = Command::new(bin)
        .arg("serve")
        .env("SULCUS_DATABASE_URL", db_url)
        .env("SULCUS_CONFIG", ini_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    let client = reqwest::Client::new();

    // connect to SSE and parse the first `endpoint` event to learn the sessionId
    let mut attempts = 0u32;
    loop {
        if attempts > 40 {
            child.kill().await.ok();
            return Err(anyhow::anyhow!("sulcus-local failed to start SSE listener"));
        }
        attempts += 1;
        match client.get("http://127.0.0.1:4203/sse").send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    continue;
                }
                let mut stream = resp.bytes_stream();
                let (tx, mut rx) = tokio::sync::mpsc::channel(16);
                // spawn background task to parse SSE stream
                let tx_clone = tx.clone();
                tokio::spawn(async move {
                    use futures::StreamExt;
                    let mut buf = Vec::new();
                    while let Some(chunk) = stream.next().await {
                        if let Ok(bytes) = chunk {
                            buf.extend_from_slice(&bytes);
                            // look for SSE event delimiter
                            while let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
                                let ev = buf.drain(..pos + 2).collect::<Vec<u8>>();
                                if let Ok(s) = String::from_utf8(ev) {
                                    let mut event_type = None;
                                    let mut data = String::new();
                                    for line in s.lines() {
                                        if line.starts_with("event:") {
                                            event_type = Some(line[6..].trim().to_string());
                                        } else if line.starts_with("data:") {
                                            let d = line[5..].trim();
                                            if !data.is_empty() {
                                                data.push_str("\n");
                                            }
                                            data.push_str(d);
                                        }
                                    }
                                    if let Some(et) = event_type {
                                        if et == "message" {
                                            let _ = tx_clone.send(data.clone()).await;
                                        } else if et == "endpoint" {
                                            // send endpoint string to the receiver so test harness can extract sessionId
                                            let _ = tx_clone.send(data.clone()).await;
                                        }
                                    }
                                }
                            }
                        } else {
                            break;
                        }
                    }
                });

                // wait for the endpoint event (timeout)
                let endpoint =
                    tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv()).await;
                if let Ok(Some(ep)) = endpoint {
                    // endpoint contains something like `/message?sessionId=...`
                    if let Some(idx) = ep.find("sessionId=") {
                        let sid = ep[idx + "sessionId=".len()..].to_string();
                        return Ok((client, sid, rx, child));
                    }
                }
            }
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        }
    }
}

async fn send_and_recv(
    client: &reqwest::Client,
    session: &str,
    stream_rx: &mut tokio::sync::mpsc::Receiver<String>,
    req: &Value,
) -> anyhow::Result<Value> {
    let url = format!("http://127.0.0.1:4203/message?sessionId={}", session);
    let body = req.to_string();
    client
        .post(&url)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await?;

    // wait for SSE `message` event containing the JSON-RPC response
    let line = tokio::time::timeout(std::time::Duration::from_secs(5), stream_rx.recv()).await?
        .ok_or_else(|| anyhow::anyhow!("SSE channel closed"))?;
    let v: Value = serde_json::from_str(&line)?;
    Ok(v)
}

/// Create a fresh ephemeral PostgreSQL database and return its URL.
/// The caller is responsible for dropping it after use.
async fn create_ephemeral_db() -> anyhow::Result<(String, String)> {
    let base_url = std::env::var("SULCUS_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://sulcus:sulcus@127.0.0.1:5432/sulcus_test".to_string());
    // Derive admin URL pointing at the `postgres` maintenance DB
    let admin_url = {
        let mut opts: sqlx::postgres::PgConnectOptions = base_url.parse()?;
        // connect to the `postgres` maintenance database to issue CREATE DATABASE
        opts = opts.database("postgres");
        let mut s = format!(
            "postgres://{}:{}@{}:{}/postgres",
            opts.get_username(),
            "sulcus", // password not exposed on PgConnectOptions; use known value
            opts.get_host(),
            opts.get_port(),
        );
        // preserve sslmode=disable if present
        if base_url.contains("sslmode=disable") { s.push_str("?sslmode=disable"); }
        s
    };
    let db_name = format!("sulcus_cfg_{}", uuid::Uuid::new_v4().simple());
    let mut opts: sqlx::postgres::PgConnectOptions = admin_url.parse()?;
    opts = opts.statement_cache_capacity(0);

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    sqlx::query(&format!("CREATE DATABASE {}", db_name)).execute(&pool).await?;
    pool.close().await;
    // Build the URL for the new database
    let db_url = base_url
        .rsplit_once('/')
        .map(|(prefix, _)| format!("{}/{}", prefix, db_name))
        .unwrap_or_else(|| format!("{}/{}", base_url.trim_end_matches('/'), db_name));
    Ok((db_url, db_name))
}

async fn drop_ephemeral_db(db_name: &str) -> anyhow::Result<()> {
    let base_url = std::env::var("SULCUS_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://sulcus:sulcus@127.0.0.1:5432/sulcus_test".to_string());
    let admin_url = {
        let mut s = base_url
            .rsplit_once('/')
            .map(|(prefix, _)| format!("{}/postgres", prefix))
            .unwrap_or_else(|| "postgres://sulcus:sulcus@127.0.0.1:5432/postgres".to_string());
        if base_url.contains("sslmode=disable") && !s.contains("sslmode") { s.push_str("?sslmode=disable"); }
        s
    };
    let mut opts: sqlx::postgres::PgConnectOptions = admin_url.parse()?;
    opts = opts.statement_cache_capacity(0);

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    // Terminate any open connections first
    sqlx::query(&format!(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}' AND pid <> pg_backend_pid()",
        db_name
    )).execute(&pool).await.ok();
    sqlx::query(&format!("DROP DATABASE IF EXISTS {}", db_name)).execute(&pool).await?;
    pool.close().await;
    Ok(())
}

#[tokio::test]
async fn config_active_limit_increases_agent_working_set_metric() -> anyhow::Result<()> {
    // create two separate ephemeral PostgreSQL databases and two INI files
    let (db1_url, db1_name) = create_ephemeral_db().await?;
    let (db2_url, db2_name) = create_ephemeral_db().await?;

    let mut ini1 = NamedTempFile::new()?;
    writeln!(
        ini1,
        "[sulcus]
active_limit = 5
therm_interval_ms = 100"
    )?;
    let ini1_path = ini1.path().to_str().unwrap().to_string();

    let mut ini2 = NamedTempFile::new()?;
    writeln!(
        ini2,
        "[sulcus]
active_limit = 15
therm_interval_ms = 100"
    )?;
    let ini2_path = ini2.path().to_str().unwrap().to_string();

    // helper to populate DB via MCP and return active_index summaries and recall fraction
    async fn run_and_measure(
        db_path: &str,
        ini_path: &str,
    ) -> anyhow::Result<(usize, f64)> {
        let (client, session_id, mut rx, mut child) = spawn_with_config(db_path, ini_path).await?;

        // insert 30 nodes via commit_memory with unique labels
        // all nodes get current_heat=1.0 from commit_memory; the background worker
        // will apply thermodynamics and fill active_index with the configured limit
        for i in 1..=30 {
            let summary = format!("mem-{}", i);
            let req = json!({
                "jsonrpc": "2.0",
                "id": format!("c-{}", i),
                "method": "tools/call",
                "params": {
                    "name": "commit_memory",
                    "arguments": {
                        "label": summary.clone(),
                        "pointer_summary": summary
                    }
                }
            });
            let _ = send_and_recv(&client, &session_id, &mut rx, &req).await?;
        }

        // Wait for the background worker (therm_interval_ms=100) to run at least a few ticks
        // so active_index table is populated with the configured active_limit
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;

        // fetch active index (large limit to inspect full active_index)
        let req = json!({ "jsonrpc": "2.0", "id": "r1", "method": "resources/read", "params": { "uri": "memory://active_index", "limit": 100 } });
        let resp = send_and_recv(&client, &session_id, &mut rx, &req).await?;
        let contents = resp
            .get("result")
            .and_then(|r| r.get("contents"))
            .and_then(|c| c.as_array())
            .ok_or_else(|| anyhow::anyhow!("expected contents"))?
            .clone();
        let text = contents[0]
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("[]");
        let list: Vec<serde_json::Value> = serde_json::from_str(text)?;

        // extract summaries (exclude tombstone entries)
        let summaries: Vec<String> = list
            .iter()
            .filter(|v| v.get("is_tombstone").and_then(|t| t.as_bool()).unwrap_or(false) == false)
            .filter_map(|v| {
                v.get("pointer_summary")
                    .and_then(|s| s.as_str())
                    .map(|s| s.to_string())
            })
            .collect();

        // compute recall fraction for the last 10 items (mem-21..mem-30)
        let mut hits = 0;
        for i in 21..=30 {
            let name = format!("mem-{}", i);
            if summaries.iter().any(|s| s == &name) {
                hits += 1;
            }
        }
        let recall_fraction = hits as f64 / 10.0;

        // cleanup
        child.kill().await?;
        child.wait().await?;

        Ok((summaries.len(), recall_fraction))
    }

    let result1 = run_and_measure(&db1_url, &ini1_path).await;
    let result2 = run_and_measure(&db2_url, &ini2_path).await;

    // cleanup ephemeral DBs regardless of test outcome
    drop_ephemeral_db(&db1_name).await.ok();
    drop_ephemeral_db(&db2_name).await.ok();

    let (size_small, recall_small) = result1?;
    let (size_large, recall_large) = result2?;

    println!("size_small={} recall_small={} size_large={} recall_large={}", size_small, recall_small, size_large, recall_large);

    // metric expectations
    assert_eq!(
        size_small, 5,
        "active_index must respect active_limit from INI (small)"
    );
    assert_eq!(
        size_large, 15,
        "active_index must respect active_limit from INI (large)"
    );

    // recall should be no worse when active_limit is larger
    // (since all nodes have equal heat, recall is random, so we only check monotonicity)
    assert!(
        recall_large >= recall_small,
        "larger active_limit must not reduce recall"
    );

    Ok(())
}
