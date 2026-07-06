//! Storage backend trait for Sulcus.
//!
//! Both cloud and local backends implement this trait, allowing the CLI
//! and MCP server to work with either backend transparently.

use serde_json::Value;

use crate::types::*;

/// Unified async storage backend interface.
///
/// Implemented by `sulcus-cloud` (REST API) and `sulcus-local` (embedded SQLite).
/// All methods return `serde_json::Value` to match the existing cloud API surface
/// and keep the MCP server layer generic.
#[async_trait::async_trait]
pub trait StorageBackend: Send + Sync {
    // -- Core CRUD --

    /// Store a new memory. Returns the created node as JSON.
    async fn remember(&self, params: &RememberParams) -> anyhow::Result<Value>;

    /// Semantic + full-text search. Returns results array as JSON.
    async fn search(&self, params: &SearchParams) -> anyhow::Result<Value>;

    /// Paginated list of memories. Returns paginated response as JSON.
    async fn list(&self, params: &ListParams) -> anyhow::Result<Value>;

    /// Get a single memory by ID.
    async fn get_memory(&self, memory_id: &str) -> anyhow::Result<Memory>;

    /// Delete a memory by ID.
    async fn forget(&self, memory_id: &str) -> anyhow::Result<Value>;

    /// Update a memory's fields.
    async fn update(&self, params: &UpdateParams) -> anyhow::Result<Value>;

    // -- Heat management --

    /// Boost a memory's heat.
    async fn boost(&self, memory_id: &str, amount: f64) -> anyhow::Result<Value>;

    /// Deprecate (reduce) a memory's heat.
    async fn deprecate(&self, memory_id: &str, amount: f64) -> anyhow::Result<Value>;

    /// List hottest memories.
    async fn hot_nodes(&self, limit: u32) -> anyhow::Result<Value>;

    // -- Advanced --

    /// Build a token-budgeted context block.
    async fn build_context(&self, query: &str, token_budget: u32) -> anyhow::Result<Value>;

    /// Auto-recall with graph expansion.
    async fn auto_recall(&self, params: &AutoRecallParams) -> anyhow::Result<Value>;

    /// Auto-capture with quality gate.
    async fn auto_capture(&self, text: &str, source: &str) -> anyhow::Result<Value>;

    // -- Graph --

    /// Create a relationship between two memories.
    async fn relate(&self, params: &RelateParams) -> anyhow::Result<Value>;

    /// Traverse the knowledge graph from a starting node.
    async fn graph_traverse(&self, memory_id: &str, depth: u32) -> anyhow::Result<Value>;

    // -- Triggers --

    /// Create a reactive trigger.
    async fn create_trigger(&self, params: &CreateTriggerParams) -> anyhow::Result<Value>;

    /// List all triggers.
    async fn list_triggers(&self) -> anyhow::Result<Value>;

    /// Delete a trigger.
    async fn delete_trigger(&self, trigger_id: &str) -> anyhow::Result<Value>;

    // -- Classification & PII --

    /// Classify text via SIU.
    async fn classify(&self, text: &str) -> anyhow::Result<Value>;

    /// Scan text for PII.
    async fn scan_pii(&self, text: &str) -> anyhow::Result<Value>;

    // -- Status --

    /// Backend status / health check.
    async fn status(&self) -> anyhow::Result<Value>;

    /// Memory statistics.
    async fn memory_status(&self) -> anyhow::Result<Value>;

    /// The namespace this backend operates in.
    fn namespace(&self) -> &str;
}
