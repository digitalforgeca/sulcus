//! Sulcus Cloud REST API client.
//!
//! Typed HTTP client for the Sulcus Cloud API (`api.sulcus.ca`).
//! Uses `reqwest` with rustls for zero OpenSSL dependency.

use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;

use sulcus_core::*;
use sulcus_core::backend::StorageBackend;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL: &str = "https://api.sulcus.ca";
const DEFAULT_TIMEOUT_SECS: u64 = 30;
const USER_AGENT: &str = concat!("sulcus/", env!("CARGO_PKG_VERSION"));

/// Configuration for the Sulcus cloud client.
#[derive(Debug, Clone)]
pub struct SulcusConfig {
    pub api_key: String,
    pub base_url: String,
    pub namespace: String,
    pub timeout: Duration,
}

impl SulcusConfig {
    /// Create config from environment variables.
    pub fn from_env() -> Result<Self> {
        let api_key = std::env::var("SULCUS_API_KEY")
            .context("SULCUS_API_KEY environment variable is required.\nGet a key at https://sulcus.ca/dashboard/settings")?;

        let base_url = std::env::var("SULCUS_BASE_URL")
            .unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
            .trim_end_matches('/')
            .to_string();

        let namespace = std::env::var("SULCUS_NAMESPACE")
            .unwrap_or_else(|_| "default".to_string());

        Ok(Self {
            api_key,
            base_url,
            namespace,
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
        })
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// HTTP client for the Sulcus Cloud API.
#[derive(Debug, Clone)]
pub struct SulcusClient {
    http: Client,
    config: SulcusConfig,
}

impl SulcusClient {
    /// Create a new client from config.
    pub fn new(config: SulcusConfig) -> Result<Self> {
        let http = Client::builder()
            .timeout(config.timeout)
            .user_agent(USER_AGENT)
            .build()
            .context("Failed to build HTTP client")?;

        Ok(Self { http, config })
    }

    /// Create a new client from environment variables.
    pub fn from_env() -> Result<Self> {
        Self::new(SulcusConfig::from_env()?)
    }

    /// Get the configured namespace.
    pub fn namespace(&self) -> &str {
        &self.config.namespace
    }

    /// Get the configured base URL.
    pub fn base_url(&self) -> &str {
        &self.config.base_url
    }

    // -- Core Memory ------------------------------------------------------

    /// Store a new memory.
    pub async fn remember(&self, params: &RememberParams) -> Result<Value> {
        let heat = params.heat.map(|h| h / 100.0).unwrap_or(0.8);
        let body = json!({
            "label": params.content,
            "memory_type": params.memory_type,
            "heat": heat,
            "namespace": params.namespace.as_deref().unwrap_or(&self.config.namespace),
        });
        self.post("/api/v1/agent/nodes", &body).await
    }

    /// Semantic + full-text search.
    pub async fn search(&self, params: &SearchParams) -> Result<Value> {
        let mut body = json!({
            "query": params.query,
            "limit": params.limit,
        });
        if let Some(ref mt) = params.memory_type {
            body["memory_type"] = json!(mt);
        }
        self.post("/api/v1/agent/search", &body).await
    }

    /// List memories with filters.
    pub async fn list(&self, params: &ListParams) -> Result<Value> {
        let mut url = format!(
            "/api/v1/agent/nodes?page={}&page_size={}&sort=current_heat&order=desc",
            params.page, params.page_size,
        );
        if let Some(ref mt) = params.memory_type {
            url.push_str(&format!("&memory_type={mt}"));
        }
        if let Some(ref ns) = params.namespace {
            url.push_str(&format!("&namespace={ns}"));
        }
        if let Some(pinned) = params.pinned {
            url.push_str(&format!("&pinned={pinned}"));
        }
        self.get(&url).await
    }

    /// Get a single memory by ID.
    pub async fn get_memory(&self, memory_id: &str) -> Result<Memory> {
        let body = self.get(&format!("/api/v1/agent/nodes/{memory_id}")).await?;
        serde_json::from_value(body).context("Failed to parse memory response")
    }

    /// Delete a memory.
    pub async fn forget(&self, memory_id: &str) -> Result<Value> {
        self.delete(&format!("/api/v1/agent/nodes/{memory_id}")).await
    }

    /// Update memory fields.
    pub async fn update(&self, params: &UpdateParams) -> Result<Value> {
        let mut body = json!({});
        if let Some(ref label) = params.label {
            body["label"] = json!(label);
        }
        if let Some(ref mt) = params.memory_type {
            body["memory_type"] = json!(mt);
        }
        if let Some(pinned) = params.is_pinned {
            body["is_pinned"] = json!(pinned);
        }
        if let Some(heat) = params.heat {
            body["current_heat"] = json!(heat / 100.0);
        }
        self.patch(&format!("/api/v1/agent/nodes/{}", params.memory_id), &body)
            .await
    }

    // -- Heat -------------------------------------------------------------

    /// Boost a memory's heat.
    pub async fn boost(&self, memory_id: &str, amount: f64) -> Result<Value> {
        let mem = self.get_memory(memory_id).await?;
        let current = mem.effective_heat() * 100.0;
        let new_heat = (current + amount).min(100.0);
        let body = json!({ "current_heat": new_heat / 100.0 });
        self.patch(&format!("/api/v1/agent/nodes/{memory_id}"), &body).await
    }

    /// Deprecate a memory's heat.
    pub async fn deprecate(&self, memory_id: &str, amount: f64) -> Result<Value> {
        let mem = self.get_memory(memory_id).await?;
        let current = mem.effective_heat() * 100.0;
        let new_heat = (current - amount).max(0.0);
        let body = json!({ "current_heat": new_heat / 100.0 });
        self.patch(&format!("/api/v1/agent/nodes/{memory_id}"), &body).await
    }

    /// List hottest memories.
    pub async fn hot_nodes(&self, limit: u32) -> Result<Value> {
        self.get(&format!("/api/v1/agent/hot_nodes?limit={limit}")).await
    }

    // -- Context ----------------------------------------------------------

    /// Build context from search + hot nodes.
    pub async fn build_context(&self, query: &str, token_budget: u32) -> Result<Value> {
        let search = self.search(&SearchParams {
            query: query.to_string(),
            limit: 10,
            memory_type: None,
        }).await?;
        let hot = self.hot_nodes(5).await?;
        Ok(json!({
            "query": query,
            "token_budget": token_budget,
            "search_results": search,
            "hot_nodes": hot,
        }))
    }

    /// Auto-recall with graph expansion.
    pub async fn auto_recall(&self, params: &AutoRecallParams) -> Result<Value> {
        let context = self.build_context(&params.query, params.token_budget).await?;
        Ok(json!({
            "query": params.query,
            "token_budget": params.token_budget,
            "graph_hops": params.graph_hops,
            "context": context,
        }))
    }

    /// Auto-capture with SIU quality gate.
    pub async fn auto_capture(&self, text: &str, source: &str) -> Result<Value> {
        let classification = self.classify(text).await?;
        let should_store = classification.get("should_store")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if should_store {
            let mt = classification.get("memory_type")
                .and_then(|v| v.as_str())
                .unwrap_or("episodic");
            let mem = self.remember(&RememberParams {
                content: text.to_string(),
                memory_type: mt.to_string(),
                heat: None,
                namespace: None,
            }).await?;
            Ok(json!({
                "action": "stored",
                "memory": mem,
                "classification": classification,
                "source": source,
            }))
        } else {
            Ok(json!({
                "action": "skipped",
                "classification": classification,
                "source": source,
            }))
        }
    }

    // -- Graph ------------------------------------------------------------

    /// Create a relationship between two memories.
    pub async fn relate(&self, params: &RelateParams) -> Result<Value> {
        let body = json!({
            "source_id": params.source_id,
            "target_id": params.target_id,
            "relation": params.relation,
        });
        self.post("/api/v1/agent/graph/relate", &body).await
    }

    /// Traverse the knowledge graph.
    pub async fn graph_traverse(&self, memory_id: &str, depth: u32) -> Result<Value> {
        self.get(&format!("/api/v1/agent/graph/neighbors/{memory_id}?depth={depth}"))
            .await
    }

    // -- Triggers ---------------------------------------------------------

    /// Create a reactive trigger.
    pub async fn create_trigger(&self, params: &CreateTriggerParams) -> Result<Value> {
        let mut body = json!({
            "event": params.event,
            "action": params.action,
        });
        if let Some(ref name) = params.name {
            body["name"] = json!(name);
        }
        if let Some(ref mt) = params.filter_memory_type {
            body["filter_memory_type"] = json!(mt);
        }
        if let Some(ref ns) = params.filter_namespace {
            body["filter_namespace"] = json!(ns);
        }
        if let Some(ref pat) = params.filter_label_pattern {
            body["filter_label_pattern"] = json!(pat);
        }
        self.post("/api/v1/triggers", &body).await
    }

    /// List all triggers.
    pub async fn list_triggers(&self) -> Result<Value> {
        self.get("/api/v1/triggers").await
    }

    /// Delete a trigger.
    pub async fn delete_trigger(&self, trigger_id: &str) -> Result<Value> {
        self.delete(&format!("/api/v1/triggers/{trigger_id}")).await
    }

    // -- Classification ---------------------------------------------------

    /// Classify text through SIU v2.
    pub async fn classify(&self, text: &str) -> Result<Value> {
        self.post("/api/v2/siu/label", &json!({ "text": text })).await
    }

    /// Scan text for PII.
    pub async fn scan_pii(&self, text: &str) -> Result<Value> {
        self.post("/api/v1/agent/scan-pii", &json!({ "text": text })).await
    }

    // -- Status -----------------------------------------------------------

    /// Get server status.
    pub async fn status(&self) -> Result<Value> {
        self.get("/api/v1/status").await
    }

    /// Get memory status.
    pub async fn memory_status(&self) -> Result<Value> {
        self.get("/api/v1/agent/memory/status").await
    }

    // -- HTTP Primitives --------------------------------------------------

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.config.base_url, path)
    }

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.config.api_key)
    }

    async fn get(&self, path: &str) -> Result<Value> {
        let resp = self.http
            .get(self.url(path))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .with_context(|| format!("GET {path}"))?;

        self.handle_response(resp, path).await
    }

    async fn post(&self, path: &str, body: &Value) -> Result<Value> {
        let resp = self.http
            .post(self.url(path))
            .header("Authorization", self.auth_header())
            .json(body)
            .send()
            .await
            .with_context(|| format!("POST {path}"))?;

        self.handle_response(resp, path).await
    }

    async fn patch(&self, path: &str, body: &Value) -> Result<Value> {
        let resp = self.http
            .patch(self.url(path))
            .header("Authorization", self.auth_header())
            .json(body)
            .send()
            .await
            .with_context(|| format!("PATCH {path}"))?;

        self.handle_response(resp, path).await
    }

    async fn delete(&self, path: &str) -> Result<Value> {
        let resp = self.http
            .delete(self.url(path))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .with_context(|| format!("DELETE {path}"))?;

        self.handle_response(resp, path).await
    }

    async fn handle_response(&self, resp: reqwest::Response, path: &str) -> Result<Value> {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            anyhow::bail!(
                "Sulcus API error ({} {}): {}",
                status.as_u16(),
                path,
                body_text
            );
        }

        if body_text.is_empty() {
            return Ok(json!({}));
        }

        serde_json::from_str(&body_text)
            .with_context(|| format!("Failed to parse response from {path}"))
    }
}

// ---------------------------------------------------------------------------
// StorageBackend implementation — delegates to inherent methods
// ---------------------------------------------------------------------------

#[async_trait::async_trait]
impl StorageBackend for SulcusClient {
    async fn remember(&self, params: &RememberParams) -> Result<Value> {
        SulcusClient::remember(self, params).await
    }

    async fn search(&self, params: &SearchParams) -> Result<Value> {
        SulcusClient::search(self, params).await
    }

    async fn list(&self, params: &ListParams) -> Result<Value> {
        SulcusClient::list(self, params).await
    }

    async fn get_memory(&self, memory_id: &str) -> Result<Memory> {
        SulcusClient::get_memory(self, memory_id).await
    }

    async fn forget(&self, memory_id: &str) -> Result<Value> {
        SulcusClient::forget(self, memory_id).await
    }

    async fn update(&self, params: &UpdateParams) -> Result<Value> {
        SulcusClient::update(self, params).await
    }

    async fn boost(&self, memory_id: &str, amount: f64) -> Result<Value> {
        SulcusClient::boost(self, memory_id, amount).await
    }

    async fn deprecate(&self, memory_id: &str, amount: f64) -> Result<Value> {
        SulcusClient::deprecate(self, memory_id, amount).await
    }

    async fn hot_nodes(&self, limit: u32) -> Result<Value> {
        SulcusClient::hot_nodes(self, limit).await
    }

    async fn build_context(&self, query: &str, token_budget: u32) -> Result<Value> {
        SulcusClient::build_context(self, query, token_budget).await
    }

    async fn auto_recall(&self, params: &AutoRecallParams) -> Result<Value> {
        SulcusClient::auto_recall(self, params).await
    }

    async fn auto_capture(&self, text: &str, source: &str) -> Result<Value> {
        SulcusClient::auto_capture(self, text, source).await
    }

    async fn relate(&self, params: &RelateParams) -> Result<Value> {
        SulcusClient::relate(self, params).await
    }

    async fn graph_traverse(&self, memory_id: &str, depth: u32) -> Result<Value> {
        SulcusClient::graph_traverse(self, memory_id, depth).await
    }

    async fn create_trigger(&self, params: &CreateTriggerParams) -> Result<Value> {
        SulcusClient::create_trigger(self, params).await
    }

    async fn list_triggers(&self) -> Result<Value> {
        SulcusClient::list_triggers(self).await
    }

    async fn delete_trigger(&self, trigger_id: &str) -> Result<Value> {
        SulcusClient::delete_trigger(self, trigger_id).await
    }

    async fn classify(&self, text: &str) -> Result<Value> {
        SulcusClient::classify(self, text).await
    }

    async fn scan_pii(&self, text: &str) -> Result<Value> {
        SulcusClient::scan_pii(self, text).await
    }

    async fn status(&self) -> Result<Value> {
        SulcusClient::status(self).await
    }

    async fn memory_status(&self) -> Result<Value> {
        SulcusClient::memory_status(self).await
    }

    fn namespace(&self) -> &str {
        SulcusClient::namespace(self)
    }
}
