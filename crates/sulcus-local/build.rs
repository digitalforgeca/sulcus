//! build.rs — SULCUS sulcus-local build script
//!
//! Bundles the OpenClaw JavaScript skills during `cargo build` so the
//! output in `tools/openclaw-integration/dist/` is always in sync with
//! the Rust codebase.
//!
//! # What happens
//!
//! 1. Checks that `node` / `npm` are on PATH.  If not, emits a warning and
//!    skips — native-only builds stay unaffected.
//! 2. Runs `npm install --prefer-offline --no-audit` in the tool directory
//!    if `node_modules` does not yet exist.
//! 3. Runs `npm run build` (→ `node build.mjs` → esbuild) to produce
//!    `dist/context-chunker-skill.mjs` and friends.
//! 4. Declares `rerun-if-changed` on every source `.mjs` and `package.json`
//!    so Cargo only re-triggers when one of those files actually changes.

use std::{path::PathBuf, process::Command};

fn main() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // From crates/sulcus-local/ go up two levels to workspace root, then into tools/
    let tools_dir = manifest.join("../../tools/openclaw-integration");
    let tools_dir = tools_dir.canonicalize().unwrap_or(tools_dir);

    // ── Declare dependency on skill source files ──────────────────────────
    for file in &[
        "context-chunker-skill.mjs",
        "pglite-backend.mjs",
        "openclaw-plugin.mjs",
        "sulcus-management-skill.mjs",
        "build.mjs",
        "package.json",
    ] {
        println!("cargo:rerun-if-changed={}", tools_dir.join(file).display());
    }

    // ── Guard: require node on PATH ───────────────────────────────────────
    if Command::new("node").arg("--version").output().is_err() {
        println!("cargo:warning=`node` not found — OpenClaw skill bundle skipped.");
        return;
    }

    // ── Install npm dependencies if missing ───────────────────────────────
    let node_modules = tools_dir.join("node_modules");
    if !node_modules.exists() {
        println!("cargo:warning=tools/openclaw-integration: running npm install …");
        let status = Command::new("npm")
            .args(["install", "--prefer-offline", "--no-audit", "--no-fund"])
            .current_dir(&tools_dir)
            .status();
        match status {
            Ok(s) if s.success() => {}
            Ok(s) => {
                println!(
                    "cargo:warning=npm install exited with code {:?} — skill bundle skipped.",
                    s.code()
                );
                return;
            }
            Err(e) => {
                println!("cargo:warning=npm install failed: {e} — skill bundle skipped.");
                return;
            }
        }
    }

    // ── Run the esbuild bundle step ───────────────────────────────────────
    let status = Command::new("npm")
        .args(["run", "build", "--silent"])
        .current_dir(&tools_dir)
        .status();

    match status {
        Ok(s) if s.success() => {
            println!("cargo:warning=✓ OpenClaw skills bundled → tools/openclaw-integration/dist/");
        }
        Ok(s) => {
            println!(
                "cargo:warning=npm run build exited {:?} — check tools/openclaw-integration/build.mjs",
                s.code()
            );
        }
        Err(e) => {
            println!("cargo:warning=skill bundle step failed: {e}");
        }
    }
}
