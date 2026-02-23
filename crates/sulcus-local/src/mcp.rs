use anyhow::Context;
use base64::Engine as _;
use chrono::Utc;
use serde_json::json;
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::embeddings::EmbeddingProvider;
use crate::SqliteStorage;
use std::sync::Arc;
use sulcus_core::StorageBackend;

pub struct McpHandler {
    storage: SqliteStorage,
    embedder: Arc<dyn EmbeddingProvider>,
}

impl McpHandler {
    /// Requires an injected `EmbeddingProvider` so tests can supply a mock implementation.
    pub fn new(storage: SqliteStorage, embedder: Arc<dyn EmbeddingProvider>) -> Self {
        Self { storage, embedder }
    }

    /// Minimal programmatic API for `add_memory` tool.
    /// - creates a Node with `current_heat = 1.0` and a short `pointer_summary`
    /// - upserts node into storage, records a memory_op and updates active_index
    pub async fn add_memory(
        &self,
        content: &str,
        _tags: Option<Vec<String>>,
    ) -> anyhow::Result<Uuid> {
        let id = Uuid::from_u128(Utc::now().timestamp_nanos() as u128);
        let pointer_summary = if content.len() > 200 {
            content[..200].to_string()
        } else {
            content.to_string()
        };

        let label = pointer_summary
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_string();

        let node = sulcus_core::graph::Node {
            id,
            label,
            pointer_summary: pointer_summary.clone(),
            base_utility: 0.0,
            current_heat: 1.0,
            is_pinned: false,
            memory_type: "episodic".to_string(),
        };
        self.storage.upsert_node(node.clone()).await?;

        let payload = json!({ "id": id.to_string(), "pointer_summary": node.pointer_summary, "current_heat": node.current_heat });
        self.storage.record_memory_op("ADD", &payload).await?;
        self.storage.set_active_index(id, node.current_heat).await?;

        Ok(id)
    }

    /// Returns the `active_index` resource as a JSON string.
    ///
    /// The response merges two sources:
    /// 1. **Hot node pointers** from the zero-copy shared index buffer (rkyv-encoded,
    ///    rebuilt on every thermodynamics tick).
    /// 2. **Tombstone stubs** — `[Paged Out: 0x{addr} {label}]` entries left when
    ///    pages are evicted from session page-tables.  The LLM sees these in its
    ///    context window and knows the exact address to page back in.
    ///
    /// Use `memory://active_index.bin` for the zero-copy binary form that can be
    /// mmap'd without deserialization.
    pub async fn active_index(&self, limit: usize) -> anyhow::Result<Value> {
        // ── Hot nodes from shared zero-copy buffer ──────────────────────────────
        let json_from_buffer = self.storage.get_active_index_json();
        let mut arr: Vec<serde_json::Value> = if !json_from_buffer.is_empty()
            && json_from_buffer != "[]"
        {
            serde_json::from_str(&json_from_buffer).unwrap_or_default()
        } else {
            // Cold start fallback: query directly and re-populate the buffer.
            let rows = sqlx::query(
                "SELECT id, label, pointer_summary, current_heat FROM nodes \
                 ORDER BY (current_heat + (base_utility * 0.5)) DESC LIMIT ?",
            )
            .bind(limit as i64)
            .fetch_all(self.storage.pool())
            .await?;

            rows.into_iter()
                .filter_map(|r| {
                    let id_str = r.try_get::<String, _>("id").ok()?;
                    let label = r.try_get::<String, _>("label").ok()?;
                    let pointer_summary = r.try_get::<String, _>("pointer_summary").ok()?;
                    let heat = r.try_get::<f32, _>("current_heat").ok()?;
                    Some(serde_json::json!({ "id": id_str, "label": label, "pointer_summary": pointer_summary, "heat": heat }))
                })
                .collect()
        };

        // Clamp to `limit` entries (buffer may hold more than requested)
        arr.truncate(limit);

        // ── Tombstone stubs ────────────────────────────────────────────────────
        // Append the most recently evicted tombstones.  The LLM sees these as
        // compact pointer stubs in its context window:
        //   { "is_tombstone": true, "address": "[Paged Out: 0x4A2F user prefs]" }
        let tombstone_rows = sqlx::query(
            "SELECT DISTINCT page_id, label, address FROM tombstones \
             ORDER BY evicted_at DESC LIMIT 8",
        )
        .fetch_all(self.storage.pool())
        .await
        .unwrap_or_default();

        for r in tombstone_rows {
            let page_id: String = r.try_get("page_id").unwrap_or_default();
            let label: String = r.try_get("label").unwrap_or_default();
            let address: String = r.try_get("address").unwrap_or_default();
            arr.push(serde_json::json!({
                "id": page_id,
                "label": label,
                "is_tombstone": true,
                "address": address
            }));
        }

        Ok(Value::String(serde_json::to_string(&arr)?))
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
        // Return a manifest compatible with MCP/tooling. Use JSON Schema for inputs.
        let tools = json!([
            {
                "name": "record_memory",
                "description": "Record text into Sulcus memory and assign to a Fold",
                "mcp_method": "record_memory",
                "cli": "record-memory <content> --fold <name>",
                "inputSchema": { "type": "object", "properties": { "content": { "type": "string" }, "fold_name": { "type": "string" } } },
                "returns": { "node_id": "uuid" }
            },
            {
                "name": "switch_fold",
                "description": "Activate a named Fold as the working set (rebuilds active_index)",
                "mcp_method": "switch_fold",
                "inputSchema": { "type": "object", "properties": { "fold_name": { "type": "string" }, "limit": { "type": "number" } } },
                "returns": { "ok": "boolean" }
            },
            {
                "name": "query_memory",
                "description": "Brute-force semantic search against local embeddings (optionally scoped to a Fold)",
                "mcp_method": "query_memory",
                "inputSchema": { "type": "object", "properties": { "query": { "type": "string" }, "limit": { "type": "number" }, "fold_name": { "type": "string" } } },
                "returns": { "results": "array" }
            },
            {
                "name": "export_fold",
                "description": "Export a named Fold to disk as JSON",
                "mcp_method": "export_fold",
                "inputSchema": { "type": "object", "properties": { "fold_name": { "type": "string" }, "file_path": { "type": "string" } } },
                "returns": { "path": "string" }
            },
            {
                "name": "import_fold",
                "description": "Import a Fold JSON file into local storage",
                "mcp_method": "import_fold",
                "inputSchema": { "type": "object", "properties": { "file_path": { "type": "string" } } },
                "returns": { "ok": "boolean" }
            },
            {
                "name": "export_markdown",
                "description": "Export memory nodes as portable Markdown. Provide fold_name to export a single Fold, or omit to export the entire graph ordered by heat. Vectors are excluded and will be re-embedded on import.",
                "mcp_method": "export_markdown",
                "inputSchema": { "type": "object", "required": ["file_path"], "properties": { "file_path": { "type": "string", "description": "Destination .md file path" }, "fold_name": { "type": "string", "description": "Optional: export only nodes in this fold" } } },
                "returns": { "path": "string", "node_count": "number" }
            },
            {
                "name": "import_markdown",
                "description": "Import a SULCUS Markdown file created by export_markdown. Upserts nodes, payloads, and edges. Vectors are not restored and will be re-embedded on next use.",
                "mcp_method": "import_markdown",
                "inputSchema": { "type": "object", "required": ["file_path"], "properties": { "file_path": { "type": "string", "description": "Path to the .md file to import" } } },
                "returns": { "imported": "number" }
            },
            {
                "name": "active_index",
                "description": "List hot memory nodes (active_index)",
                "mcp_method": "resource (memory://active_index) | active_index",
                "cli": "show-active",
                "inputSchema": { "type": "object", "properties": { "limit": { "type": "number" } } },
                "returns": { "nodes": "array" }
            },
            {
                "name": "get_node",
                "description": "Fetch a node by id",
                "mcp_method": "get_node",
                "inputSchema": { "type": "object", "properties": { "node_id": { "type": "string", "format": "uuid" } } },
                "returns": { "node": "object|null" }
            },
            {
                "name": "upsert_node",
                "description": "Create or update a node (id required)",
                "mcp_method": "upsert_node",
                "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "format": "uuid" }, "label": { "type": "string" }, "pointer_summary": { "type": "string" }, "current_heat": { "type": "number" }, "base_utility": { "type": "number" }, "is_pinned": { "type": "boolean" } } },
                "returns": { "node_id": "uuid" }
            },
            {
                "name": "list_hot_nodes",
                "description": "List nodes ordered by subjective importance (score)",
                "mcp_method": "list_hot_nodes",
                "inputSchema": { "type": "object", "properties": { "limit": { "type": "number" } } },
                "returns": { "nodes": "array" }
            },
            {
                "name": "fetch_payload",
                "description": "Fetch raw payload for a node (reinforces utility + ignites heat)",
                "mcp_method": "fetch_payload",
                "inputSchema": { "type": "object", "properties": { "node_id": { "type": "string", "format": "uuid" } } },
                "returns": { "raw_content": "string" }
            },
            {
                "name": "commit_memory",
                "description": "Create node + payload + edges in one atomic operation",
                "mcp_method": "commit_memory",
                "inputSchema": { "type": "object", "properties": { "label": { "type": "string" }, "pointer_summary": { "type": "string" }, "raw_content": { "type": "string" }, "connected_node_ids": { "type": "array", "items": { "type": "string", "format": "uuid" } } } },
                "returns": { "node_id": "uuid" }
            },
            {
                "name": "ignite_and_tick",
                "description": "Embed prompt, ignite nearest nodes, then run thermodynamics tick",
                "mcp_method": "ignite_and_tick",
                "inputSchema": { "type": "object", "properties": { "prompt": { "type": "string" } } },
                "returns": { "active_index": "string" }
            },

            {
                "name": "list_memory_ops",
                "description": "List recorded memory operations",
                "mcp_method": "list_memory_ops",
                "inputSchema": { "type": "object", "properties": {} },
                "returns": { "ops": "array" }
            },
            {
                "name": "record_memory_op",
                "description": "Record a raw memory op (internal use)",
                "mcp_method": "record_memory_op",
                "inputSchema": { "type": "object", "properties": { "op_type": { "type": "string" }, "payload": { "type": "object" } } },
                "returns": { "ok": "boolean" }
            },
            {
                "name": "set_active_index",
                "description": "Manually set heat for a node in the active index",
                "mcp_method": "set_active_index",
                "inputSchema": { "type": "object", "properties": { "node_id": { "type": "string", "format": "uuid" }, "heat": { "type": "number" } } },
                "returns": { "ok": "boolean" }
            },
            {
                "name": "server_cursor",
                "description": "Get/set sync cursor metadata",
                "mcp_method": "get_server_cursor | set_server_cursor",
                "inputSchema": { "type": "object", "properties": { "cursor": { "type": "string" } } },
                "returns": { "cursor": "string|null" }
            },
            {
                "name": "last_seq",
                "description": "Get/set last applied WAL sequence id",
                "mcp_method": "get_last_seq | set_last_seq",
                "inputSchema": { "type": "object", "properties": { "seq": { "type": "number" } } },
                "returns": { "seq": "number|null" }
            },

            {
                "name": "metrics",
                "description": "Runtime and storage metrics useful to OpenClaw (active_index size, db size, counts)",
                "mcp_method": "metrics",
                "inputSchema": { "type": "object", "properties": {} },
                "returns": { "metrics": "object" }
            },

            {
                "name": "dispatch_background_task",
                "description": "Fire-and-forget Sulcus management task. Returns immediately with a task_id; the task runs in a background tokio thread without blocking the agent. Use this as a self-dispatch primitive so OpenClaw can subagent itself for maintenance without stalling its primary context. Available tasks: \"tick\" (thermodynamics decay + active_index rebuild), \"prune_cold_nodes\" (delete nodes below heat threshold), \"sync\" (push/pull to server if SULCUS_SERVER_URL is set), \"full_maintenance\" (tick + prune + sync in sequence).",
                "mcp_method": "tools/call",
                "inputSchema": {
                    "type": "object",
                    "required": ["task"],
                    "properties": {
                        "task": {
                            "type": "string",
                            "enum": ["tick", "prune_cold_nodes", "sync", "full_maintenance"]
                        },
                        "args": {
                            "type": "object",
                            "description": "Optional task-specific arguments. tick: {decay, prune_threshold, active_limit}. prune_cold_nodes: {threshold}. full_maintenance: {decay}.",
                            "properties": {
                                "decay": { "type": "number" },
                                "prune_threshold": { "type": "number" },
                                "active_limit": { "type": "number" },
                                "threshold": { "type": "number" }
                            }
                        }
                    }
                },
                "returns": { "task_id": "string", "status": "\"dispatched\"", "task": "string" }
            },

            {
                "name": "forget_memory",
                "description": "Permanently delete a node and all its edges, embeddings, and payload. Set purge_cold=true to also remove the cold_storage archive.",
                "mcp_method": "tools/call",
                "inputSchema": {
                    "type": "object",
                    "required": ["node_id"],
                    "properties": {
                        "node_id": { "type": "string", "format": "uuid" },
                        "purge_cold": { "type": "boolean", "description": "Also delete cold_storage entry (default false)" }
                    }
                },
                "returns": { "ok": "boolean" }
            },
            {
                "name": "update_memory",
                "description": "Patch an existing node's label, pointer_summary, raw_content, and/or memory_type. Re-embeds if content changes. Resets current_heat to 1.0.",
                "mcp_method": "tools/call",
                "inputSchema": {
                    "type": "object",
                    "required": ["node_id"],
                    "properties": {
                        "node_id": { "type": "string", "format": "uuid" },
                        "label": { "type": "string" },
                        "pointer_summary": { "type": "string" },
                        "raw_content": { "type": "string" },
                        "memory_type": { "type": "string", "enum": ["episodic", "semantic", "preference", "procedural"] }
                    }
                },
                "returns": { "ok": "boolean", "node_id": "uuid" }
            },
            {
                "name": "pin_node",
                "description": "Pin a node so it is never pruned by the thermodynamics decay engine.",
                "mcp_method": "tools/call",
                "inputSchema": {
                    "type": "object",
                    "required": ["node_id"],
                    "properties": { "node_id": { "type": "string", "format": "uuid" } }
                },
                "returns": { "ok": "boolean" }
            },
            {
                "name": "unpin_node",
                "description": "Unpin a node so it becomes eligible for thermodynamic decay and pruning.",
                "mcp_method": "tools/call",
                "inputSchema": {
                    "type": "object",
                    "required": ["node_id"],
                    "properties": { "node_id": { "type": "string", "format": "uuid" } }
                },
                "returns": { "ok": "boolean" }
            },
            {
                "name": "search_memory",
                "description": "Hybrid semantic search: combines cosine similarity (vector embeddings, weight 0.6) with BM25 full-text search (nodes_fts FTS5 index, weight 0.4). Optionally filter by memory_type.",
                "mcp_method": "tools/call",
                "inputSchema": {
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": { "type": "string" },
                        "limit": { "type": "number", "default": 10 },
                        "memory_type": { "type": "string", "enum": ["episodic", "semantic", "preference", "procedural"] }
                    }
                },
                "returns": { "results": "array" }
            },
            {
                "name": "build_context",
                "description": "Run ignite+tick for the given prompt, then render hot nodes as a structured XML context block partitioned by memory_type (preferences/facts/procedures/recent) with tombstone stubs. Feed this XML directly into your system prompt.",
                "mcp_method": "tools/call",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "prompt": { "type": "string", "description": "Current user prompt used to ignite relevant nodes" },
                        "token_budget": { "type": "number", "default": 2000, "description": "Approximate token budget for the context block" }
                    }
                },
                "returns": { "context": "string (XML)", "token_estimate": "number" }
            },
            {
                "name": "retire_edge",
                "description": "Soft-delete an edge by setting its valid_to timestamp. Retired edges stop conducting heat in spreading activation.",
                "mcp_method": "tools/call",
                "inputSchema": {
                    "type": "object",
                    "required": ["source_id", "target_id"],
                    "properties": {
                        "source_id": { "type": "string", "format": "uuid" },
                        "target_id": { "type": "string", "format": "uuid" }
                    }
                },
                "returns": { "ok": "boolean" }
            },
            {
                "name": "retract_memory",
                "description": "Soft-retract a node: retire all its edges (valid_to=now) and zero out heat+utility. The node tombstone remains for audit. Use forget_memory for hard delete.",
                "mcp_method": "tools/call",
                "inputSchema": {
                    "type": "object",
                    "required": ["node_id"],
                    "properties": { "node_id": { "type": "string", "format": "uuid" } }
                },
                "returns": { "ok": "boolean" }
            }
        ]);
        Ok(json!({ "name": "sulcus-local", "version": env!("CARGO_PKG_VERSION"), "tools": tools }))
    }

    /// Process a JSON-RPC 2.0 MCP request and return a JSON-RPC 2.0 response string.
    /// New surface: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`.
    pub async fn handle_request(&self, req_json: &str) -> anyhow::Result<String> {
        let v: Value = serde_json::from_str(req_json).context("invalid json")?;

        // JSON-RPC 2.0 is preferred but we accept bare JSON messages too (e.g. the e2e test
        // and direct tool invocations that omit the `jsonrpc` envelope).
        if let Some(jsonrpc) = v.get("jsonrpc").and_then(|x| x.as_str()) {
            if jsonrpc != "2.0" {
                return Err(anyhow::anyhow!("unsupported jsonrpc version: {}", jsonrpc));
            }
        }
        // `id` may be missing in notifications; default to null.
        let id_val = v.get("id").cloned().unwrap_or(Value::Null);
        // alias so outer match arms can use either name
        let id = id_val.clone();

        let method = v
            .get("method")
            .and_then(|m| m.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing method"))?;

        match method {
            "initialize" => {
                let res = json!({
                    "jsonrpc": "2.0",
                    "id": id_val,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": { "tools": {}, "resources": {} },
                        "serverInfo": { "name": "sulcus-local", "version": "0.1.0" }
                    }
                });
                return Ok(res.to_string());
            }

            "tools/list" => {
                let manifest = self.describe_tools().await?; // returns { name, version, tools: [...] }
                let tools = manifest.get("tools").cloned().unwrap_or(json!([]));
                let res = json!({ "jsonrpc": "2.0", "id": id_val, "result": { "tools": tools } });
                return Ok(res.to_string());
            }

            "tools/call" => {
                // params: { name: "tool_name", arguments: { ... } }
                let name = v
                    .pointer("/params/name")
                    .and_then(|n| n.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing tool name"))?;
                let args = v.pointer("/params/arguments").cloned().unwrap_or(json!({}));

                // Execute the mapped tool and return the *stringified* inner result inside MCP `content`.
                let inner_result = match name {
                    "add_memory" => {
                        let content = args.get("content").and_then(|c| c.as_str()).unwrap_or("");
                        let node_id = self.add_memory(content, None).await?;
                        json!({ "node_id": node_id.to_string() })
                    }
                    "summarize" => {
                        let text = args.get("text").and_then(|t| t.as_str()).unwrap_or("");
                        let max = args
                            .get("max_chars")
                            .and_then(|m| m.as_u64())
                            .unwrap_or(500) as usize;
                        let summary = self.summarize(text, max).await?;
                        json!({ "summary": summary })
                    }
                    "upsert_node" => {
                        let id_s = args
                            .get("id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing id"))?;
                        let label = args.get("label").and_then(|x| x.as_str()).unwrap_or("");
                        let pointer_summary = args
                            .get("pointer_summary")
                            .and_then(|x| x.as_str())
                            .unwrap_or("");
                        let current_heat = args
                            .get("current_heat")
                            .and_then(|x| x.as_f64())
                            .unwrap_or(0.0) as f32;
                        let base_utility = args
                            .get("base_utility")
                            .and_then(|x| x.as_f64())
                            .unwrap_or(0.0) as f32;
                        let is_pinned = args
                            .get("is_pinned")
                            .and_then(|x| x.as_bool())
                            .unwrap_or(false);
                        let memory_type = args
                            .get("memory_type")
                            .and_then(|x| x.as_str())
                            .unwrap_or("episodic")
                            .to_string();
                        let node = sulcus_core::graph::Node {
                            id: uuid::Uuid::parse_str(id_s)?,
                            label: label.to_string(),
                            pointer_summary: pointer_summary.to_string(),
                            base_utility,
                            current_heat,
                            is_pinned,
                            memory_type,
                        };
                        self.storage.upsert_node(node.clone()).await?;
                        json!({ "node_id": node.id.to_string() })
                    }
                    "get_node" => {
                        let node_id_s = args
                            .get("node_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                        let node_id = uuid::Uuid::parse_str(node_id_s)?;
                        let node = self.storage.get_node(node_id).await?;
                        json!({ "node": node })
                    }
                    "list_hot_nodes" => {
                        let limit =
                            args.get("limit").and_then(|l| l.as_u64()).unwrap_or(20) as usize;
                        let list = self.storage.list_hot_nodes(limit).await?;
                        json!(list)
                    }
                    "fetch_payload" => {
                        let node_id_s = args
                            .get("node_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                        let node_id = uuid::Uuid::parse_str(node_id_s)?;
                        let mut tx = self.storage.pool().begin().await?;
                        let payload_row =
                            sqlx::query("SELECT raw_content FROM payloads WHERE node_id = ?")
                                .bind(node_id.to_string())
                                .fetch_optional(&mut *tx)
                                .await?;
                        let raw = if let Some(r) = payload_row {
                            let s: String = r.try_get("raw_content")?;
                            sqlx::query("UPDATE nodes SET base_utility = CASE WHEN base_utility + 0.15 > 1.0 THEN 1.0 ELSE base_utility + 0.15 END, current_heat = 1.0 WHERE id = ?")
                                .bind(node_id.to_string())
                                .execute(&mut *tx)
                                .await?;
                            sqlx::query(r#"INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                                 ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP"#)
                                .bind(node_id.to_string())
                                .bind(1.0f32)
                                .execute(&mut *tx)
                                .await?;
                            Some(s)
                        } else {
                            None
                        };
                        tx.commit().await?;
                        let _ = crate::tick(&self.storage, 0.85, 1.0, 20).await;
                        json!({ "raw_content": raw })
                    }
                    "commit_memory" => {
                        let label = args.get("label").and_then(|x| x.as_str()).unwrap_or("");
                        let pointer_summary = args
                            .get("pointer_summary")
                            .and_then(|x| x.as_str())
                            .unwrap_or("");
                        let raw_content = args
                            .get("raw_content")
                            .and_then(|x| x.as_str())
                            .unwrap_or("");
                        let connected = args
                            .get("connected_node_ids")
                            .and_then(|x| x.as_array())
                            .cloned()
                            .unwrap_or_default();
                        let memory_type = args
                            .get("memory_type")
                            .and_then(|x| x.as_str())
                            .unwrap_or("episodic");
                        let id = Uuid::from_u128(Utc::now().timestamp_nanos() as u128);
                        let mut tx = self.storage.pool().begin().await?;
                        sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                             ON CONFLICT(id) DO UPDATE SET label = excluded.label, pointer_summary = excluded.pointer_summary, base_utility = excluded.base_utility, current_heat = excluded.current_heat, is_pinned = excluded.is_pinned, memory_type = excluded.memory_type"#)
                            .bind(id.to_string())
                            .bind(label)
                            .bind(pointer_summary)
                            .bind(0.0f32)
                            .bind(1.0f32)
                            .bind(0i64)
                            .bind(memory_type)
                            .execute(&mut *tx)
                            .await?;
                        if !raw_content.is_empty() {
                            sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET raw_content = excluded.raw_content")
                                .bind(id.to_string())
                                .bind(raw_content)
                                .execute(&mut *tx)
                                .await?;
                        }
                        let embedding = match self.embedder.embed(&pointer_summary) {
                            Ok(e) => e,
                            Err(e) => {
                                tracing::warn!(error = %e, "embedding generation failed - continuing without vec_nodes insert");
                                Vec::new()
                            }
                        };
                        if !embedding.is_empty() {
                            // store vector as native f32 bytes in `embeddings` BLOB column
                            let blob: Vec<u8> = bytemuck::cast_slice(&embedding).to_vec();
                            let _ = sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET vector = excluded.vector")
                                .bind(id.to_string())
                                .bind(blob)
                                .execute(&mut *tx)
                                .await
                                .ok();
                        }
                        for x in connected
                            .into_iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        {
                            if let Ok(uuid) = uuid::Uuid::parse_str(&x) {
                                sqlx::query("INSERT INTO edges (source_id, target_id, relationship_type, edge_weight) VALUES (?, ?, ?, ?) ON CONFLICT(source_id, target_id) DO UPDATE SET relationship_type = excluded.relationship_type, edge_weight = excluded.edge_weight")
                                    .bind(id.to_string())
                                    .bind(uuid.to_string())
                                    .bind("semantic")
                                    .bind(0.5f32)
                                    .execute(&mut *tx)
                                    .await?;
                            }
                        }
                        let payload_json = json!({ "id": id.to_string(), "label": label, "pointer_summary": pointer_summary });
                        sqlx::query(r#"INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                             ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP"#)
                            .bind(id.to_string())
                            .bind(1.0f32)
                            .execute(&mut *tx)
                            .await?;
                        tx.commit().await?;
                        // Record WAL op AFTER commit to avoid deadlock with max_connections(1) pool
                        self.storage
                            .record_memory_op("COMMIT", &payload_json)
                            .await?;
                        let _ = crate::tick(&self.storage, 0.85, 1.0, 20).await;
                        json!({ "node_id": id.to_string() })
                    }
                    "ignite_and_tick" => {
                        let prompt = args.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
                        if !prompt.is_empty() {
                            match self.embedder.embed(prompt) {
                                Ok(emb) => {
                                    let _ =
                                        crate::thermodynamics::ignite(&self.storage, &emb, 3).await;
                                }
                                Err(e) => {
                                    tracing::warn!(error = %e, "embedding failed for ignite_and_tick")
                                }
                            }
                        }
                        let _ = crate::tick(&self.storage, 0.85, 1.0, 20).await;
                        let active = self.active_index(20).await?;
                        json!(active)
                    }
                    "record_memory" => {
                        let content = args.get("content").and_then(|c| c.as_str()).unwrap_or("");
                        let fold_name = args
                            .get("fold_name")
                            .and_then(|f| f.as_str())
                            .unwrap_or("default");

                        // create node
                        let id = uuid::Uuid::from_u128(Utc::now().timestamp_nanos() as u128);
                        let pointer_summary = if content.len() > 200 {
                            content[..200].to_string()
                        } else {
                            content.to_string()
                        };
                        let label = pointer_summary
                            .split_whitespace()
                            .next()
                            .unwrap_or("")
                            .to_string();

                        let mut tx = self.storage.pool().begin().await?;
                        sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                             ON CONFLICT(id) DO UPDATE SET label = excluded.label, pointer_summary = excluded.pointer_summary, base_utility = excluded.base_utility, current_heat = excluded.current_heat, is_pinned = excluded.is_pinned, memory_type = excluded.memory_type"#)
                            .bind(id.to_string())
                            .bind(&label)
                            .bind(&pointer_summary)
                            .bind(0.0f32)
                            .bind(1.0f32)
                            .bind(0i64)
                            .bind("episodic")
                            .execute(&mut *tx)
                            .await?;

                        sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET raw_content = excluded.raw_content")
                            .bind(id.to_string())
                            .bind(content)
                            .execute(&mut *tx)
                            .await?;

                        // embed and store vector
                        let embedding = match self.embedder.embed(content) {
                            Ok(e) => e,
                            Err(e) => {
                                tracing::warn!(error = %e, "embedding failed for record_memory");
                                Vec::new()
                            }
                        };
                        if !embedding.is_empty() {
                            let blob: Vec<u8> = bytemuck::cast_slice(&embedding).to_vec();
                            sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET vector = excluded.vector")
                                .bind(id.to_string())
                                .bind(blob)
                                .execute(&mut *tx)
                                .await?;
                        }

                        // ensure fold exists
                        let fold_row = sqlx::query("SELECT id FROM folds WHERE name = ?")
                            .bind(fold_name)
                            .fetch_optional(&mut *tx)
                            .await?;
                        let fold_id = if let Some(r) = fold_row {
                            r.try_get::<String, _>("id")?
                        } else {
                            let nid = uuid::Uuid::new_v4().to_string();
                            sqlx::query("INSERT INTO folds (id, name) VALUES (?, ?)")
                                .bind(&nid)
                                .bind(fold_name)
                                .execute(&mut *tx)
                                .await?;
                            nid
                        };

                        // add node to fold
                        sqlx::query("INSERT INTO node_folds (node_id, fold_id) VALUES (?, ?) ON CONFLICT(node_id, fold_id) DO NOTHING")
                            .bind(id.to_string())
                            .bind(&fold_id)
                            .execute(&mut *tx)
                            .await?;

                        // update active_index
                        sqlx::query(r#"INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                             ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP"#)
                            .bind(id.to_string())
                            .bind(1.0f32)
                            .execute(&mut *tx)
                            .await?;

                        tx.commit().await?;
                        json!({ "node_id": id.to_string() })
                    }
                    "switch_fold" => {
                        let fold_name = args
                            .get("fold_name")
                            .and_then(|f| f.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing fold_name"))?;
                        let limit =
                            args.get("limit").and_then(|l| l.as_u64()).unwrap_or(20) as usize;

                        // find fold id
                        let row = sqlx::query("SELECT id FROM folds WHERE name = ?")
                            .bind(fold_name)
                            .fetch_optional(self.storage.pool())
                            .await?;
                        let fold_id = if let Some(r) = row {
                            r.try_get::<String, _>("id")?
                        } else {
                            return Err(anyhow::anyhow!("fold not found"));
                        };

                        // clear active_index then populate from nodes in fold ordered by score
                        let mut tx = self.storage.pool().begin().await?;
                        sqlx::query("DELETE FROM active_index")
                            .execute(&mut *tx)
                            .await?;
                        let rows = sqlx::query("SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.base_utility FROM nodes n JOIN node_folds nf ON nf.node_id = n.id WHERE nf.fold_id = ? ORDER BY (n.current_heat + (n.base_utility * 0.5)) DESC LIMIT ?")
                            .bind(&fold_id)
                            .bind(limit as i64)
                            .fetch_all(&mut *tx)
                            .await?;
                        let mut arr: Vec<serde_json::Value> = Vec::with_capacity(rows.len());
                        for r in rows.iter() {
                            let id_s: String = r.try_get("id")?;
                            let label: String = r.try_get("label")?;
                            let pointer_summary: String = r.try_get("pointer_summary")?;
                            let current_heat: f32 = r.try_get("current_heat")?;
                            arr.push(serde_json::json!({ "id": id_s.clone(), "label": label, "pointer_summary": pointer_summary }));
                            sqlx::query(r#"INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP"#)
                                .bind(id_s)
                                .bind(current_heat)
                                .execute(&mut *tx)
                                .await?;
                        }
                        let minified = serde_json::to_string(&arr)?;
                        self.storage.set_active_index_json(minified);
                        tx.commit().await?;
                        json!({ "ok": true })
                    }
                    "query_memory" => {
                        let q = args.get("query").and_then(|x| x.as_str()).unwrap_or("");
                        let limit =
                            args.get("limit").and_then(|l| l.as_u64()).unwrap_or(10) as usize;
                        let fold_filter = args.get("fold_name").and_then(|f| f.as_str());

                        let q_emb = self.embedder.embed(q)?;
                        if q_emb.is_empty() {
                            json!({ "results": [] })
                        } else {
                            // build SQL to fetch node rows + vector optionally scoped to a fold
                            let rows = if let Some(fold_name) = fold_filter {
                                sqlx::query("SELECT n.id, n.label, n.pointer_summary, p.raw_content, e.vector FROM nodes n JOIN embeddings e ON e.node_id = n.id LEFT JOIN payloads p ON p.node_id = n.id JOIN node_folds nf ON nf.node_id = n.id JOIN folds f ON f.id = nf.fold_id WHERE f.name = ?")
                                    .bind(fold_name)
                                    .fetch_all(self.storage.pool())
                                    .await?
                            } else {
                                sqlx::query("SELECT n.id, n.label, n.pointer_summary, p.raw_content, e.vector FROM nodes n JOIN embeddings e ON e.node_id = n.id LEFT JOIN payloads p ON p.node_id = n.id")
                                    .fetch_all(self.storage.pool())
                                    .await?
                            };

                            let mut candidates: Vec<serde_json::Value> = Vec::new();
                            for r in rows.into_iter() {
                                let id_s: String = r.try_get("id")?;
                                let label: String = r.try_get("label")?;
                                let pointer_summary: String = r.try_get("pointer_summary")?;
                                let raw_content: Option<String> = r.try_get("raw_content").ok();
                                let vec_blob: Vec<u8> = match r.try_get("vector") {
                                    Ok(b) => b,
                                    Err(_) => continue,
                                };
                                if vec_blob.len() % 4 != 0 {
                                    continue;
                                }
                                let vec_f: &[f32] = bytemuck::cast_slice(&vec_blob);
                                if vec_f.len() != q_emb.len() {
                                    continue;
                                }
                                let dot: f32 =
                                    q_emb.iter().zip(vec_f.iter()).map(|(a, b)| a * b).sum();
                                let na: f32 = q_emb.iter().map(|v| v * v).sum::<f32>().sqrt();
                                let nb: f32 = vec_f.iter().map(|v| v * v).sum::<f32>().sqrt();
                                if na == 0.0 || nb == 0.0 {
                                    continue;
                                }
                                let sim = (dot / (na * nb)).clamp(-1.0, 1.0);
                                candidates.push(serde_json::json!({ "id": id_s, "label": label, "pointer_summary": pointer_summary, "raw_content": raw_content, "score": sim }));
                            }

                            // sort by score desc and take top `limit`
                            candidates.sort_by(|a, b| {
                                b.get("score")
                                    .and_then(|s| s.as_f64())
                                    .partial_cmp(&a.get("score").and_then(|s| s.as_f64()))
                                    .unwrap_or(std::cmp::Ordering::Equal)
                            });
                            let out = candidates.into_iter().take(limit).collect::<Vec<_>>();
                            json!({ "results": out })
                        }
                    }
                    "export_fold" => {
                        let fold_name = args
                            .get("fold_name")
                            .and_then(|f| f.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing fold_name"))?;
                        let file_path = args
                            .get("file_path")
                            .and_then(|p| p.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing file_path"))?;
                        crate::folds::export_fold(&self.storage, fold_name, file_path).await?;
                        json!({ "path": file_path })
                    }
                    "import_fold" => {
                        let file_path = args
                            .get("file_path")
                            .and_then(|p| p.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing file_path"))?;
                        crate::folds::import_fold(&self.storage, file_path).await?;
                        json!({ "ok": true })
                    }
                    "export_markdown" => {
                        let file_path = args
                            .get("file_path")
                            .and_then(|p| p.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing file_path"))?;
                        let fold_name = args.get("fold_name").and_then(|f| f.as_str());
                        let node_count =
                            crate::folds::export_markdown(&self.storage, file_path, fold_name)
                                .await?;
                        json!({ "path": file_path, "node_count": node_count })
                    }
                    "import_markdown" => {
                        let file_path = args
                            .get("file_path")
                            .and_then(|p| p.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing file_path"))?;
                        let imported =
                            crate::folds::import_markdown(&self.storage, file_path).await?;
                        json!({ "imported": imported })
                    }
                    "list_memory_ops" => {
                        let ops = self.storage.list_memory_ops().await?;
                        json!(ops)
                    }
                    "record_memory_op" => {
                        let op_type = args
                            .get("op_type")
                            .and_then(|p| p.as_str())
                            .unwrap_or("GEN");
                        let payload = args.get("payload").cloned().unwrap_or(json!({}));
                        self.storage.record_memory_op(op_type, &payload).await?;
                        json!({ "ok": true })
                    }
                    "set_active_index" => {
                        let node_id_s = args
                            .get("node_id")
                            .and_then(|p| p.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                        let node_id = uuid::Uuid::parse_str(node_id_s)?;
                        let heat = args.get("heat").and_then(|p| p.as_f64()).unwrap_or(0.0) as f32;
                        self.storage.set_active_index(node_id, heat).await?;
                        json!({ "ok": true })
                    }
                    "get_server_cursor" => {
                        let cur = self.storage.get_server_cursor().await?;
                        json!({ "cursor": cur })
                    }
                    "set_server_cursor" => {
                        let cur = args.get("cursor").and_then(|p| p.as_str());
                        self.storage.set_server_cursor(cur).await?;
                        json!({ "ok": true })
                    }
                    "get_last_seq" => {
                        let seq = self.storage.get_last_seq().await?;
                        json!({ "seq": seq })
                    }
                    "set_last_seq" => {
                        let seq = args.get("seq").and_then(|p| p.as_i64());
                        self.storage.set_last_seq(seq).await?;
                        json!({ "ok": true })
                    }
                    "metrics" => {
                        let active_index = self.storage.list_active_index(1000).await?;
                        let active_index_size = active_index.len();
                        let num_nodes = self.storage.count_nodes().await?;
                        let memory_ops_count = self.storage.memory_ops_count().await?;
                        let db_size_bytes = self
                            .storage
                            .db_file_size()
                            .await
                            .ok()
                            .flatten()
                            .unwrap_or(0);
                        let last_seq = self.storage.get_last_seq().await?;
                        let server_cursor_seq = self.storage.get_server_cursor_seq().await?;
                        let metrics = json!({
                            "active_index_size": active_index_size,
                            "num_nodes": num_nodes,
                            "memory_ops_count": memory_ops_count,
                            "db_size_bytes": db_size_bytes,
                            "last_seq": last_seq,
                            "server_cursor_seq": server_cursor_seq
                        });
                        json!(metrics)
                    }
                    "sync_now" => {
                        let server = std::env::var("SULCUS_SERVER_URL").map_err(|_| {
                            anyhow::anyhow!("SULCUS_SERVER_URL required for sync_now")
                        })?;
                        let api_key = std::env::var("SULCUS_API_KEY").ok();
                        let engine = crate::sync_http::HttpSyncEngine::new(server, api_key);
                        let mut client = crate::LocalSyncClient::new(self.storage.clone());
                        client.push_to_engine(&engine).await?;
                        client.pull_from_engine_and_apply(&engine, None).await?;
                        json!({ "ok": true })
                    }

                    "tick" => {
                        let decay =
                            args.get("decay").and_then(|x| x.as_f64()).unwrap_or(0.85) as f32;
                        let prune = args
                            .get("prune_threshold")
                            .and_then(|x| x.as_f64())
                            .unwrap_or(0.0) as f32;
                        let limit = args
                            .get("active_limit")
                            .and_then(|x| x.as_u64())
                            .unwrap_or(20) as usize;
                        crate::tick(&self.storage, decay, prune, limit).await?;
                        json!({ "ok": true })
                    }

                    // ── Subagent self-dispatch ──────────────────────────────────────────
                    // Returns immediately; the requested task runs in a detached tokio task.
                    // The caller (OpenClaw skill) uses the returned task_id for logging only;
                    // there is no blocking status-poll mechanism by design — fire & forget.
                    "dispatch_background_task" => {
                        let task_name = args
                            .get("task")
                            .and_then(|t| t.as_str())
                            .ok_or_else(|| {
                                anyhow::anyhow!("dispatch_background_task: missing \"task\" field")
                            })?
                            .to_string();
                        let task_args = args.get("args").cloned().unwrap_or(json!({}));
                        let task_id = Uuid::new_v4();
                        let task_id_str = task_id.to_string();

                        // Clone the storage handle — cheap (wraps Arc<Pool>)
                        let storage_bg = self.storage.clone();
                        let tid = task_id;

                        match task_name.as_str() {
                            "tick" => {
                                let decay = task_args
                                    .get("decay")
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(0.85)
                                    as f32;
                                let prune_threshold = task_args
                                    .get("prune_threshold")
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(0.0)
                                    as f32;
                                let active_limit = task_args
                                    .get("active_limit")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(20)
                                    as usize;
                                tokio::spawn(async move {
                                    let _ = crate::tick(
                                        &storage_bg,
                                        decay,
                                        prune_threshold,
                                        active_limit,
                                    )
                                    .await;
                                    tracing::info!(task_id = %tid, task = "tick", "background task complete");
                                });
                            }
                            "prune_cold_nodes" => {
                                let threshold = task_args
                                    .get("threshold")
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(0.05)
                                    as f32;
                                tokio::spawn(async move {
                                    let _ = sqlx::query(
                                        "DELETE FROM nodes WHERE current_heat < ? AND is_pinned = 0",
                                    )
                                    .bind(threshold)
                                    .execute(storage_bg.pool())
                                    .await;
                                    tracing::info!(task_id = %tid, task = "prune_cold_nodes", "background task complete");
                                });
                            }
                            "sync" => {
                                tokio::spawn(async move {
                                    match std::env::var("SULCUS_SERVER_URL") {
                                        Ok(server) => {
                                            let api_key = std::env::var("SULCUS_API_KEY").ok();
                                            let engine = crate::sync_http::HttpSyncEngine::new(
                                                server, api_key,
                                            );
                                            let mut client =
                                                crate::LocalSyncClient::new(storage_bg);
                                            let _ = client.push_to_engine(&engine).await;
                                            let _ = client
                                                .pull_from_engine_and_apply(&engine, None)
                                                .await;
                                            tracing::info!(task_id = %tid, task = "sync", "background task complete");
                                        }
                                        Err(_) => {
                                            tracing::warn!(task_id = %tid, task = "sync", "skipped: SULCUS_SERVER_URL not set");
                                        }
                                    }
                                });
                            }
                            "full_maintenance" => {
                                let decay = task_args
                                    .get("decay")
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(0.85)
                                    as f32;
                                tokio::spawn(async move {
                                    // 1) thermodynamics tick
                                    let _ = crate::tick(&storage_bg, decay, 1.0, 20).await;
                                    // 2) evict nodes that have fully decayed
                                    let _ = sqlx::query(
                                        "DELETE FROM nodes WHERE current_heat < 0.05 AND is_pinned = 0",
                                    )
                                    .execute(storage_bg.pool())
                                    .await;
                                    // 3) push/pull if server is configured
                                    if let Ok(server) = std::env::var("SULCUS_SERVER_URL") {
                                        let api_key = std::env::var("SULCUS_API_KEY").ok();
                                        let engine =
                                            crate::sync_http::HttpSyncEngine::new(server, api_key);
                                        let mut client = crate::LocalSyncClient::new(storage_bg);
                                        let _ = client.push_to_engine(&engine).await;
                                        let _ =
                                            client.pull_from_engine_and_apply(&engine, None).await;
                                    }
                                    tracing::info!(task_id = %tid, task = "full_maintenance", "background task complete");
                                });
                            }
                            unknown => {
                                return Err(anyhow::anyhow!(
                                    "dispatch_background_task: unknown task type '{}'",
                                    unknown
                                ));
                            }
                        }

                        json!({ "task_id": task_id_str, "status": "dispatched", "task": task_name })
                    }

                    // ── forget_memory ──────────────────────────────────────────────────────
                    "forget_memory" => {
                        let node_id_s = args
                            .get("node_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                        let node_id = uuid::Uuid::parse_str(node_id_s)?;
                        let purge_cold = args
                            .get("purge_cold")
                            .and_then(|x| x.as_bool())
                            .unwrap_or(false);
                        let mut tx = self.storage.pool().begin().await?;
                        // cascade: edges, active_index, node_folds, embeddings, payloads, then node
                        sqlx::query("DELETE FROM edges WHERE source_id = ? OR target_id = ?")
                            .bind(node_id.to_string())
                            .bind(node_id.to_string())
                            .execute(&mut *tx)
                            .await?;
                        sqlx::query("DELETE FROM active_index WHERE node_id = ?")
                            .bind(node_id.to_string())
                            .execute(&mut *tx)
                            .await?;
                        sqlx::query("DELETE FROM node_folds WHERE node_id = ?")
                            .bind(node_id.to_string())
                            .execute(&mut *tx)
                            .await?;
                        sqlx::query("DELETE FROM embeddings WHERE node_id = ?")
                            .bind(node_id.to_string())
                            .execute(&mut *tx)
                            .await?;
                        sqlx::query("DELETE FROM payloads WHERE node_id = ?")
                            .bind(node_id.to_string())
                            .execute(&mut *tx)
                            .await?;
                        if purge_cold {
                            sqlx::query("DELETE FROM cold_storage WHERE node_id = ?")
                                .bind(node_id.to_string())
                                .execute(&mut *tx)
                                .await?;
                        }
                        sqlx::query("DELETE FROM nodes WHERE id = ?")
                            .bind(node_id.to_string())
                            .execute(&mut *tx)
                            .await?;
                        tx.commit().await?;
                        let payload =
                            json!({ "node_id": node_id.to_string(), "purge_cold": purge_cold });
                        self.storage.record_memory_op("FORGET", &payload).await?;
                        json!({ "ok": true })
                    }

                    // ── update_memory ──────────────────────────────────────────────────────
                    "update_memory" => {
                        let node_id_s = args
                            .get("node_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                        let node_id = uuid::Uuid::parse_str(node_id_s)?;
                        let new_label = args.get("label").and_then(|x| x.as_str());
                        let new_pointer_summary =
                            args.get("pointer_summary").and_then(|x| x.as_str());
                        let new_raw_content = args.get("raw_content").and_then(|x| x.as_str());
                        let new_memory_type = args.get("memory_type").and_then(|x| x.as_str());

                        let mut tx = self.storage.pool().begin().await?;
                        // Patch only provided fields; set heat to 1.0 (re-ignite on update)
                        sqlx::query(
                            r#"UPDATE nodes SET
                            label = COALESCE(?, label),
                            pointer_summary = COALESCE(?, pointer_summary),
                            memory_type = COALESCE(?, memory_type),
                            current_heat = 1.0,
                            updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?"#,
                        )
                        .bind(new_label)
                        .bind(new_pointer_summary)
                        .bind(new_memory_type)
                        .bind(node_id.to_string())
                        .execute(&mut *tx)
                        .await?;
                        if let Some(content) = new_raw_content {
                            sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET raw_content = excluded.raw_content")
                                .bind(node_id.to_string()).bind(content)
                                .execute(&mut *tx).await?;
                            // re-embed with updated content
                            let embed_target = new_pointer_summary.unwrap_or(content);
                            match self.embedder.embed(embed_target) {
                                Ok(emb) if !emb.is_empty() => {
                                    let blob: Vec<u8> = bytemuck::cast_slice(&emb).to_vec();
                                    let _ = sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET vector = excluded.vector")
                                        .bind(node_id.to_string()).bind(blob)
                                        .execute(&mut *tx).await;
                                }
                                Err(e) => {
                                    tracing::warn!(error = %e, "re-embed failed for update_memory")
                                }
                                _ => {}
                            }
                        }
                        sqlx::query(r#"INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, 1.0, CURRENT_TIMESTAMP)
                            ON CONFLICT(node_id) DO UPDATE SET heat = 1.0, updated_at = CURRENT_TIMESTAMP"#)
                            .bind(node_id.to_string()).execute(&mut *tx).await?;
                        tx.commit().await?;
                        let payload = json!({ "node_id": node_id.to_string() });
                        self.storage.record_memory_op("UPDATE", &payload).await?;
                        json!({ "ok": true, "node_id": node_id.to_string() })
                    }

                    // ── pin_node ───────────────────────────────────────────────────────────
                    "pin_node" => {
                        let node_id_s = args
                            .get("node_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                        let node_id = uuid::Uuid::parse_str(node_id_s)?;
                        sqlx::query("UPDATE nodes SET is_pinned = 1 WHERE id = ?")
                            .bind(node_id.to_string())
                            .execute(self.storage.pool())
                            .await?;
                        json!({ "ok": true })
                    }

                    // ── unpin_node ─────────────────────────────────────────────────────────
                    "unpin_node" => {
                        let node_id_s = args
                            .get("node_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                        let node_id = uuid::Uuid::parse_str(node_id_s)?;
                        sqlx::query("UPDATE nodes SET is_pinned = 0 WHERE id = ?")
                            .bind(node_id.to_string())
                            .execute(self.storage.pool())
                            .await?;
                        json!({ "ok": true })
                    }

                    // ── search_memory (hybrid FTS5 + cosine) ───────────────────────────────
                    "search_memory" => {
                        let q = args.get("query").and_then(|x| x.as_str()).unwrap_or("");
                        let limit =
                            args.get("limit").and_then(|l| l.as_u64()).unwrap_or(10) as usize;
                        let type_filter = args.get("memory_type").and_then(|x| x.as_str());

                        // --- vector lane ---
                        let q_emb = self.embedder.embed(q).unwrap_or_default();
                        let vec_rows = sqlx::query(
                            "SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.memory_type, e.vector \
                             FROM nodes n JOIN embeddings e ON e.node_id = n.id",
                        )
                        .fetch_all(self.storage.pool()).await?;

                        let mut scores: std::collections::HashMap<
                            String,
                            (f64, f64, String, String, f32),
                        > = std::collections::HashMap::new();

                        if !q_emb.is_empty() {
                            for r in &vec_rows {
                                let id_s: String = r.try_get("id")?;
                                let label: String = r.try_get("label")?;
                                let ps: String = r.try_get("pointer_summary")?;
                                let heat: f32 = r.try_get("current_heat")?;
                                let mtype: String = r.try_get("memory_type")?;
                                if let Some(f) = type_filter {
                                    if mtype != f {
                                        continue;
                                    }
                                }
                                let blob: Vec<u8> = r.try_get("vector").unwrap_or_default();
                                if blob.len() % 4 != 0 || blob.is_empty() {
                                    continue;
                                }
                                let vf: &[f32] = bytemuck::cast_slice(&blob);
                                if vf.len() != q_emb.len() {
                                    continue;
                                }
                                let dot: f32 =
                                    q_emb.iter().zip(vf.iter()).map(|(a, b)| a * b).sum();
                                let na: f32 = q_emb.iter().map(|v| v * v).sum::<f32>().sqrt();
                                let nb: f32 = vf.iter().map(|v| v * v).sum::<f32>().sqrt();
                                if na == 0.0 || nb == 0.0 {
                                    continue;
                                }
                                let cos = (dot / (na * nb)).clamp(-1.0, 1.0) as f64;
                                scores.insert(id_s, (cos * 0.6, 0.0, label, ps, heat));
                            }
                        }

                        // --- FTS5 lane ---
                        let fts_rows = sqlx::query(
                            "SELECT node_id, bm25(nodes_fts) AS rank FROM nodes_fts WHERE nodes_fts MATCH ? ORDER BY rank LIMIT 50",
                        )
                        .bind(q)
                        .fetch_all(self.storage.pool()).await
                        .unwrap_or_default();

                        for r in &fts_rows {
                            let id_s: String = r.try_get("node_id")?;
                            let rank: f64 = r.try_get::<f64, _>("rank").unwrap_or(0.0);
                            // bm25 returns negative; normalise to [0,1]
                            let fts_score = (-rank).min(10.0) / 10.0;
                            scores
                                .entry(id_s.clone())
                                .and_modify(|e| e.1 = fts_score * 0.4)
                                .or_insert_with(|| {
                                    // need node metadata for FTS-only hits
                                    (
                                        0.0f64,
                                        fts_score * 0.4,
                                        String::new(),
                                        String::new(),
                                        0.0f32,
                                    )
                                });
                        }

                        let mut results: Vec<serde_json::Value> = scores.into_iter().filter_map(|(id_s, (cos, fts, label, ps, heat))| {
                            let combined = cos + fts;
                            if combined <= 0.0 { return None; }
                            Some(json!({ "id": id_s, "label": label, "pointer_summary": ps, "heat": heat, "score": combined }))
                        }).collect();
                        results.sort_by(|a, b| {
                            b["score"]
                                .as_f64()
                                .partial_cmp(&a["score"].as_f64())
                                .unwrap_or(std::cmp::Ordering::Equal)
                        });
                        results.truncate(limit);
                        json!({ "results": results })
                    }

                    // ── build_context (structured XML for LLM injection) ───────────────────
                    "build_context" => {
                        let prompt = args.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
                        let token_budget = args
                            .get("token_budget")
                            .and_then(|t| t.as_u64())
                            .unwrap_or(2000) as usize;

                        // Ignite relevant nodes if a prompt is provided
                        if !prompt.is_empty() {
                            if let Ok(emb) = self.embedder.embed(prompt) {
                                let _ = crate::thermodynamics::ignite(&self.storage, &emb, 5).await;
                            }
                        }
                        let _ = crate::tick(&self.storage, 0.85, 1.0, 30).await;

                        // Fetch hot nodes with metadata
                        let rows = sqlx::query(
                            "SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.memory_type, n.created_at, p.raw_content \
                             FROM nodes n \
                             JOIN active_index ai ON ai.node_id = n.id \
                             LEFT JOIN payloads p ON p.node_id = n.id \
                             ORDER BY ai.heat DESC LIMIT 30",
                        )
                        .fetch_all(self.storage.pool()).await?;

                        // Bucket by memory_type
                        let mut prefs: Vec<String> = Vec::new();
                        let mut facts: Vec<String> = Vec::new();
                        let mut procs: Vec<String> = Vec::new();
                        let mut recent: Vec<String> = Vec::new();
                        let mut used_chars: usize = 0;
                        let char_budget = token_budget * 4; // ~4 chars per token

                        for r in &rows {
                            if used_chars >= char_budget {
                                break;
                            }
                            let mtype: String = r
                                .try_get("memory_type")
                                .unwrap_or_else(|_| "episodic".to_string());
                            let heat: f32 = r.try_get("current_heat").unwrap_or(0.0);
                            let ps: String = r.try_get("pointer_summary").unwrap_or_default();
                            let content: Option<String> = r.try_get("raw_content").ok().flatten();
                            let text = content.unwrap_or_else(|| ps.clone());
                            let snippet = if text.len() > 400 {
                                format!("{}…", &text[..400])
                            } else {
                                text.clone()
                            };
                            let entry = format!("<item heat=\"{:.2}\">{}</item>", heat, snippet);
                            used_chars += entry.len();
                            match mtype.as_str() {
                                "preference" => prefs.push(entry),
                                "semantic" => facts.push(entry),
                                "procedural" => procs.push(entry),
                                _ => recent.push(entry),
                            }
                        }

                        // Tombstone stubs
                        let tombstone_rows = sqlx::query(
                            "SELECT label, address FROM tombstones ORDER BY evicted_at DESC LIMIT 5",
                        )
                        .fetch_all(self.storage.pool()).await.unwrap_or_default();
                        let tombstone_xml: String = tombstone_rows
                            .iter()
                            .map(|r| {
                                let label: String = r.try_get("label").unwrap_or_default();
                                let addr: String = r.try_get("address").unwrap_or_default();
                                format!("<paged_out>{} @ {}</paged_out>", label, addr)
                            })
                            .collect::<Vec<_>>()
                            .join("\n  ");

                        let now = Utc::now().to_rfc3339();
                        let xml = format!(
                            r#"<sulcus_context generated_at="{now}" token_budget="{token_budget}">
  <preferences>{prefs}</preferences>
  <facts>{facts}</facts>
  <procedures>{procs}</procedures>
  <recent>{recent}</recent>
  <tombstones>{tombstones}</tombstones>
</sulcus_context>"#,
                            now = now,
                            token_budget = token_budget,
                            prefs = prefs.join("\n  "),
                            facts = facts.join("\n  "),
                            procs = procs.join("\n  "),
                            recent = recent.join("\n  "),
                            tombstones = tombstone_xml,
                        );
                        json!({ "context": xml, "token_estimate": xml.len() / 4 })
                    }

                    // ── retire_edge ────────────────────────────────────────────────────────
                    "retire_edge" => {
                        let source_s = args
                            .get("source_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing source_id"))?;
                        let target_s = args
                            .get("target_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing target_id"))?;
                        sqlx::query(
                            "UPDATE edges SET valid_to = CURRENT_TIMESTAMP WHERE source_id = ? AND target_id = ? AND valid_to IS NULL",
                        )
                        .bind(source_s)
                        .bind(target_s)
                        .execute(self.storage.pool())
                        .await?;
                        json!({ "ok": true })
                    }

                    // ── retract_memory ─────────────────────────────────────────────────────
                    "retract_memory" => {
                        let node_id_s = args
                            .get("node_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                        let node_id = uuid::Uuid::parse_str(node_id_s)?;
                        let mut tx = self.storage.pool().begin().await?;
                        // Retire all edges connected to this node
                        sqlx::query(
                            "UPDATE edges SET valid_to = CURRENT_TIMESTAMP \
                             WHERE (source_id = ? OR target_id = ?) AND valid_to IS NULL",
                        )
                        .bind(node_id.to_string())
                        .bind(node_id.to_string())
                        .execute(&mut *tx)
                        .await?;
                        // Zero out heat + utility; keep tombstone
                        sqlx::query(
                            "UPDATE nodes SET current_heat = 0.0, base_utility = 0.0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        )
                        .bind(node_id.to_string())
                        .execute(&mut *tx).await?;
                        sqlx::query("DELETE FROM active_index WHERE node_id = ?")
                            .bind(node_id.to_string())
                            .execute(&mut *tx)
                            .await?;
                        tx.commit().await?;
                        let payload = json!({ "node_id": node_id.to_string() });
                        self.storage.record_memory_op("RETRACT", &payload).await?;
                        json!({ "ok": true })
                    }

                    other => return Err(anyhow::anyhow!("unknown tool")),
                };

                // wrap inner_result as a string inside MCP `content` array
                let wrapped = json!({ "jsonrpc": "2.0", "id": id_val, "result": { "content": [ { "type": "text", "text": inner_result.to_string() } ] } });
                return Ok(wrapped.to_string());
            }

            "resources/list" => {
                let res = json!({ "jsonrpc": "2.0", "id": id_val, "result": { "resources": [
                    { "uri": "memory://active_index",     "name": "Active Index (JSON)" },
                    { "uri": "memory://active_index.bin", "name": "Active Index (rkyv binary, zero-copy)" }
                ] } });
                return Ok(res.to_string());
            }

            "resources/read" => {
                let uri = v
                    .pointer("/params/uri")
                    .and_then(|u| u.as_str())
                    .unwrap_or("");
                match uri {
                    "memory://active_index" => {
                        let limit = v
                            .pointer("/params/limit")
                            .and_then(|l| l.as_u64())
                            .unwrap_or(20) as usize;
                        let active = self.active_index(limit).await?; // returns Value::String(minified JSON)
                        let active_text = active.as_str().unwrap_or("[]");
                        let res = json!({ "jsonrpc": "2.0", "id": id_val, "result": { "contents": [ { "uri": "memory://active_index", "mimeType": "application/json", "text": active_text } ] } });
                        return Ok(res.to_string());
                    }
                    "memory://active_index.bin" => {
                        // Zero-copy binary resource: rkyv-encoded NodePointers.
                        // Encode as base64 for MCP transport; the consumer decodes and mmap's.
                        let bytes = self.storage.shared_index_bytes();
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                        let res = json!({ "jsonrpc": "2.0", "id": id_val, "result": { "contents": [ {
                            "uri": "memory://active_index.bin",
                            "mimeType": "application/octet-stream",
                            "blob": b64
                        } ] } });
                        return Ok(res.to_string());
                    }
                    _ => return Err(anyhow::anyhow!("unknown resource uri")),
                }
            }

            "commit_memory" => {
                let label = v
                    .pointer("/params/label")
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                let pointer_summary = v
                    .pointer("/params/pointer_summary")
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                let raw_content = v
                    .pointer("/params/raw_content")
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                let connected: Vec<Value> = v
                    .pointer("/params/connected_node_ids")
                    .and_then(|x| x.as_array())
                    .cloned()
                    .unwrap_or_default();

                let id = Uuid::from_u128(Utc::now().timestamp_nanos() as u128);

                let mut tx = self.storage.pool().begin().await?;

                // upsert node (current_heat = 1.0)
                sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(id) DO UPDATE SET label = excluded.label, pointer_summary = excluded.pointer_summary, base_utility = excluded.base_utility, current_heat = excluded.current_heat, is_pinned = excluded.is_pinned, memory_type = excluded.memory_type"#)
                    .bind(id.to_string())
                    .bind(label)
                    .bind(pointer_summary)
                    .bind(0.0f32)
                    .bind(1.0f32)
                    .bind(0i64)
                    .bind("episodic")
                    .execute(&mut *tx)
                    .await?;

                // upsert payload if provided
                if !raw_content.is_empty() {
                    sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET raw_content = excluded.raw_content")
                        .bind(id.to_string())
                        .bind(raw_content)
                        .execute(&mut *tx)
                        .await?;
                }

                // insert vector embedding for pointer_summary using the injected provider
                let embedding = match self.embedder.embed(&pointer_summary) {
                    Ok(e) => e,
                    Err(e) => {
                        // don't fail the entire commit on embedding failures; log and continue
                        tracing::warn!(error = %e, "embedding generation failed - continuing without vec_nodes insert");
                        Vec::new()
                    }
                };

                if !embedding.is_empty() {
                    // store vector as native f32 bytes in `embeddings` BLOB column
                    let blob: Vec<u8> = bytemuck::cast_slice(&embedding).to_vec();
                    let _ = sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET vector = excluded.vector")
                        .bind(blob)
                        .execute(&mut *tx)
                        .await
                        .ok();
                }

                // insert edges
                for x in connected
                    .into_iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                {
                    if let Ok(uuid) = uuid::Uuid::parse_str(&x) {
                        sqlx::query("INSERT INTO edges (source_id, target_id, relationship_type, edge_weight) VALUES (?, ?, ?, ?) ON CONFLICT(source_id, target_id) DO UPDATE SET relationship_type = excluded.relationship_type, edge_weight = excluded.edge_weight")
                            .bind(id.to_string())
                            .bind(uuid.to_string())
                            .bind("semantic")
                            .bind(0.5f32)
                            .execute(&mut *tx)
                            .await?;
                    }
                }

                // record memory op (WAL deprecated) — call storage shim for compatibility
                let payload_json = json!({ "id": id.to_string(), "label": label, "pointer_summary": pointer_summary });
                self.storage
                    .record_memory_op("COMMIT", &payload_json)
                    .await?;

                sqlx::query(r#"INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP"#)
                    .bind(id.to_string())
                    .bind(1.0f32)
                    .execute(&mut *tx)
                    .await?;

                tx.commit().await?;

                // best-effort: rebuild active_index cache so response reflects the new state
                let _ = crate::tick(&self.storage, 0.85, 1.0, 20).await;

                let res = json!({ "jsonrpc": "2.0", "id": id_val, "result": { "node_id": id.to_string() } });
                return Ok(res.to_string());
            }
            "ignite_and_tick" => {
                // Embed prompt, ignite matching nodes (best-effort), then run a tick and return active_index
                let prompt = v
                    .pointer("/params/prompt")
                    .and_then(|p| p.as_str())
                    .unwrap_or("");
                if !prompt.is_empty() {
                    match self.embedder.embed(prompt) {
                        Ok(emb) => {
                            // best-effort ignite; ignore errors from vector index
                            let _ = crate::thermodynamics::ignite(&self.storage, &emb, 3).await;
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "embedding failed for ignite_and_tick")
                        }
                    }
                }

                // force a tick so heat diffuses and active_index is rebuilt
                let _ = crate::tick(&self.storage, 0.85, 1.0, 20).await;

                // return the active_index minified JSON string
                let active = self.active_index(20).await?;
                let res = json!({ "id": id, "result": active });
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
                    .unwrap_or(0.0) as f32;
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
            "metrics" => {
                // lightweight runtime/storage metrics for observability
                let active_index = self.storage.list_active_index(1000).await?;
                let active_index_size = active_index.len();
                let num_nodes = self.storage.count_nodes().await?;
                let memory_ops_count = self.storage.memory_ops_count().await?;
                let db_size_bytes = self
                    .storage
                    .db_file_size()
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or(0);
                let last_seq = self.storage.get_last_seq().await?;
                let server_cursor_seq = self.storage.get_server_cursor_seq().await?;

                let metrics = json!({
                    "active_index_size": active_index_size,
                    "num_nodes": num_nodes,
                    "memory_ops_count": memory_ops_count,
                    "db_size_bytes": db_size_bytes,
                    "last_seq": last_seq,
                    "server_cursor_seq": server_cursor_seq
                });

                let res = json!({ "id": id, "result": metrics });
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
            // Direct-method aliases: callers may invoke these without the tools/call envelope.
            "add_memory" => {
                let content = v
                    .pointer("/params/content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                let node_id = self.add_memory(content, None).await?;
                let res = json!({ "id": id, "result": { "node_id": node_id.to_string() } });
                Ok(res.to_string())
            }
            "get_node" => {
                let node_id_s = v
                    .pointer("/params/node_id")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                let node_id = uuid::Uuid::parse_str(node_id_s)?;
                let node = self.storage.get_node(node_id).await?;
                let res = json!({ "id": id, "result": { "node": node } });
                Ok(res.to_string())
            }
            _ => Err(anyhow::anyhow!("unknown method")),
        }
    }

    /// Example stdio loop (not used by unit tests). Reads JSON requests line-by-line from stdin
    /// and prints JSON responses to stdout.
    pub async fn run_stdio_loop(&self) -> anyhow::Result<()> {
        use std::io::Write as _;
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
                    let _ = std::io::stdout().flush();
                }
                Err(e) => {
                    let err = json!({ "error": e.to_string() });
                    println!("{}", err.to_string());
                    let _ = std::io::stdout().flush();
                }
            }
        }
        Ok(())
    }
}
