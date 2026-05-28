//! Sulcus MCP Server.
//!
//! Implements the MCP tool surface using `rmcp` macros.
//! Each method annotated with `#[tool]` becomes a discoverable MCP tool.
//! JSON Schema is auto-generated from the Rust param types via `schemars`.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::{ServerHandler, tool, tool_handler, tool_router};
use serde_json::json;

use crate::client::SulcusClient;
use crate::types::*;

/// The Sulcus MCP server — routes MCP tool calls to the Sulcus API.
#[derive(Clone)]
pub struct SulcusMcp {
    client: SulcusClient,
}

impl SulcusMcp {
    pub fn new(client: SulcusClient) -> Self {
        Self { client }
    }
}

#[tool_router]
impl SulcusMcp {
    // === Core Memory =====================================================

    #[tool(description = "Store a memory in Sulcus. Call this whenever the user shares something that should be remembered across conversations: facts, preferences, decisions, procedures, or events. Choose memory_type to categorize it correctly.")]
    async fn sulcus_remember(
        &self,
        Parameters(params): Parameters<RememberParams>,
    ) -> String {
        match self.client.remember(&params).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "Search memories using hybrid semantic + full-text search. Call this before answering questions that may involve past context, preferences, or known facts.")]
    async fn sulcus_search(
        &self,
        Parameters(params): Parameters<SearchParams>,
    ) -> String {
        match self.client.search(&params).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "List memories with optional filters. Use to browse memories by type, namespace, or pinned status.")]
    async fn sulcus_list(
        &self,
        Parameters(params): Parameters<ListParams>,
    ) -> String {
        match self.client.list(&params).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "Permanently delete a memory by ID. Irreversible. Only call when the user explicitly asks to forget something.")]
    async fn sulcus_forget(
        &self,
        Parameters(params): Parameters<ForgetParams>,
    ) -> String {
        match self.client.forget(&params.memory_id).await {
            Ok(_) => json!({ "deleted": true, "memory_id": params.memory_id }).to_string(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "Update fields on an existing memory. More surgical than forget+re-remember because it preserves history and graph edges.")]
    async fn sulcus_update(
        &self,
        Parameters(params): Parameters<UpdateParams>,
    ) -> String {
        match self.client.update(&params).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    // === Heat ============================================================

    #[tool(description = "Boost a memory's heat to make it surface more prominently in recall.")]
    async fn sulcus_boost(
        &self,
        Parameters(params): Parameters<BoostParams>,
    ) -> String {
        match self.client.boost(&params.memory_id, params.amount).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "Reduce a memory's heat to make it surface less often.")]
    async fn sulcus_deprecate(
        &self,
        Parameters(params): Parameters<DeprecateParams>,
    ) -> String {
        match self.client.deprecate(&params.memory_id, params.amount).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "List the hottest (most active) memories. Shows what's top-of-mind right now.")]
    async fn sulcus_hot_nodes(
        &self,
        Parameters(params): Parameters<HotNodesParams>,
    ) -> String {
        match self.client.hot_nodes(params.limit).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    // === Context =========================================================

    #[tool(description = "Build a token-budgeted context block from relevant memories. Returns formatted text suitable for injection into a system prompt.")]
    async fn sulcus_build_context(
        &self,
        Parameters(params): Parameters<BuildContextParams>,
    ) -> String {
        match self.client.build_context(&params.query, params.token_budget).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "Auto-recall: build a query-aware context block from relevant memories using semantic search + knowledge graph expansion + hot nodes. This is the recommended high-level context-building function.")]
    async fn sulcus_auto_recall(
        &self,
        Parameters(params): Parameters<AutoRecallParams>,
    ) -> String {
        match self.client.auto_recall(&params).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "Auto-capture: classify text through SIU v2 quality gate and store if worthy. Includes junk filtering, quality gating, and automatic memory type assignment. Use for fire-and-forget capture of conversation content.")]
    async fn sulcus_auto_capture(
        &self,
        Parameters(params): Parameters<AutoCaptureParams>,
    ) -> String {
        match self.client.auto_capture(&params.text, &params.source).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    // === Graph ===========================================================

    #[tool(description = "Create a relationship between two memories in the knowledge graph. For example: link a person to a project, or a decision to its rationale.")]
    async fn sulcus_relate(
        &self,
        Parameters(params): Parameters<RelateParams>,
    ) -> String {
        match self.client.relate(&params).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "Traverse the knowledge graph from a starting memory. Returns connected memories and their relationships.")]
    async fn sulcus_graph_traverse(
        &self,
        Parameters(params): Parameters<GraphTraverseParams>,
    ) -> String {
        match self.client.graph_traverse(&params.memory_id, params.depth).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    // === Triggers ========================================================

    #[tool(description = "Create a reactive trigger that fires when memory conditions are met. Events: on_store, on_recall, on_decay, on_boost, on_relate, on_threshold. Actions: notify, boost, pin, tag, deprecate, webhook.")]
    async fn sulcus_create_trigger(
        &self,
        Parameters(params): Parameters<CreateTriggerParams>,
    ) -> String {
        match self.client.create_trigger(&params).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "List all active memory triggers.")]
    async fn sulcus_list_triggers(&self) -> String {
        match self.client.list_triggers().await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "Delete a trigger by ID.")]
    async fn sulcus_delete_trigger(
        &self,
        Parameters(params): Parameters<DeleteTriggerParams>,
    ) -> String {
        match self.client.delete_trigger(&params.trigger_id).await {
            Ok(_) => json!({ "deleted": true, "trigger_id": params.trigger_id }).to_string(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    // === Classification ==================================================

    #[tool(description = "Classify text through the SIU v2 quality gate. Returns whether the text is worth storing as a memory, along with predicted memory type.")]
    async fn sulcus_classify(
        &self,
        Parameters(params): Parameters<ClassifyParams>,
    ) -> String {
        match self.client.classify(&params.text).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[tool(description = "Scan text for personally identifiable information (PII). Detects emails, phone numbers, SSNs, credit cards, IP addresses, and API keys. Returns detected spans and a redacted version.")]
    async fn sulcus_scan_pii(
        &self,
        Parameters(params): Parameters<ScanPiiParams>,
    ) -> String {
        match self.client.scan_pii(&params.text).await {
            Ok(result) => serde_json::to_string_pretty(&result).unwrap_or_default(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    }

    // === Status ==========================================================

    #[tool(description = "Get Sulcus server status including version, memory count, and configuration.")]
    async fn sulcus_status(&self) -> String {
        let server = self.client.status().await.unwrap_or(json!({"error": "unavailable"}));
        let memory = self.client.memory_status().await.unwrap_or(json!({"error": "unavailable"}));
        json!({
            "server": server,
            "memory": memory,
        }).to_string()
    }
}

// Wire up the tool router to the ServerHandler trait
#[tool_handler(router = Self::tool_router())]
impl ServerHandler for SulcusMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some("Sulcus — Thermodynamic Memory for AI Agents. Store, search, and manage persistent memories with heat-based activation, knowledge graph relationships, and reactive triggers.".into()),
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .build(),
            ..ServerInfo::default()
        }
    }
}
