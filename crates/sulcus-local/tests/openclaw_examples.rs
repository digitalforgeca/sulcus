use std::process::Command;

fn has_cmd(cmd: &str) -> bool {
    std::process::Command::new(cmd)
        .arg("--version")
        .output()
        .is_ok()
}

#[test]
fn node_example_runs() -> anyhow::Result<()> {
    // skip if node/runtime not available
    if !has_cmd("node") {
        eprintln!("node not found; skipping openclaw-node example test");
        return Ok(());
    }

    let sulcus_bin = std::env::var("CARGO_BIN_EXE_sulcus-local").ok().or_else(|| {
        // fallback: workspace target/debug/sulcus-local
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

    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let script = std::path::Path::new(manifest_dir).join("examples/openclaw-node/index.js");

    let out = Command::new("node")
        .arg(script)
        .arg(&sulcus_bin)
        .env("SULCUS_MCP_PORT", "4205")
        .output()?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "node example failed: {}", stdout);
    assert!(
        stdout.contains("OPENCLAW-OK"),
        "expected OPENCLAW-OK in output: {}",
        stdout
    );
    Ok(())
}

#[test]
fn python_example_runs() -> anyhow::Result<()> {
    // skip if python3 not available
    let python_cmd = if has_cmd("python3") {
        "python3"
    } else if has_cmd("python") {
        "python"
    } else {
        eprintln!("python not found; skipping openclaw-python example test");
        return Ok(());
    };

    let sulcus_bin = std::env::var("CARGO_BIN_EXE_sulcus-local").ok().or_else(|| {
        // fallback: workspace target/debug/sulcus-local
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

    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let script =
        std::path::Path::new(manifest_dir).join("examples/openclaw-python/openclaw_client.py");

    let out = Command::new(python_cmd)
        .arg(script)
        .arg(&sulcus_bin)
        .env("SULCUS_MCP_PORT", "4206")
        .output()?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "python example failed: {}", stdout);
    assert!(
        stdout.contains("OPENCLAW-OK"),
        "expected OPENCLAW-OK in output: {}",
        stdout
    );
    Ok(())
}
