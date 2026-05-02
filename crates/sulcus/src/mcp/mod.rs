use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;

pub mod handlers;
pub mod types;

use types::McpTool;

pub struct McpHandler {
    storage: crate::LocalStorage,
    embedder: Arc<dyn crate::embeddings::EmbeddingProvider>,
    service: McpService,
    active_limit: usize,
    config: crate::config::Config,
}

impl McpHandler {
    pub fn new(
        storage: crate::LocalStorage,
        embedder: Arc<dyn crate::embeddings::EmbeddingProvider>,
        active_limit: usize,
    ) -> Self {
        let config = crate::config::Config::load();
        let service = McpService::new(storage.clone(), active_limit);
        Self {
            storage,
            embedder,
            service,
            active_limit,
            config,
        }
    }

    pub fn storage(&self) -> &crate::LocalStorage {
        &self.storage
    }
    pub fn embedder(&self) -> &dyn crate::embeddings::EmbeddingProvider {
        &*self.embedder
    }
    pub fn active_limit(&self) -> usize {
        self.active_limit
    }
    pub fn config(&self) -> &crate::config::Config {
        &self.config
    }
    /// Effective max node limit (delegates to config).
    pub fn max_nodes(&self) -> usize {
        self.config.effective_max_total_nodes()
    }
    /// Effective auto-purge heat threshold (delegates to config).
    pub fn auto_prune_threshold(&self) -> f32 {
        self.config.effective_auto_purge_threshold()
    }

    pub async fn handle_request(&self, request_json: &str) -> anyhow::Result<String> {
        self.service.handle_request(self, request_json).await
    }

    pub async fn active_index(&self, limit: usize) -> anyhow::Result<Value> {
        self.service.active_index(limit).await
    }

    pub async fn run_stdio_loop(&self) -> anyhow::Result<()> {
        use std::io::{BufRead, Write};
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let resp = match self.handle_request(&line).await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("Error handling request: {}", e);
                    continue;
                }
            };
            if !resp.is_empty() {
                println!("{}", resp);
                std::io::stdout().flush()?;
            }
        }
        Ok(())
    }

    pub fn tool_directory(&self) -> String {
        let mut out = String::from("SULCUS MCP Tools:\n");
        for tool in self.service.tools.values() {
            out.push_str(&format!("  - {}: {}\n", tool.name(), tool.description()));
        }
        out
    }

    pub async fn summarize(&self, text: &str, max_chars: usize) -> anyhow::Result<String> {
        let summary = if text.chars().count() > max_chars {
            format!("{}...", text.chars().take(max_chars).collect::<String>())
        } else {
            text.to_string()
        };
        Ok(summary)
    }
}

pub struct McpService {
    tools: HashMap<String, Box<dyn McpTool>>,
    storage: crate::LocalStorage,
    active_limit: usize,
}

impl McpService {
    pub fn new(storage: crate::LocalStorage, active_limit: usize) -> Self {
        let mut tools: HashMap<String, Box<dyn McpTool>> = HashMap::new();

        // Register implemented tools
        tools.insert("record_memory".to_string(), Box::new(handlers::AddMemory));
        tools.insert("get_node".to_string(), Box::new(handlers::GetNode));
        tools.insert("summarize".to_string(), Box::new(handlers::Summarize));
        tools.insert(
            "search_memory".to_string(),
            Box::new(handlers::SearchMemory),
        );
        tools.insert(
            "search_by_image".to_string(),
            Box::new(handlers::SearchByImage),
        );
        tools.insert(
            "build_context".to_string(),
            Box::new(handlers::BuildContext),
        );
        tools.insert(
            "evaluate_output".to_string(),
            Box::new(handlers::EvaluateOutput),
        );
        tools.insert(
            "commit_memory".to_string(),
            Box::new(handlers::CommitMemory),
        );
        tools.insert("commit_image".to_string(), Box::new(handlers::CommitImage));
        tools.insert(
            "update_memory".to_string(),
            Box::new(handlers::UpdateMemory),
        );
        tools.insert(
            "forget_memory".to_string(),
            Box::new(handlers::ForgetMemory),
        );
        tools.insert(
            "list_hot_nodes".to_string(),
            Box::new(handlers::ListHotNodes),
        );
        tools.insert("tick".to_string(), Box::new(handlers::Tick));
        tools.insert("metrics".to_string(), Box::new(handlers::GetMetrics));
        tools.insert("storage_info".to_string(), Box::new(handlers::StorageInfo));
        tools.insert("sync_now".to_string(), Box::new(handlers::SyncNow));
        tools.insert(
            "list_memory_ops".to_string(),
            Box::new(handlers::ListMemoryOps),
        );
        tools.insert(
            "prune_cold_memories".to_string(),
            Box::new(handlers::PruneColdMemories),
        );
        tools.insert(
            "compact_memory".to_string(),
            Box::new(handlers::CompactMemory),
        );
        tools.insert(
            "upgrade_to_team".to_string(),
            Box::new(handlers::UpgradeToTeam),
        );
        tools.insert(
            "record_memory_op".to_string(),
            Box::new(handlers::RecordMemoryOp),
        );
        tools.insert("page_in".to_string(), Box::new(handlers::PageIn));
        tools.insert("compact_wal".to_string(), Box::new(handlers::CompactWal));
        tools.insert(
            "get_server_cursor".to_string(),
            Box::new(handlers::GetServerCursor),
        );
        tools.insert(
            "set_server_cursor".to_string(),
            Box::new(handlers::SetServerCursor),
        );
        tools.insert("get_last_seq".to_string(), Box::new(handlers::GetLastSeq));
        tools.insert("set_last_seq".to_string(), Box::new(handlers::SetLastSeq));

        // Agent self-modification tools
        tools.insert("memory_boost".to_string(), Box::new(handlers::MemoryBoost));
        tools.insert(
            "memory_deprecate".to_string(),
            Box::new(handlers::MemoryDeprecate),
        );
        tools.insert(
            "memory_relate".to_string(),
            Box::new(handlers::MemoryRelate),
        );
        tools.insert(
            "memory_reclassify".to_string(),
            Box::new(handlers::MemoryReclassify),
        );
        tools.insert(
            "configure_thermodynamics".to_string(),
            Box::new(handlers::ConfigureThermodynamics),
        );

        // Trigger tools — reactive memory system (first-of-kind)
        tools.insert(
            "create_trigger".to_string(),
            Box::new(handlers::CreateTrigger),
        );
        tools.insert(
            "list_triggers".to_string(),
            Box::new(handlers::ListTriggers),
        );
        tools.insert(
            "delete_trigger".to_string(),
            Box::new(handlers::DeleteTrigger),
        );
        tools.insert(
            "update_trigger".to_string(),
            Box::new(handlers::UpdateTrigger),
        );
        tools.insert(
            "trigger_history".to_string(),
            Box::new(handlers::TriggerHistory),
        );

        Self {
            tools,
            storage,
            active_limit,
        }
    }

    pub async fn handle_request(
        &self,
        handler: &McpHandler,
        request_json: &str,
    ) -> anyhow::Result<String> {
        let req: Value = match serde_json::from_str(request_json) {
            Ok(v) => v,
            Err(e) => {
                return Ok(json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": { "code": -32700, "message": format!("Parse error: {}", e) }
                })
                .to_string())
            }
        };
        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");

        let result = match method {
            "initialize" => Some(Ok(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                    "resources": {}
                },
                "serverInfo": {
                    "name": "sulcus",
                    "version": "0.1.0"
                }
            }))),
            "tools/list" => {
                let mut tool_defs = Vec::new();
                for tool in self.tools.values() {
                    tool_defs.push(json!({
                        "name": tool.name(),
                        "description": tool.description(),
                        "inputSchema": tool.input_schema()
                    }));
                }
                Some(Ok(json!({ "tools": tool_defs })))
            }
            "tools/call" => {
                crate::telemetry::record_tool_call();
                let params = req
                    .get("params")
                    .ok_or_else(|| anyhow::anyhow!("missing params"))?;
                let name = params
                    .get("name")
                    .and_then(|n| n.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing tool name"))?;
                let args = params.get("arguments").cloned().unwrap_or(json!({}));

                if let Some(tool) = self.tools.get(name) {
                    match tool.call(handler, args).await {
                        Ok(res) => {
                            let text = if let Some(s) = res.as_str() {
                                s.to_string()
                            } else {
                                serde_json::to_string(&res)?
                            };
                            // For build_context: mark as system-only content via MCP annotations.
                            // The `audience: ["assistant"]` annotation tells MCP clients this
                            // content is for the model's system prompt, not visible to the user.
                            let content_item = if name == "build_context" {
                                json!({
                                    "type": "text",
                                    "text": text,
                                    "annotations": {
                                        "audience": ["assistant"],
                                        "priority": 1.0
                                    }
                                })
                            } else {
                                json!({ "type": "text", "text": text })
                            };
                            Some(Ok(json!({ "content": [content_item] })))
                        }
                        Err(e) => Some(Err(e)),
                    }
                } else {
                    return Ok(json!({ "jsonrpc": "2.0", "id": id.unwrap_or(json!(null)), "error": { "code": -32601, "message": format!("Tool not found: {}", name) } }).to_string());
                }
            }
            "resources/read" => {
                let params = req
                    .get("params")
                    .ok_or_else(|| anyhow::anyhow!("missing params"))?;
                let uri = params.get("uri").and_then(|u| u.as_str()).unwrap_or("");

                if uri == "memory://active_index" {
                    let limit = params.get("limit").and_then(|l| l.as_u64()).unwrap_or(20) as usize;
                    match self.active_index(limit).await {
                        Ok(res) => {
                            let text = if let Some(s) = res.as_str() {
                                s.to_string()
                            } else {
                                serde_json::to_string(&res)?
                            };
                            Some(Ok(json!({ "contents": [{ "uri": uri, "text": text }] })))
                        }
                        Err(e) => Some(Err(e)),
                    }
                } else {
                    return Ok(json!({ "jsonrpc": "2.0", "id": id.unwrap_or(json!(null)), "error": { "code": -32601, "message": "Resource not found" } }).to_string());
                }
            }
            _ => {
                if id.is_some() {
                    return Ok(json!({ "jsonrpc": "2.0", "id": id.unwrap_or(json!(null)), "error": { "code": -32601, "message": "Method not found" } }).to_string());
                } else {
                    None
                }
            }
        };

        if let Some(i) = id {
            match result {
                Some(Ok(res)) => Ok(json!({ "jsonrpc": "2.0", "id": i, "result": res }).to_string()),
                Some(Err(e)) => Ok(json!({ "jsonrpc": "2.0", "id": i, "error": { "code": -32000, "message": e.to_string() } }).to_string()),
                None => Ok(String::new()), // Should not happen for requests with ID
            }
        } else {
            Ok(String::new()) // No response for notifications
        }
    }

    pub async fn active_index(&self, limit: usize) -> anyhow::Result<Value> {
        let limit = limit.min(self.active_limit);
        // Priority 1: in-memory buffer (set by background worker after each tick)
        let json_from_buffer = self.storage.get_active_index_json();
        let mut arr: Vec<serde_json::Value> = if let Some(ref j) = json_from_buffer {
            if !j.is_empty() && j != "[]" {
                serde_json::from_str(j).unwrap_or_default()
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };

        // Priority 2: active_index table (populated by tick_in_tx, most authoritative post-tick)
        if arr.is_empty() {
            let rows = sqlx::query(
                "SELECT n.id, n.label, n.pointer_summary, ai.heat \
                 FROM active_index ai \
                 JOIN nodes n ON n.id = ai.node_id \
                 ORDER BY ai.heat DESC \
                 LIMIT $1",
            )
            .bind(limit as i64)
            .fetch_all(self.storage.pool())
            .await
            .unwrap_or_default();
            arr = rows.into_iter().filter_map(|r| {
                let id_str = r.try_get::<String, _>("id").ok()?;
                let label = r.try_get::<String, _>("label").ok()?;
                let pointer_summary = r.try_get::<String, _>("pointer_summary").ok()?;
                let heat = r.try_get::<f32, _>("heat").ok()?;
                Some(json!({ "id": id_str, "label": label, "pointer_summary": pointer_summary, "heat": heat }))
            }).collect();
        }

        // Priority 3: fallback to nodes table when active_index is empty (pre-first-tick)
        if arr.is_empty() {
            let rows = sqlx::query("SELECT id, label, pointer_summary, current_heat FROM nodes ORDER BY (current_heat + (base_utility * 0.5)) DESC LIMIT $1")
                .bind(limit as i64).fetch_all(self.storage.pool()).await?;
            arr = rows.into_iter().filter_map(|r| {
                let id_str = r.try_get::<String, _>("id").ok()?;
                let label = r.try_get::<String, _>("label").ok()?;
                let pointer_summary = r.try_get::<String, _>("pointer_summary").ok()?;
                let heat = r.try_get::<f32, _>("current_heat").ok()?;
                Some(json!({ "id": id_str, "label": label, "pointer_summary": pointer_summary, "heat": heat }))
            }).collect();
        }
        arr.truncate(limit);
        let tombstone_rows = sqlx::query("SELECT DISTINCT node_id, label, address FROM tombstones ORDER BY evicted_at DESC LIMIT 8")
            .fetch_all(self.storage.pool()).await.unwrap_or_default();
        for r in tombstone_rows {
            let node_id: String = r.try_get("node_id").unwrap_or_default();
            let label: String = r.try_get("label").unwrap_or_default();
            let addr: String = r.try_get("address").unwrap_or_default();
            arr.push(
                json!({ "id": node_id, "label": label, "address": addr, "is_tombstone": true }),
            );
        }
        Ok(json!(arr))
    }
}
