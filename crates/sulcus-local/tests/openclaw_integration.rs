use serde_json::json;
use serde_json::Value;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};

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
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;

    let mut stdin: ChildStdin = child.stdin.take().expect("child stdin");
    let stdout = child.stdout.take().expect("child stdout");
    let mut lines = BufReader::new(stdout).lines();

    // helper: send a JSON request line and read a single JSON response line
    async fn send_and_recv(
        stdin: &mut ChildStdin,
        lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
        req: &Value,
    ) -> anyhow::Result<Value> {
        let s = req.to_string() + "\n";
        stdin.write_all(s.as_bytes()).await?;
        stdin.flush().await?;

        // read a response line (timeout to avoid hanging tests)
        let line =
            tokio::time::timeout(std::time::Duration::from_secs(2), lines.next_line()).await??;
        let line = line.ok_or_else(|| anyhow::anyhow!("child closed stdout"))?;
        let v: Value = serde_json::from_str(&line)?;
        Ok(v)
    }

    // 1) describe_tools
    let req = json!({ "id": "t1", "method": "describe_tools" });
    let resp = send_and_recv(&mut stdin, &mut lines, &req).await?;
    let manifest = resp
        .get("result")
        .ok_or_else(|| anyhow::anyhow!("missing result"))?;
    assert!(manifest.get("tools").and_then(|t| t.as_array()).is_some());

    // 2) add_memory
    let req = json!({ "id": "m1", "method": "add_memory", "params": { "content": "openclaw test memory" } });
    let resp = send_and_recv(&mut stdin, &mut lines, &req).await?;
    let node_id = resp
        .get("result")
        .and_then(|r| r.get("node_id"))
        .and_then(|n| n.as_str())
        .ok_or_else(|| anyhow::anyhow!("missing node_id"))?
        .to_string();
    assert!(!node_id.is_empty());

    // 3) resource -> memory://active_index
    let req = json!({ "id": "r1", "method": "resource", "params": { "resource": "memory://active_index", "limit": 10 } });
    let resp = send_and_recv(&mut stdin, &mut lines, &req).await?;
    let list = resp
        .get("result")
        .and_then(|r| r.as_array())
        .ok_or_else(|| anyhow::anyhow!("expected array result"))?;
    assert!(list
        .iter()
        .any(|n| n.get("summary").and_then(|s| s.as_str()) == Some("openclaw test memory")));

    // cleanup
    child.kill().await?;
    child.wait().await?;
    Ok(())
}
