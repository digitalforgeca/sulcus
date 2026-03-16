//! Anonymous telemetry for sulcus-local.
//!
//! Sends periodic heartbeats to the Sulcus cloud server with usage stats.
//! No memory content, no personal data — just instance metadata.
//!
//! Opt out: `SULCUS_TELEMETRY=off` or `--no-telemetry`.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::LocalStorage;

/// Global flag — set to false to disable all telemetry.
static TELEMETRY_ENABLED: AtomicBool = AtomicBool::new(true);

/// Global tool call counter — incremented by MCP handler.
static TOOL_CALLS: AtomicU64 = AtomicU64::new(0);

/// Increment the tool call counter (called from MCP handler).
pub fn record_tool_call() {
    TOOL_CALLS.fetch_add(1, Ordering::Relaxed);
}

/// Disable telemetry globally.
pub fn disable() {
    TELEMETRY_ENABLED.store(false, Ordering::Relaxed);
}

/// Check if telemetry is enabled.
pub fn is_enabled() -> bool {
    TELEMETRY_ENABLED.load(Ordering::Relaxed)
}

/// Check env var and disable if requested.
pub fn init_from_env() {
    if let Ok(val) = std::env::var("SULCUS_TELEMETRY") {
        if val.eq_ignore_ascii_case("off") || val.eq_ignore_ascii_case("false") || val == "0" {
            disable();
            return;
        }
    }
    tracing::info!(
        "Anonymous usage telemetry enabled (helps improve Sulcus). \
         Disable: SULCUS_TELEMETRY=off"
    );
}

#[derive(Debug, Serialize)]
struct TelemetryPayload {
    instance_id: String,
    event: String,
    version: String,
    os: String,
    integration: Option<String>,
    llm_model: Option<String>,
    node_count: Option<i32>,
    edge_count: Option<i32>,
    memory_types: Option<serde_json::Value>,
    tick_mode: Option<String>,
    uptime_hours: f32,
    sync_enabled: bool,
    cloud_tenant: Option<String>,
    mcp_tools_called: i64,
    panel_active: bool,
}

/// Tracks connected MCP client info.
pub struct ClientInfo {
    pub name: Option<String>,
    pub model: Option<String>,
}

/// Shared state for telemetry.
pub struct TelemetryState {
    instance_id: String,
    started_at: Instant,
    storage: LocalStorage,
    client_info: Mutex<ClientInfo>,
    panel_active: AtomicBool,
    server_url: String,
}

impl TelemetryState {
    pub async fn new(storage: LocalStorage, server_url: String) -> Arc<Self> {
        let instance_id = get_or_create_instance_id(&storage).await;
        Arc::new(Self {
            instance_id,
            started_at: Instant::now(),
            storage,
            client_info: Mutex::new(ClientInfo {
                name: None,
                model: None,
            }),
            panel_active: AtomicBool::new(false),
            server_url,
        })
    }

    /// Record MCP client info from the initialize handshake.
    pub async fn set_client_info(&self, name: Option<String>, model: Option<String>) {
        let mut info = self.client_info.lock().await;
        info.name = name;
        info.model = model;
    }

    /// Mark local panel as active.
    pub fn set_panel_active(&self, active: bool) {
        self.panel_active.store(active, Ordering::Relaxed);
    }

    /// Build and send a heartbeat.
    async fn send_heartbeat(&self, event: &str) {
        if !is_enabled() {
            return;
        }

        let uptime = self.started_at.elapsed().as_secs_f32() / 3600.0;
        let client = self.client_info.lock().await;
        let tool_calls = TOOL_CALLS.load(Ordering::Relaxed) as i64;

        // Gather stats from local DB
        let node_count = self.storage.count_nodes().await.ok().map(|n| n as i32);
        let edge_count = self.storage.count_edges().await.ok().map(|n| n as i32);

        // Memory type distribution
        let memory_types = gather_type_distribution(&self.storage).await;

        // Check if cloud sync is configured
        let sync_enabled = self
            .storage
            .get_server_cursor()
            .await
            .ok()
            .flatten()
            .is_some()
            || std::env::var("SULCUS_SYNC_URL").is_ok();

        let payload = TelemetryPayload {
            instance_id: self.instance_id.clone(),
            event: event.to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            os: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
            integration: client.name.clone(),
            llm_model: client.model.clone(),
            node_count,
            edge_count,
            memory_types,
            tick_mode: Some("hybrid".into()),
            uptime_hours: uptime,
            sync_enabled,
            cloud_tenant: std::env::var("SULCUS_TENANT_ID").ok(),
            mcp_tools_called: tool_calls,
            panel_active: self.panel_active.load(Ordering::Relaxed),
        };

        // Fire and forget
        let url = format!("{}/api/v1/telemetry", self.server_url);
        let body = match serde_json::to_vec(&payload) {
            Ok(b) => b,
            Err(_) => return,
        };

        let _ = send_http_post(&url, &body).await;
    }
}

/// Spawn the background heartbeat task.
pub fn spawn_heartbeat(state: Arc<TelemetryState>) {
    if !is_enabled() {
        return;
    }

    tokio::spawn(async move {
        // Initial delay — let the MCP client connect first
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;

        // First heartbeat
        state.send_heartbeat("startup").await;

        // Recurring every 6 hours
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(6 * 3600));
        interval.tick().await; // skip first (already sent)

        loop {
            interval.tick().await;
            if !is_enabled() {
                break;
            }
            state.send_heartbeat("heartbeat").await;
        }
    });
}

/// Get or create a persistent instance ID.
async fn get_or_create_instance_id(storage: &LocalStorage) -> String {
    // Try to read from client_meta table
    let existing: Option<String> =
        sqlx::query_scalar("SELECT value FROM client_meta WHERE key = 'instance_id'")
            .fetch_optional(storage.pool())
            .await
            .ok()
            .flatten();

    if let Some(id) = existing {
        return id;
    }

    // Generate new
    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO client_meta (key, value) VALUES ('instance_id', $1)
         ON CONFLICT (key) DO NOTHING",
    )
    .bind(&id)
    .execute(storage.pool())
    .await;

    id
}

/// Gather memory type counts from the local nodes table.
async fn gather_type_distribution(storage: &LocalStorage) -> Option<serde_json::Value> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT memory_type, COUNT(*) FROM nodes GROUP BY memory_type")
            .fetch_all(storage.pool())
            .await
            .ok()?;

    let mut map = serde_json::Map::new();
    for (t, c) in rows {
        map.insert(t, serde_json::json!(c));
    }
    Some(serde_json::Value::Object(map))
}

/// Minimal HTTP POST — no external deps, uses hyper (already in dep tree).
async fn send_http_post(url: &str, body: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    client
        .post(url)
        .header("Content-Type", "application/json")
        .header(
            "User-Agent",
            format!("sulcus-local/{}", env!("CARGO_PKG_VERSION")),
        )
        .body(body.to_vec())
        .send()
        .await?;

    Ok(())
}
