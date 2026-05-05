//! Cross-encoder reranker sidecar client (Task 92)
//!
//! Manages the lifecycle of the Python reranker service
//! (`training/reranker_service.py`) and provides an async
//! `rerank()` call that the search path uses when `use_reranker=true`.
//!
//! Architecture:
//! - On first `rerank()` call (lazy init), spawn the Python service on `127.0.0.1:3091`
//! - Keep the child process handle alive in an `Arc<Mutex<Option<Child>>>`
//! - Subsequent calls hit the running HTTP server directly via reqwest
//! - If the sidecar is unavailable (startup failed, crashed), log a warning
//!   and return `None` so the search path falls back to the fused score
//!
//! The reranker is fully optional — search degrades gracefully if it's down.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};
use tracing::{debug, info, warn};

const SIDECAR_PORT: u16 = 3091;
const SIDECAR_URL: &str = "http://127.0.0.1:3091";
const STARTUP_TIMEOUT_SECS: u64 = 30;
const RERANK_TIMEOUT_SECS: u64 = 10;
const DEFAULT_MODEL: &str = "cross-encoder/ms-marco-MiniLM-L-6-v2";

// ─── Wire types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct RerankRequest {
    query: String,
    candidates: Vec<RerankCandidate>,
}

#[derive(Debug, Serialize)]
struct RerankCandidate {
    id: String,
    text: String,
}

#[derive(Debug, Deserialize)]
struct RerankResponse {
    scores: Vec<RerankScore>,
}

#[derive(Debug, Deserialize)]
pub struct RerankScore {
    pub id: String,
    pub score: f32,
}

// ─── Client ──────────────────────────────────────────────────────────────────

/// Reranker client. Lazily spawns the Python sidecar on first use.
pub struct RerankerClient {
    http: reqwest::Client,
    child: Mutex<Option<Child>>,
    /// Tracks whether we've attempted startup (value = success).
    /// Uses `std::sync::Mutex` + `Option<bool>` for async-compatible lazy init.
    started: Mutex<Option<bool>>,
    script_path: String,
    model: String,
}

impl RerankerClient {
    pub fn new() -> Arc<Self> {
        let script_path = std::env::var("RERANKER_SCRIPT")
            .unwrap_or_else(|_| "/opt/sulcus/training/reranker_service.py".to_string());
        let model = std::env::var("RERANKER_MODEL")
            .unwrap_or_else(|_| DEFAULT_MODEL.to_string());

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(RERANK_TIMEOUT_SECS))
            .build()
            .expect("reqwest client build");

        Arc::new(Self {
            http,
            child: Mutex::new(None),
            started: Mutex::new(None),
            script_path,
            model,
        })
    }

    /// Ensure the Python sidecar is running. Returns true if ready.
    /// Uses a coarse-grained mutex to prevent duplicate spawns.
    async fn ensure_started(&self) -> bool {
        // Fast path: already determined
        {
            let guard = self.started.lock().unwrap();
            if let Some(result) = *guard {
                return result;
            }
        }

        // Slow path: first call, attempt startup
        // Check if already listening (e.g., externally started)
        if self.health_check().await {
            info!("Reranker sidecar already running on port {}", SIDECAR_PORT);
            *self.started.lock().unwrap() = Some(true);
            return true;
        }

        // Check if script exists
        if !std::path::Path::new(&self.script_path).exists() {
            warn!(
                script = %self.script_path,
                "Reranker script not found — cross-encoder disabled. \
                 Set use_reranker=false or provide script at RERANKER_SCRIPT path."
            );
            *self.started.lock().unwrap() = Some(false);
            return false;
        }

        info!(
            script = %self.script_path,
            model = %self.model,
            port = SIDECAR_PORT,
            "Spawning reranker sidecar"
        );

        let child_result = Command::new("python3")
            .arg(&self.script_path)
            .arg("--port")
            .arg(SIDECAR_PORT.to_string())
            .arg("--model")
            .arg(&self.model)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn();

        let mut child = match child_result {
            Ok(c) => c,
            Err(e) => {
                warn!(error = %e, "Failed to spawn reranker sidecar — cross-encoder disabled");
                *self.started.lock().unwrap() = Some(false);
                return false;
            }
        };

        // Wait for "READY\n" on stdout (written by the Python service)
        use tokio::io::AsyncBufReadExt;
        let stdout = child.stdout.take().unwrap();
        let mut reader = tokio::io::BufReader::new(stdout).lines();

        let ready = tokio::time::timeout(
            Duration::from_secs(STARTUP_TIMEOUT_SECS),
            async {
                while let Ok(Some(line)) = reader.next_line().await {
                    if line.trim() == "READY" {
                        return true;
                    }
                }
                false
            },
        )
        .await
        .unwrap_or(false);

        if ready {
            info!("Reranker sidecar ready (port {})", SIDECAR_PORT);
            *self.child.lock().unwrap() = Some(child);
            *self.started.lock().unwrap() = Some(true);
            true
        } else {
            warn!(
                "Reranker sidecar did not signal READY within {}s — cross-encoder disabled",
                STARTUP_TIMEOUT_SECS
            );
            // Kill if it got stuck
            let _ = child.kill().await;
            *self.started.lock().unwrap() = Some(false);
            false
        }
    }

    async fn health_check(&self) -> bool {
        match self
            .http
            .get(format!("{}/health", SIDECAR_URL))
            .timeout(Duration::from_secs(2))
            .send()
            .await
        {
            Ok(r) => r.status().is_success(),
            Err(_) => false,
        }
    }

    /// Rerank `candidates` (id, text pairs) by cross-encoder score for `query`.
    ///
    /// Returns `Some(scores)` sorted descending by cross-encoder score, or
    /// `None` if the reranker is unavailable (caller should use fused score).
    pub async fn rerank(
        &self,
        query: &str,
        candidates: Vec<(String, String)>, // (id, text)
    ) -> Option<Vec<RerankScore>> {
        if candidates.is_empty() {
            return Some(vec![]);
        }

        if !self.ensure_started().await {
            return None;
        }

        let req_body = RerankRequest {
            query: query.to_string(),
            candidates: candidates
                .into_iter()
                .map(|(id, text)| RerankCandidate { id, text })
                .collect(),
        };

        match self
            .http
            .post(format!("{}/rerank", SIDECAR_URL))
            .json(&req_body)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<RerankResponse>().await {
                    Ok(mut r) => {
                        // Sort descending by score so callers can take top-K directly
                        r.scores.sort_by(|a, b| b.score.total_cmp(&a.score));
                        debug!(count = r.scores.len(), "Reranker returned scores");
                        Some(r.scores)
                    }
                    Err(e) => {
                        warn!(error = %e, "Reranker response parse error");
                        None
                    }
                }
            }
            Ok(resp) => {
                warn!(status = %resp.status(), "Reranker returned non-200");
                None
            }
            Err(e) => {
                warn!(error = %e, "Reranker HTTP call failed");
                None
            }
        }
    }
}

impl Drop for RerankerClient {
    fn drop(&mut self) {
        // Best-effort kill on drop — don't block
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.start_kill();
            }
        }
    }
}
