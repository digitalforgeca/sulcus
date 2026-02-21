use serde_json::json;
use serde_json::Value;
use std::process::Stdio;
use tokio::process::Command;

#[tokio::test]
async fn openclaw_stdio_integration() -> anyhow::Result<()> {
    // Spawn `sulcus-local serve` as an external sidecar and talk MCP JSON over stdin/stdout.
    let tmp = tempfile::NamedTempFile::new()?;
    let db_path = tmp.path().to_str().unwrap().to_owned();

    // Path to compiled binary: prefer Cargo-provided env, fall back to workspace target/debug
    let bin = std::env::var("CARGO_BIN_EXE_sulcus-local")
        .ok()
        .or_else(|| {
            // search upward from cwd to find `target/debug/sulcus-local` (workspace or crate-level)
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
        })
        .expect("sulcus-local binary not found; run `cargo build -p sulcus-local` first");

    let mut child = Command::new(bin)
        .arg("serve")
        .env("SULCUS_DB_PATH", &db_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    // connect to SSE and obtain session + receiver
    let client = reqwest::Client::new();
    let mut attempts = 0u32;
    let (session_id, mut rx) = loop {
        if attempts > 40 {
            child.kill().await.ok();
            return Err(anyhow::anyhow!("sulcus-local failed to start SSE listener"));
        }
        attempts += 1;
        if let Ok(resp) = client.get("http://127.0.0.1:8173/sse").send().await {
            if resp.status().is_success() {
                let mut stream = resp.bytes_stream();
                let (tx, mut rx) = tokio::sync::mpsc::channel(16);
                tokio::spawn(async move {
                    use futures::StreamExt;
                    let mut buf = Vec::new();
                    while let Some(chunk) = stream.next().await {
                        if let Ok(bytes) = chunk {
                            buf.extend_from_slice(&bytes);
                            while let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
                                let ev = buf.drain(..pos + 2).collect::<Vec<u8>>();
                                if let Ok(s) = String::from_utf8(ev) {
                                    let mut et = None;
                                    let mut data = String::new();
                                    for line in s.lines() {
                                        if line.starts_with("event:") {
                                            et = Some(line[6..].trim().to_string());
                                        }
                                        if line.starts_with("data:") {
                                            if !data.is_empty() {
                                                data.push_str("\n");
                                            }
                                            data.push_str(line[5..].trim());
                                        }
                                    }
                                    if let Some(evn) = et {
                                        if evn == "endpoint" {
                                            let _ = tx.send(data.clone()).await;
                                        } else if evn == "message" {
                                            let _ = tx.send(data.clone()).await;
                                        }
                                    }
                                }
                            }
                        } else {
                            break;
                        }
                    }
                });

                // wait for endpoint event
                if let Ok(Some(ep)) =
                    tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv()).await
                {
                    if let Some(idx) = ep.find("sessionId=") {
                        let sid = ep[idx + "sessionId=".len()..].to_string();
                        break (sid, rx);
                    }
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    };

    async fn send_and_recv(
        client: &reqwest::Client,
        session: &str,
        stream_rx: &mut tokio::sync::mpsc::Receiver<String>,
        req: &Value,
    ) -> anyhow::Result<Value> {
        let url = format!("http://127.0.0.1:8173/message?sessionId={}", session);
        let body = req.to_string();
        client
            .post(&url)
            .header("content-type", "application/json")
            .body(body)
            .send()
            .await?;
        let line =
            tokio::time::timeout(std::time::Duration::from_secs(2), stream_rx.recv()).await?
                .ok_or_else(|| anyhow::anyhow!("SSE channel closed"))?;;
        let v: Value = serde_json::from_str(&line)?;
        Ok(v)
    }

    // 1) tools/list
    let req = json!({ "jsonrpc": "2.0", "id": "t1", "method": "tools/list" });
    let resp = send_and_recv(&client, &session_id, &mut rx, &req).await?;
    let manifest = resp
        .get("result")
        .ok_or_else(|| anyhow::anyhow!("missing result"))?;
    assert!(manifest.get("tools").and_then(|t| t.as_array()).is_some());

    // 2) add_memory via tools/call
    let req = json!({ "jsonrpc": "2.0", "id": "m1", "method": "tools/call", "params": { "name": "add_memory", "arguments": { "content": "openclaw test memory" } } });
    let resp = send_and_recv(&client, &session_id, &mut rx, &req).await?;
    let content_text = resp
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c[0].get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| anyhow::anyhow!("missing content text"))?;
    let inner: Value = serde_json::from_str(content_text)?;
    let node_id = inner
        .get("node_id")
        .and_then(|n| n.as_str())
        .ok_or_else(|| anyhow::anyhow!("missing node_id"))?
        .to_string();
    assert!(!node_id.is_empty());

    // 3) resources/read -> memory://active_index
    let req = json!({ "jsonrpc": "2.0", "id": "r1", "method": "resources/read", "params": { "uri": "memory://active_index", "limit": 10 } });
    let resp = send_and_recv(&client, &session_id, &mut rx, &req).await?;
    let contents = resp
        .get("result")
        .and_then(|r| r.get("contents"))
        .and_then(|c| c.as_array())
        .ok_or_else(|| anyhow::anyhow!("expected contents array"))?;
    let text = contents[0]
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("[]");
    let list: Value = serde_json::from_str(text)?;
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .any(|n| n.get("pointer_summary").and_then(|s| s.as_str())
                == Some("openclaw test memory"))
    );

    // cleanup
    child.kill().await?;
    child.wait().await?;
    Ok(())
}
