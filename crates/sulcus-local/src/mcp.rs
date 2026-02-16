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
    pub async fn active_index(&self, limit: usize) -> anyhow::Result<Value> {
        let hot: Vec<sulcus_core::graph::Node> = self.storage.list_hot_nodes(limit).await?;
        Ok(serde_json::to_value(&hot)?)
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
                    "description": "List hot memory nodes",
                    "mcp_method": "resource (memory://active_index)",
                    "cli": "show-active",
                    "params": { "limit": "number" },
                    "returns": { "nodes": "array" }
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
