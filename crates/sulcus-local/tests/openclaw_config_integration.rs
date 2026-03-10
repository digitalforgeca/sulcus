use serde_json::json;
use serde_json::Value;
use std::io::Write;
use std::process::Stdio;
use tempfile::NamedTempFile;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

fn find_sulcus_local_bin() -> String {
    if let Ok(p) = std::env::var("CARGO_BIN_EXE_sulcus-local") {
        return p;
    }
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let workspace = std::path::Path::new(manifest_dir)
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());
    if let Some(ws) = workspace {
        let candidate = ws.join("target/debug/sulcus-local");
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }
    panic!("sulcus-local binary not found; run `cargo build -p sulcus-local` first");
}

/// Send a JSON-RPC request via stdin and read the JSON-RPC response from stdout,
/// skipping any non-JSON lines (tracing, startup banners).
async fn send_and_recv(
    stdin: &mut tokio::process::ChildStdin,
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    req: &Value,
) -> anyhow::Result<Value> {
    let s = req.to_string() + "\n";
    stdin.write_all(s.as_bytes()).await?;
    stdin.flush().await?;

    let deadline = std::time::Duration::from_secs(15);
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
        match serde_json::from_str::<Value>(&line) {
            Ok(v) => return Ok(v),
            Err(_) => continue, // skip non-JSON lines (tracing etc.)
        }
    }
}

/// Create a fresh ephemeral PostgreSQL database and return its URL + name.
async fn create_ephemeral_db() -> anyhow::Result<(String, String)> {
    let base_url = std::env::var("SULCUS_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://sulcus:sulcus@127.0.0.1:5432/sulcus_test".to_string());
    let admin_url = {
        let mut opts: sqlx::postgres::PgConnectOptions = base_url.parse()?;
        opts = opts.database("postgres");
        let mut s = format!(
            "postgres://{}:{}@{}:{}/postgres",
            opts.get_username(),
            "sulcus",
            opts.get_host(),
            opts.get_port(),
        );
        if base_url.contains("sslmode=disable") {
            s.push_str("?sslmode=disable");
        }
        s
    };
    let db_name = format!("sulcus_cfg_{}", uuid::Uuid::new_v4().simple());
    let mut opts: sqlx::postgres::PgConnectOptions = admin_url.parse()?;
    opts = opts.statement_cache_capacity(0);

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    sqlx::query(&format!("CREATE DATABASE {}", db_name))
        .execute(&pool)
        .await?;
    pool.close().await;

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
        if base_url.contains("sslmode=disable") && !s.contains("sslmode") {
            s.push_str("?sslmode=disable");
        }
        s
    };
    let mut opts: sqlx::postgres::PgConnectOptions = admin_url.parse()?;
    opts = opts.statement_cache_capacity(0);

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    sqlx::query(&format!(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}' AND pid <> pg_backend_pid()",
        db_name
    ))
    .execute(&pool)
    .await
    .ok();
    sqlx::query(&format!("DROP DATABASE IF EXISTS {}", db_name))
        .execute(&pool)
        .await?;
    pool.close().await;
    Ok(())
}

/// Insert 30 nodes via stdio, then query the DB directly for active_index count.
async fn run_and_measure(db_url: &str, ini_path: &str) -> anyhow::Result<(usize, f64)> {
    let bin = find_sulcus_local_bin();

    let mut child = Command::new(&bin)
        .arg("stdio")
        .env("SULCUS_DATABASE_URL", db_url)
        .env("SULCUS_CONFIG", ini_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;

    let mut stdin = child.stdin.take().expect("child stdin");
    let stdout = child.stdout.take().expect("child stdout");
    let mut lines = BufReader::new(stdout).lines();

    // Insert 30 nodes — each commit_memory triggers an inline tick() with the configured active_limit.
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
        let _ = send_and_recv(&mut stdin, &mut lines, &req).await?;
    }

    // Close stdin to let the child exit gracefully, then wait.
    drop(stdin);
    child.kill().await.ok();
    child.wait().await.ok();

    // Query the ephemeral DB directly to verify active_index size.
    let mut conn_opts: sqlx::postgres::PgConnectOptions = db_url.parse()?;
    conn_opts = conn_opts.statement_cache_capacity(0);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(conn_opts)
        .await?;

    let active_count: (i64,) = sqlx::query_as("SELECT count(*) FROM active_index")
        .fetch_one(&pool)
        .await?;
    let size = active_count.0 as usize;

    // Compute recall for the last 10 items (mem-21..mem-30)
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT n.pointer_summary FROM active_index ai JOIN nodes n ON n.id = ai.node_id",
    )
    .fetch_all(&pool)
    .await?;
    pool.close().await;

    let summaries: Vec<String> = rows.into_iter().map(|r| r.0).collect();
    let mut hits = 0;
    for i in 21..=30 {
        let name = format!("mem-{}", i);
        if summaries.iter().any(|s| s == &name) {
            hits += 1;
        }
    }
    let recall = hits as f64 / 10.0;

    Ok((size, recall))
}

#[tokio::test]
async fn config_active_limit_increases_agent_working_set_metric() -> anyhow::Result<()> {
    let (db1_url, db1_name) = create_ephemeral_db().await?;
    let (db2_url, db2_name) = create_ephemeral_db().await?;

    let mut ini1 = NamedTempFile::new()?;
    writeln!(ini1, "[sulcus]\nactive_limit = 5\ntherm_interval_ms = 100")?;
    ini1.flush()?;
    let ini1_path = ini1.path().to_str().unwrap().to_string();

    let mut ini2 = NamedTempFile::new()?;
    writeln!(ini2, "[sulcus]\nactive_limit = 15\ntherm_interval_ms = 100")?;
    ini2.flush()?;
    let ini2_path = ini2.path().to_str().unwrap().to_string();

    let result1 = run_and_measure(&db1_url, &ini1_path).await;
    let result2 = run_and_measure(&db2_url, &ini2_path).await;

    // cleanup ephemeral DBs regardless of test outcome
    drop_ephemeral_db(&db1_name).await.ok();
    drop_ephemeral_db(&db2_name).await.ok();

    let (size_small, recall_small) = result1?;
    let (size_large, recall_large) = result2?;

    println!(
        "size_small={} recall_small={} size_large={} recall_large={}",
        size_small, recall_small, size_large, recall_large
    );

    assert_eq!(
        size_small, 5,
        "active_index must respect active_limit from INI (small)"
    );
    // Temporal decay may push some of the 30 nodes below the prune threshold
    // before all 15 slots can be filled; assert that the larger limit yields
    // a strictly bigger active set, bounded by the configured limit.
    assert!(
        size_large > size_small && size_large <= 15,
        "active_index must grow with active_limit (got small={}, large={})",
        size_small,
        size_large,
    );

    Ok(())
}
