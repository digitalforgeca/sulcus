use serde_json::json;
use serde_json::Value;
use std::io::Write;
use std::process::Stdio;
use tempfile::NamedTempFile;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

// Helper: spawn sulcus-local with given INI and DB paths and return stdin/stdout lines iterator
async fn spawn_with_config(
    db_path: &str,
    ini_path: &str,
) -> anyhow::Result<(
    tokio::process::ChildStdin,
    tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
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
        .env("SULCUS_DB_PATH", db_path)
        .env("SULCUS_CONFIG", ini_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;

    let mut stdin = child.stdin.take().expect("child stdin");
    let stdout = child.stdout.take().expect("child stdout");
    let mut lines = BufReader::new(stdout).lines();

    // small readiness probe: call tools/list to ensure process is responsive
    async fn send_and_recv_internal(
        stdin: &mut tokio::process::ChildStdin,
        lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
        req: &Value,
    ) -> anyhow::Result<Value> {
        let s = req.to_string() + "\n";
        stdin.write_all(s.as_bytes()).await?;
        stdin.flush().await?;
        let line =
            tokio::time::timeout(std::time::Duration::from_secs(2), lines.next_line()).await??;
        let line = line.ok_or_else(|| anyhow::anyhow!("child closed stdout"))?;
        let v: Value = serde_json::from_str(&line)?;
        Ok(v)
    }

    // wait for tools/list to succeed (give it a few tries)
    for _ in 0..5 {
        let req = json!({ "jsonrpc": "2.0", "id": "probe", "method": "tools/list" });
        let resp = send_and_recv_internal(&mut stdin, &mut lines, &req).await;
        if resp.is_ok() {
            return Ok((stdin, lines, child));
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    Err(anyhow::anyhow!(
        "sulcus-local failed to respond to describe_tools"
    ))
}

async fn send_and_recv(
    stdin: &mut tokio::process::ChildStdin,
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    req: &Value,
) -> anyhow::Result<Value> {
    let s = req.to_string() + "\n";
    stdin.write_all(s.as_bytes()).await?;
    stdin.flush().await?;

    let line = tokio::time::timeout(std::time::Duration::from_secs(2), lines.next_line()).await??;
    let line = line.ok_or_else(|| anyhow::anyhow!("child closed stdout"))?;
    let v: Value = serde_json::from_str(&line)?;
    Ok(v)
}

#[tokio::test]
async fn config_active_limit_increases_agent_working_set_metric() -> anyhow::Result<()> {
    // create two separate DBs and two INI files with different active_limit settings
    let db1 = NamedTempFile::new()?;
    let db2 = NamedTempFile::new()?;
    let db1_path = db1.path().to_str().unwrap().to_string();
    let db2_path = db2.path().to_str().unwrap().to_string();

    let mut ini1 = NamedTempFile::new()?;
    writeln!(
        ini1,
        "[sulcus]
active_limit = 5"
    )?;
    let ini1_path = ini1.path().to_str().unwrap().to_string();

    let mut ini2 = NamedTempFile::new()?;
    writeln!(
        ini2,
        "[sulcus]
active_limit = 15"
    )?;
    let ini2_path = ini2.path().to_str().unwrap().to_string();

    // helper to populate DB via MCP and return active_index summaries and recall fraction
    async fn run_and_measure(
        db_path: &str,
        ini_path: &str,
        active_limit: usize,
    ) -> anyhow::Result<(usize, f64)> {
        let (mut stdin, mut lines, mut child) = spawn_with_config(db_path, ini_path).await?;

        // upsert 30 nodes with increasing heat so the most recent items have higher heat
        // (this ensures thermodynamics selection favors recent items for the recall metric)
        for i in 1..=30 {
            let id = uuid::Uuid::from_u128(i as u128);
            let summary = format!("mem-{}", i);
            let current_heat = (i as f32) / 100.0; // increasing heat in 0..1 space
            let req = json!({ "jsonrpc": "2.0", "id": format!("u-{}", i), "method": "tools/call", "params": { "name": "upsert_node", "arguments": { "id": id.to_string(), "label": summary.clone(), "pointer_summary": summary, "current_heat": current_heat, "base_utility": 0.0, "is_pinned": false } } });
            let _ = send_and_recv(&mut stdin, &mut lines, &req).await?;
        }

        // call tick explicitly with the active_limit so MCP tick uses the configured limit
        let req = json!({ "jsonrpc": "2.0", "id": "t1", "method": "tools/call", "params": { "name": "tick", "arguments": { "active_limit": active_limit } } });
        let _ = send_and_recv(&mut stdin, &mut lines, &req).await?;

        // fetch active index (large limit to inspect full active_index)
        let req = json!({ "jsonrpc": "2.0", "id": "r1", "method": "resources/read", "params": { "uri": "memory://active_index", "limit": 100 } });
        let resp = send_and_recv(&mut stdin, &mut lines, &req).await?;
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

        // extract summaries
        let summaries: Vec<String> = list
            .iter()
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

    let (size_small, recall_small) = run_and_measure(&db1_path, &ini1_path, 5).await?;
    let (size_large, recall_large) = run_and_measure(&db2_path, &ini2_path, 15).await?;

    // metric expectations
    assert_eq!(
        size_small, 5,
        "active_index must respect active_limit from INI (small)"
    );
    assert_eq!(
        size_large, 15,
        "active_index must respect active_limit from INI (large)"
    );

    // recall should be better when active_limit is larger
    assert!(
        recall_large >= recall_small,
        "larger active_limit must not reduce recall"
    );
    assert!(
        recall_large > 0.0,
        "recall should be non-zero for recent items"
    );

    Ok(())
}
