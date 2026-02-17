use anyhow::Context;
use chrono::Utc;
use serde_json::json;
use serde_json::Value;
use uuid::Uuid;

use crate::SqliteStorage;
use sulcus_core::StorageBackend;
pub struct McpHandler {
    storage: SqliteStorage,
}

impl McpHandler {
    pub fn new(storage: SqliteStorage) -> Self {
        Self { storage }
    }

    /// Minimal programmatic API for `add_memory` tool.
    /// - creates a Node with `heat = 100.0` and a short `summary`
    /// - upserts node into storage, records a memory_op and updates active_index
    pub async fn add_memory(
        &self,
        content: &str,
        _tags: Option<Vec<String>>,
    ) -> anyhow::Result<Uuid> {
        let id = Uuid::from_u128(Utc::now().timestamp_nanos() as u128);
        let summary = if content.len() > 200 {
            content[..200].to_string()
        } else {
            content.to_string()
        };

        let node = sulcus_core::graph::Node {
            id,
            summary,
            heat: 100.0,
        };
        self.storage.upsert_node(node.clone()).await?;

        let payload = json!({ "id": id.to_string(), "summary": node.summary, "heat": node.heat });
        self.storage.record_memory_op("ADD", &payload).await?;
        self.storage.set_active_index(id, node.heat).await?;

        Ok(id)
    }

    /// Returns the `active_index` as a JSON-friendly array of nodes.
    ///
    /// Previously this returned `list_hot_nodes`. To make `tick` / `active_limit`
    /// deterministic and observable via MCP, we now return nodes from the
    /// `active_index` table (preserving the order inserted by thermodynamics).
    pub async fn active_index(&self, limit: usize) -> anyhow::Result<Value> {
        let entries = self.storage.list_active_index(limit).await?; // Vec<(Uuid, heat)>
        let mut out: Vec<sulcus_core::graph::Node> = Vec::with_capacity(entries.len());
        for (id, heat) in entries.into_iter() {
            if let Some(n) = self.storage.get_node(id).await? {
                out.push(n);
            } else {
                // fallback: construct minimal Node from id + heat
                out.push(sulcus_core::graph::Node {
                    id,
                    summary: String::new(),
                    heat,
                });
            }
        }
        Ok(serde_json::to_value(&out)?)
    }

    /// Generate a short extractive summary using a lightweight heuristic.
    /// This is intentionally simple (first sentence(s) / truncate) so it is
    /// deterministic and safe for local/offline usage.
    pub async fn summarize(&self, text: &str, max_chars: usize) -> anyhow::Result<String> {
        let txt = text.trim();
        if txt.is_empty() {
            return Ok(String::new());
        }

        // Collapse whitespace
        let s = txt.split_whitespace().collect::<Vec<_>>().join(" ");

        // Build summary by taking sentences (split on . ? !) until we reach max_chars
        let mut summary = String::new();
        for part in s
            .split(|c: char| c == '.' || c == '?' || c == '!')
            .map(|p| p.trim())
        {
            if part.is_empty() {
                continue;
            }
            if !summary.is_empty() {
                summary.push_str(". ");
            }
            summary.push_str(part);
            if summary.len() >= max_chars {
                break;
            }
        }

        if summary.is_empty() {
            // fallback: take prefix
            let out = if s.len() <= max_chars {
                s
            } else {
                s[..max_chars].to_string()
            };
            return Ok(out.trim().to_string());
        }

        if summary.len() > max_chars {
            summary.truncate(max_chars);
            if let Some(idx) = summary.rfind(' ') {
                summary.truncate(idx);
            }
            summary.push('…');
        } else {
            // ensure punctuation
            if !summary.ends_with('.') && !summary.ends_with('!') && !summary.ends_with('?') {
                summary.push('.');
            }
        }

        Ok(summary)
    }

    /// Return a machine-readable JSON manifest describing the CLI/MCP tools supported by this sidecar.
    pub async fn describe_tools(&self) -> anyhow::Result<Value> {
        let manifest = json!({
            "name": "sulcus-local",
            "version": env!("CARGO_PKG_VERSION"),
            "tools": [
                {
                    "name": "add_memory",
                    "description": "Record text into Sulcus memory",
                    "mcp_method": "add_memory",
                    "cli": "add-memory <summary> [heat]",
                    "params": { "content": "string", "tags": "string[]" },
                    "returns": { "node_id": "uuid" }
                },
                {
                    "name": "summarize",
                    "description": "Deterministic extractive summary (local, offline)",
                    "mcp_method": "summarize",
                    "cli": "summarize [text|stdin] [max_chars]",
                    "params": { "text": "string", "max_chars": "number" },
                    "returns": { "summary": "string" }
                },
                {
                    "name": "active_index",
                    "description": "List hot memory nodes (active_index)",
                    "mcp_method": "resource (memory://active_index) | active_index",
                    "cli": "show-active",
                    "params": { "limit": "number" },
                    "returns": { "nodes": "array" }
                },
                {
                    "name": "get_node",
                    "description": "Fetch a node by id",
                    "mcp_method": "get_node",
                    "params": { "node_id": "uuid" },
                    "returns": { "node": "object|null" }
                },
                {
                    "name": "upsert_node",
                    "description": "Create or update a node (id required)",
                    "mcp_method": "upsert_node",
                    "params": { "id": "uuid", "summary": "string", "heat": "number" },
                    "returns": { "node_id": "uuid" }
                },
                {
                    "name": "list_hot_nodes",
                    "description": "List nodes ordered by heat",
                    "mcp_method": "list_hot_nodes",
                    "params": { "limit": "number" },
                    "returns": { "nodes": "array" }
                },
                {
                    "name": "tick",
                    "description": "Force a thermodynamics tick (decay/prune/active index rebuild)",
                    "mcp_method": "tick",
                    "params": { "decay": "number", "prune_threshold": "number", "active_limit": "number" },
                    "returns": { "ok": "boolean" }
                },
                {
                    "name": "list_memory_ops",
                    "description": "List recorded memory operations",
                    "mcp_method": "list_memory_ops",
                    "returns": { "ops": "array" }
                },
                {
                    "name": "record_memory_op",
                    "description": "Record a raw memory op (internal use)",
                    "mcp_method": "record_memory_op",
                    "params": { "op_type": "string", "payload": "object" },
                    "returns": { "ok": "boolean" }
                },
                {
                    "name": "set_active_index",
                    "description": "Manually set heat for a node in the active index",
                    "mcp_method": "set_active_index",
                    "params": { "node_id": "uuid", "heat": "number" },
                    "returns": { "ok": "boolean" }
                },
                {
                    "name": "server_cursor",
                    "description": "Get/set sync cursor metadata",
                    "mcp_method": "get_server_cursor | set_server_cursor",
                    "params": { "cursor": "string" },
                    "returns": { "cursor": "string|null" }
                },
                {
                    "name": "last_seq",
                    "description": "Get/set last applied WAL sequence id",
                    "mcp_method": "get_last_seq | set_last_seq",
                    "params": { "seq": "number" },
                    "returns": { "seq": "number|null" }
                },
                {
                    "name": "sync_now",
                    "description": "Trigger a push/pull sync with configured server (requires SULCUS_SERVER_URL)",
                    "mcp_method": "sync_now",
                    "returns": { "ok": "boolean" }
                }
            ]
        });
        Ok(manifest)
    }

    /// Process a simple MCP-like JSON request string and return a JSON response string.
    /// Supported methods: `add_memory`, `resource` (memory://active_index), `summarize`, `describe_tools`
    pub async fn handle_request(&self, req_json: &str) -> anyhow::Result<String> {
        let v: Value = serde_json::from_str(req_json).context("invalid json")?;
        let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("");
        let method = v
            .get("method")
            .and_then(|m| m.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing method"))?;

        match method {
            "add_memory" => {
                let content = v
                    .pointer("/params/content")
                    .and_then(|p| p.as_str())
                    .unwrap_or("");
                let node_id = self.add_memory(content, None).await?;
                let res = json!({ "id": id, "result": { "node_id": node_id.to_string() } });
                Ok(res.to_string())
            }
            "summarize" => {
                let text = v
                    .pointer("/params/text")
                    .and_then(|p| p.as_str())
                    .unwrap_or("");
                let max = v
                    .pointer("/params/max_chars")
                    .and_then(|m| m.as_u64())
                    .unwrap_or(500) as usize;
                let summary = self.summarize(text, max).await?;
                let res = json!({ "id": id, "result": { "summary": summary } });
                Ok(res.to_string())
            }
            "resource" => {
                let resource = v
                    .pointer("/params/resource")
                    .and_then(|r| r.as_str())
                    .unwrap_or("");
                match resource {
                    "memory://active_index" => {
                        let limit = v
                            .pointer("/params/limit")
                            .and_then(|l| l.as_u64())
                            .unwrap_or(20) as usize;
                        let list = self.active_index(limit).await?;
                        let res = json!({ "id": id, "result": list });
                        Ok(res.to_string())
                    }
                    _ => Err(anyhow::anyhow!("unknown resource")),
                }
            }
            "describe_tools" => {
                let manifest = self.describe_tools().await?;
                let res = json!({ "id": id, "result": manifest });
                Ok(res.to_string())
            }
            "get_node" => {
                let node_id_s = v
                    .pointer("/params/node_id")
                    .and_then(|p| p.as_str())
                    .unwrap_or("");
                let node_id = uuid::Uuid::parse_str(node_id_s)?;
                let node = self.storage.get_node(node_id).await?;
                let res = json!({ "id": id, "result": { "node": node } });
                Ok(res.to_string())
            }
            "upsert_node" => {
                let id_s = v
                    .pointer("/params/id")
                    .and_then(|p| p.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing id"))?;
                let summary = v
                    .pointer("/params/summary")
                    .and_then(|p| p.as_str())
                    .unwrap_or("");
                let heat = v
                    .pointer("/params/heat")
                    .and_then(|p| p.as_f64())
                    .unwrap_or(0.0) as f32;
                let node = sulcus_core::graph::Node {
                    id: uuid::Uuid::parse_str(id_s)?,
                    summary: summary.to_string(),
                    heat,
                };
                self.storage.upsert_node(node.clone()).await?;
                let res = json!({ "id": id, "result": { "node_id": node.id.to_string() } });
                Ok(res.to_string())
            }
            "list_hot_nodes" => {
                let limit = v
                    .pointer("/params/limit")
                    .and_then(|l| l.as_u64())
                    .unwrap_or(20) as usize;
                let list = self.storage.list_hot_nodes(limit).await?;
                let res = json!({ "id": id, "result": list });
                Ok(res.to_string())
            }
            "tick" => {
                let decay = v
                    .pointer("/params/decay")
                    .and_then(|p| p.as_f64())
                    .unwrap_or(0.85) as f32;
                let prune_threshold = v
                    .pointer("/params/prune_threshold")
                    .and_then(|p| p.as_f64())
                    .unwrap_or(1.0) as f32;
                let active_limit = v
                    .pointer("/params/active_limit")
                    .and_then(|p| p.as_u64())
                    .unwrap_or(20) as usize;
                crate::tick(&self.storage, decay, prune_threshold, active_limit).await?;
                let res = json!({ "id": id, "result": { "ok": true } });
                Ok(res.to_string())
            }
            "list_memory_ops" => {
                let ops = self.storage.list_memory_ops().await?;
                let res = json!({ "id": id, "result": ops });
                Ok(res.to_string())
            }
            "record_memory_op" => {
                let op_type = v
                    .pointer("/params/op_type")
                    .and_then(|p| p.as_str())
                    .unwrap_or("GEN");
                let payload = v.pointer("/params/payload").cloned().unwrap_or(json!({}));
                self.storage.record_memory_op(op_type, &payload).await?;
                let res = json!({ "id": id, "result": { "ok": true } });
                Ok(res.to_string())
            }
            "set_active_index" => {
                let node_id_s = v
                    .pointer("/params/node_id")
                    .and_then(|p| p.as_str())
                    .unwrap_or("");
                let node_id = uuid::Uuid::parse_str(node_id_s)?;
                let heat = v
                    .pointer("/params/heat")
                    .and_then(|p| p.as_f64())
                    .unwrap_or(0.0) as f32;
                self.storage.set_active_index(node_id, heat).await?;
                let res = json!({ "id": id, "result": { "ok": true } });
                Ok(res.to_string())
            }
            "get_server_cursor" => {
                let cur = self.storage.get_server_cursor().await?;
                let res = json!({ "id": id, "result": { "cursor": cur } });
                Ok(res.to_string())
            }
            "set_server_cursor" => {
                let cur = v.pointer("/params/cursor").and_then(|p| p.as_str());
                self.storage.set_server_cursor(cur).await?;
                let res = json!({ "id": id, "result": { "ok": true } });
                Ok(res.to_string())
            }
            "get_last_seq" => {
                let seq = self.storage.get_last_seq().await?;
                let res = json!({ "id": id, "result": { "seq": seq } });
                Ok(res.to_string())
            }
            "set_last_seq" => {
                let seq = v.pointer("/params/seq").and_then(|p| p.as_i64());
                self.storage.set_last_seq(seq).await?;
                let res = json!({ "id": id, "result": { "ok": true } });
                Ok(res.to_string())
            }
            "sync_now" => {
                // require SULCUS_SERVER_URL to be set (same behavior as CLI)
                let server = std::env::var("SULCUS_SERVER_URL")
                    .map_err(|_| anyhow::anyhow!("SULCUS_SERVER_URL required for sync_now"))?;
                let api_key = std::env::var("SULCUS_API_KEY").ok();
                let engine = crate::sync_http::HttpSyncEngine::new(server, api_key);
                let mut client = crate::LocalSyncClient::new(self.storage.clone());
                client.push_to_engine(&engine).await?;
                client.pull_from_engine_and_apply(&engine, None).await?;
                let res = json!({ "id": id, "result": { "ok": true } });
                Ok(res.to_string())
            }
            _ => Err(anyhow::anyhow!("unknown method")),
        }
    }

    /// Example stdio loop (not used by unit tests). Reads JSON requests line-by-line from stdin
    /// and prints JSON responses to stdout.
    pub async fn run_stdio_loop(&self) -> anyhow::Result<()> {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let stdin = BufReader::new(tokio::io::stdin());
        let mut lines = stdin.lines();
        while let Some(line) = lines.next_line().await? {
            if line.trim().is_empty() {
                continue;
            }
            match self.handle_request(&line).await {
                Ok(resp) => {
                    println!("{}", resp);
                }
                Err(e) => {
                    let err = json!({ "error": e.to_string() });
                    println!("{}", err.to_string());
                }
            }
        }
        Ok(())
    }
}
