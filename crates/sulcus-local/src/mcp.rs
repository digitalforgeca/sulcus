use anyhow::Context;
use serde_json::json;
use serde_json::Value;
use uuid::Uuid;
use chrono::Utc;

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
    pub async fn add_memory(&self, content: &str, _tags: Option<Vec<String>>) -> anyhow::Result<Uuid> {
        let id = Uuid::from_u128(Utc::now().timestamp_nanos() as u128);
        let summary = if content.len() > 200 {
            content[..200].to_string()
        } else {
            content.to_string()
        };

        let node = sulcus_core::graph::Node { id, summary, heat: 100.0 };
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

    /// Process a simple MCP-like JSON request string and return a JSON response string.
    /// Supported methods: `add_memory`, `resource` (memory://active_index)
    pub async fn handle_request(&self, req_json: &str) -> anyhow::Result<String> {
        let v: Value = serde_json::from_str(req_json).context("invalid json")?;
        let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("");
        let method = v.get("method").and_then(|m| m.as_str()).ok_or_else(|| anyhow::anyhow!("missing method"))?;

        match method {
            "add_memory" => {
                let content = v.pointer("/params/content").and_then(|p| p.as_str()).unwrap_or("");
                let node_id = self.add_memory(content, None).await?;
                let res = json!({ "id": id, "result": { "node_id": node_id.to_string() } });
                Ok(res.to_string())
            }
            "resource" => {
                let resource = v.pointer("/params/resource").and_then(|r| r.as_str()).unwrap_or("");
                match resource {
                    "memory://active_index" => {
                        let limit = v.pointer("/params/limit").and_then(|l| l.as_u64()).unwrap_or(20) as usize;
                        let list = self.active_index(limit).await?;
                        let res = json!({ "id": id, "result": list });
                        Ok(res.to_string())
                    }
                    _ => Err(anyhow::anyhow!("unknown resource")),
                }
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
            if line.trim().is_empty() { continue; }
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
