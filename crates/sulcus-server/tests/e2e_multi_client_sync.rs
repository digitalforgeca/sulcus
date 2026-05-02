use serde_json::json;
use sha2::{Digest, Sha256};
use std::process::Stdio;
use sulcus_server::{make_app_with_state, AppState};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())
}

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
                eprintln!(
                    "[send_and_recv] skipping non-JSON line: {:?}",
                    &line[..line.len().min(120)]
                );
                continue;
            }
        }
    }
}

fn find_sulcus_bin() -> Option<String> {
    // prefer Cargo-provided env var
    if let Ok(p) = std::env::var("CARGO_BIN_EXE_sulcus") {
        return Some(p);
    }

    // fallback: search upward for target/debug/sulcus
    let mut dir = std::env::current_dir().ok()?;
    loop {
        let cand = dir.join("target").join("debug").join("sulcus");
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
async fn e2e_server_with_multiple_sulcus_instances() -> anyhow::Result<()> {
    // preconditions
    let database_url = match std::env::var("SULCUS_DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("skipping e2e_multi_client_sync: SULCUS_DATABASE_URL not set");
            return Ok(());
        }
    };
    let sulcus_bin = match find_sulcus_bin() {
        Some(p) => p,
        None => {
            eprintln!("skipping e2e_multi_client_sync: sulcus binary not found; run `cargo build -p sulcus` first");
            return Ok(());
        }
    };

    let api_key_1 = "e2e-test-key-1";
    let api_key_2 = "e2e-test-key-2";

    // start the axum server on a random port
    let state = std::sync::Arc::new(AppState::connect(&database_url).await?);

    // Pre-seed test API keys so the sync middleware accepts them.
    for (key, tenant) in [(api_key_1, "e2e-tenant-1"), (api_key_2, "e2e-tenant-2")] {
        let hash = sha256_hex(key);
        sulcus_server::db::insert_api_key(&state.pool, tenant, &hash, "enterprise")
            .await
            .ok(); // ignore "already exists" on re-runs
    }

    let app = make_app_with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let local_addr = listener.local_addr()?;
    let server_url = format!("http://{}", local_addr);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let mut child1 = Command::new(&sulcus_bin)
        .arg("stdio")
        .env("SULCUS_DATABASE_URL", &database_url)
        .env("SULCUS_SERVER_URL", &server_url)
        .env("SULCUS_API_KEY", api_key_1)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;
    let mut child2 = Command::new(&sulcus_bin)
        .arg("stdio")
        .env("SULCUS_DATABASE_URL", &database_url)
        .env("SULCUS_SERVER_URL", &server_url)
        .env("SULCUS_API_KEY", api_key_2)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;

    let mut stdin1 = child1.stdin.take().expect("child1 stdin");
    let stdout1 = child1.stdout.take().expect("child1 stdout");
    let mut lines1 = BufReader::new(stdout1).lines();
    let mut stdin2 = child2.stdin.take().expect("child2 stdin");
    let stdout2 = child2.stdout.take().expect("child2 stdout");
    let mut lines2 = BufReader::new(stdout2).lines();

    if child1.try_wait()?.is_some() {
        child2.kill().await.ok();
        anyhow::bail!("child1 exited early");
    }
    if child2.try_wait()?.is_some() {
        child1.kill().await.ok();
        anyhow::bail!("child2 exited early");
    }

    // Use MCP tools/call protocol to invoke tools.
    let req = json!({
        "jsonrpc": "2.0", "id": "c1-m1", "method": "tools/call",
        "params": { "name": "record_memory", "arguments": { "content": "client1-memory" } }
    });
    let resp = send_and_recv(&mut stdin1, &mut lines1, &req).await?;
    // result is { "content": [{ "type": "text", "text": "{\"node_id\":\"...\"}" }] }
    let id1 = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|o| o.get("text"))
        .and_then(|t| t.as_str())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| {
            v.get("node_id")
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();

    let req = json!({
        "jsonrpc": "2.0", "id": "c2-m1", "method": "tools/call",
        "params": { "name": "record_memory", "arguments": { "content": "client2-memory" } }
    });
    let resp = send_and_recv(&mut stdin2, &mut lines2, &req).await?;
    let id2 = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|o| o.get("text"))
        .and_then(|t| t.as_str())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| {
            v.get("node_id")
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();

    send_and_recv(
        &mut stdin1,
        &mut lines1,
        &json!({
            "jsonrpc": "2.0", "id": "s1", "method": "tools/call",
            "params": { "name": "sync_now", "arguments": {} }
        }),
    )
    .await?;
    send_and_recv(
        &mut stdin2,
        &mut lines2,
        &json!({
            "jsonrpc": "2.0", "id": "s2", "method": "tools/call",
            "params": { "name": "sync_now", "arguments": {} }
        }),
    )
    .await?;
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;

    let client = reqwest::Client::new();
    let m: serde_json::Value = client
        .get(format!("{}/api/v1/metrics", server_url))
        .bearer_auth(api_key_1)
        .send()
        .await?
        .json()
        .await?;
    let golden = m
        .get("golden_index_size")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    assert!(golden >= 1, "expected golden_index_size >= 1, got {golden}");

    if !id2.is_empty() {
        let _ = send_and_recv(
            &mut stdin1,
            &mut lines1,
            &json!({
                "jsonrpc": "2.0", "id": "g1", "method": "tools/call",
                "params": { "name": "get_node", "arguments": { "node_id": id2 } }
            }),
        )
        .await
        .ok();
    }
    if !id1.is_empty() {
        let _ = send_and_recv(
            &mut stdin2,
            &mut lines2,
            &json!({
                "jsonrpc": "2.0", "id": "g2", "method": "tools/call",
                "params": { "name": "get_node", "arguments": { "node_id": id1 } }
            }),
        )
        .await
        .ok();
    }

    child1.kill().await.ok();
    child1.wait().await.ok();
    child2.kill().await.ok();
    child2.wait().await.ok();
    Ok(())
}
