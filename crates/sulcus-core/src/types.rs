//! Sulcus MCP type definitions.
//!
//! These structs serve double duty:
//! 1. Deserialized from MCP tool call arguments
//! 2. Auto-generate JSON Schema via `schemars` for MCP tool discovery
//!
//! The `schemars::JsonSchema` derive generates MCP-compliant schemas
//! from the Rust types — no manual schema maintenance needed.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Tool Input Parameters
// ---------------------------------------------------------------------------

/// Parameters for storing a new memory.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RememberParams {
    /// The text content to store as a memory.
    pub content: String,

    /// Category: 'semantic' = facts/knowledge, 'episodic' = events/history,
    /// 'preference' = user preferences, 'procedural' = step-by-step instructions,
    /// 'synthesis' = AI-generated summaries and distilled insights.
    #[serde(default = "default_memory_type")]
    pub memory_type: String,

    /// Initial activation heat (0.0–100.0). Higher heat = surfaces more often.
    pub heat: Option<f64>,

    /// Optional namespace to scope this memory to (e.g. 'project-alpha').
    pub namespace: Option<String>,
}

/// Parameters for semantic + full-text search.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SearchParams {
    /// Natural language search query.
    pub query: String,

    /// Maximum number of results (1-50).
    #[serde(default = "default_search_limit")]
    pub limit: u32,

    /// Filter by memory type.
    pub memory_type: Option<String>,
}

/// Parameters for listing memories with filters.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ListParams {
    /// Page number (1-indexed).
    #[serde(default = "default_page")]
    pub page: u32,

    /// Results per page (1-100).
    #[serde(default = "default_page_size")]
    pub page_size: u32,

    /// Filter by memory type.
    pub memory_type: Option<String>,

    /// Filter by namespace.
    pub namespace: Option<String>,

    /// Filter by pinned status.
    pub pinned: Option<bool>,
}

/// Parameters for deleting a memory.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ForgetParams {
    /// UUID of the memory to delete.
    pub memory_id: String,
}

/// Parameters for updating a memory's fields.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UpdateParams {
    /// UUID of the memory to update.
    pub memory_id: String,

    /// New content/label text.
    pub label: Option<String>,

    /// New type classification. One of: semantic, episodic, preference, procedural, synthesis.
    pub memory_type: Option<String>,

    /// Pin (prevent decay) or unpin.
    pub is_pinned: Option<bool>,

    /// New heat value (0.0–100.0).
    pub heat: Option<f64>,
}

/// Parameters for boosting a memory's heat.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BoostParams {
    /// UUID of the memory to boost.
    pub memory_id: String,

    /// Heat increase (0.0–100.0). Default: 20.0.
    #[serde(default = "default_heat_amount")]
    pub amount: f64,
}

/// Parameters for deprecating a memory's heat.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DeprecateParams {
    /// UUID of the memory to deprecate.
    pub memory_id: String,

    /// Heat decrease (0.0–100.0). Default: 20.0.
    #[serde(default = "default_heat_amount")]
    pub amount: f64,
}

/// Parameters for listing hottest memories.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct HotNodesParams {
    /// Maximum number of results (1-50). Default: 10.
    #[serde(default = "default_hot_limit")]
    pub limit: u32,
}

/// Parameters for building a token-budgeted context block.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BuildContextParams {
    /// The current task or question.
    pub query: String,

    /// Maximum tokens in the context block (100-10000). Default: 2000.
    #[serde(default = "default_token_budget")]
    pub token_budget: u32,
}

/// Parameters for auto-recall with graph expansion.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AutoRecallParams {
    /// Current task, question, or conversation topic.
    pub query: String,

    /// Maximum tokens in the context block (100-16000). Default: 4000.
    #[serde(default = "default_auto_recall_budget")]
    pub token_budget: u32,

    /// Enable graph-hop expansion from top search results. Default: true.
    #[serde(default = "default_true")]
    pub graph_hops: bool,
}

/// Parameters for auto-capture with SIU quality gate.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AutoCaptureParams {
    /// Text content to evaluate and potentially store.
    pub text: String,

    /// Source label for metadata tracking.
    #[serde(default = "default_source")]
    pub source: String,
}

/// Parameters for creating a graph relationship.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RelateParams {
    /// UUID of the source memory.
    pub source_id: String,

    /// UUID of the target memory.
    pub target_id: String,

    /// Relationship label (e.g. 'authored', 'depends_on').
    pub relation: String,
}

/// Parameters for traversing the knowledge graph.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct GraphTraverseParams {
    /// Starting memory UUID.
    pub memory_id: String,

    /// Max traversal depth (1-5). Default: 2.
    #[serde(default = "default_depth")]
    pub depth: u32,
}

/// Parameters for creating a reactive trigger.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct CreateTriggerParams {
    /// Trigger name.
    pub name: Option<String>,

    /// What fires the trigger: on_store, on_recall, on_decay, on_boost, on_relate, on_threshold.
    pub event: String,

    /// What happens when trigger fires: notify, boost, pin, tag, deprecate, webhook.
    pub action: String,

    /// Only fire for this memory type.
    pub filter_memory_type: Option<String>,

    /// Only fire for this namespace.
    pub filter_namespace: Option<String>,

    /// Regex pattern to match memory content.
    pub filter_label_pattern: Option<String>,
}

/// Parameters for deleting a trigger.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DeleteTriggerParams {
    /// UUID of the trigger to delete.
    pub trigger_id: String,
}

/// Parameters for classifying text through SIU v2.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ClassifyParams {
    /// Text to classify.
    pub text: String,
}

/// Parameters for scanning text for PII.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ScanPiiParams {
    /// Text to scan for personally identifiable information.
    pub text: String,
}

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

/// A memory node from the Sulcus API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    #[serde(alias = "label")]
    pub pointer_summary: Option<String>,
    pub memory_type: Option<String>,
    pub current_heat: Option<f64>,
    pub heat: Option<f64>,
    pub base_utility: Option<f64>,
    pub is_pinned: Option<bool>,
    pub namespace: Option<String>,
}

impl Memory {
    /// Get the effective heat value.
    pub fn effective_heat(&self) -> f64 {
        self.current_heat.or(self.heat).unwrap_or(0.0)
    }
}

/// A search result with relevance score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub node: Memory,
    pub score: f64,
}

/// Paginated list response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResponse {
    pub items: Vec<Memory>,
    pub total: Option<u64>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

fn default_memory_type() -> String {
    "semantic".to_string()
}

fn default_search_limit() -> u32 {
    10
}

fn default_page() -> u32 {
    1
}

fn default_page_size() -> u32 {
    20
}

fn default_heat_amount() -> f64 {
    20.0
}

fn default_hot_limit() -> u32 {
    10
}

fn default_token_budget() -> u32 {
    2000
}

fn default_auto_recall_budget() -> u32 {
    4000
}

fn default_true() -> bool {
    true
}

fn default_source() -> String {
    "mcp-server".to_string()
}

fn default_depth() -> u32 {
    2
}
