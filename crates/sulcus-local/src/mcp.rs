use anyhow::Context;
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
        };
        self.storage.upsert_node(node.clone()).await?;

        let payload = json!({ "id": id.to_string(), "pointer_summary": node.pointer_summary, "current_heat": node.current_heat });
        self.storage.record_memory_op("ADD", &payload).await?;
        self.storage.set_active_index(id, node.current_heat).await?;

        Ok(id)
    }

    /// Returns the `active_index` resource as a JSON-friendly array of nodes.
    /// For `memory://active_index` we return the cached minified JSON produced by thermodynamics.
    pub async fn active_index(&self, limit: usize) -> anyhow::Result<Value> {
        // Prefer cached minified JSON (string) produced by thermodynamics.
        let cached = self.storage.get_active_index_json();
        if !cached.is_empty() {
            return Ok(Value::String(cached));
        }

        // Query the nodes table directly ordered by Score = current_heat + (base_utility * 0.5)
        let rows = sqlx::query("SELECT id, label, pointer_summary FROM nodes ORDER BY (current_heat + (base_utility * 0.5)) DESC LIMIT ?")
            .bind(limit as i64)
            .fetch_all(self.storage.pool())
            .await?;

        let mut arr: Vec<serde_json::Value> = Vec::with_capacity(rows.len());
        for r in rows.into_iter() {
            let id_str: String = r.try_get("id")?;
            let label: String = r.try_get("label")?;
            let pointer_summary: String = r.try_get("pointer_summary")?;
            arr.push(serde_json::json!({ "id": id_str, "label": label, "pointer_summary": pointer_summary }));
        }

        let minified = serde_json::to_string(&arr)?;
        // cache for faster subsequent reads
        self.storage.set_active_index_json(minified.clone());
        Ok(Value::String(minified))
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
                "name": "add_memory",
                "description": "Record text into Sulcus memory",
                "mcp_method": "add_memory",
                "cli": "add-memory <summary> [heat]",
                "inputSchema": { "type": "object", "properties": { "content": { "type": "string" }, "tags": { "type": "array", "items": { "type": "string" } } } },
                "returns": { "node_id": "uuid" }
            },
            {
                "name": "summarize",
                "description": "Deterministic extractive summary (local, offline)",
                "mcp_method": "summarize",
                "cli": "summarize [text|stdin] [max_chars]",
                "inputSchema": { "type": "object", "properties": { "text": { "type": "string" }, "max_chars": { "type": "number" } } },
                "returns": { "summary": "string" }
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
                "name": "tick",
                "description": "Force a thermodynamics tick (decay/prune/active index rebuild)",
                "mcp_method": "tick",
                "inputSchema": { "type": "object", "properties": { "decay": { "type": "number" }, "prune_threshold": { "type": "number" }, "active_limit": { "type": "number" } } },
                "returns": { "ok": "boolean" }
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
                "name": "sync_now",
                "description": "Trigger a push/pull sync with configured server (requires SULCUS_SERVER_URL)",
                "mcp_method": "sync_now",
                "inputSchema": { "type": "object", "properties": {} },
                "returns": { "ok": "boolean" }
            },
            {
                "name": "metrics",
                "description": "Runtime and storage metrics useful to OpenClaw (active_index size, db size, counts)",
                "mcp_method": "metrics",
                "inputSchema": { "type": "object", "properties": {} },
                "returns": { "metrics": "object" }
            }
        ]);
        Ok(json!({ "name": "sulcus-local", "version": env!("CARGO_PKG_VERSION"), "tools": tools }))
    }

    /// Process a JSON-RPC 2.0 MCP request and return a JSON-RPC 2.0 response string.
    /// New surface: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`.
    pub async fn handle_request(&self, req_json: &str) -> anyhow::Result<String> {
        let v: Value = serde_json::from_str(req_json).context("invalid json")?;

        // MUST be JSON-RPC 2.0 and include an `id`.
        let jsonrpc = v.get("jsonrpc").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("missing jsonrpc field"))?;
        if jsonrpc != "2.0" {
            return Err(anyhow::anyhow!("unsupported jsonrpc version"));
        }
        let id_val = v.get("id").cloned().ok_or_else(|| anyhow::anyhow!("missing id"))?;

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
                        let max = args.get("max_chars").and_then(|m| m.as_u64()).unwrap_or(500) as usize;
                        let summary = self.summarize(text, max).await?;
                        json!({ "summary": summary })
                    }
                    "upsert_node" => {
                        let id_s = args.get("id").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("missing id"))?;
                        let label = args.get("label").and_then(|x| x.as_str()).unwrap_or("");
                        let pointer_summary = args.get("pointer_summary").and_then(|x| x.as_str()).unwrap_or("");
                        let current_heat = args.get("current_heat").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
                        let base_utility = args.get("base_utility").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
                        let is_pinned = args.get("is_pinned").and_then(|x| x.as_bool()).unwrap_or(false);
                        let node = sulcus_core::graph::Node {
                            id: uuid::Uuid::parse_str(id_s)?,
                            label: label.to_string(),
                            pointer_summary: pointer_summary.to_string(),
                            base_utility,
                            current_heat,
                            is_pinned,
                        };
                        self.storage.upsert_node(node.clone()).await?;
                        json!({ "node_id": node.id.to_string() })
                    }
                    "get_node" => {
                        let node_id_s = args.get("node_id").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                        let node_id = uuid::Uuid::parse_str(node_id_s)?;
                        let node = self.storage.get_node(node_id).await?;
                        json!({ "node": node })
                    }
                    "list_hot_nodes" => {
                        let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(20) as usize;
                        let list = self.storage.list_hot_nodes(limit).await?;
                        json!(list)
                    }
                    "fetch_payload" => {
                        let node_id_s = args.get("node_id").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
                        let node_id = uuid::Uuid::parse_str(node_id_s)?;
                        let mut tx = self.storage.pool().begin().await?;
                        let payload_row = sqlx::query("SELECT raw_content FROM payloads WHERE node_id = ?")
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
                        } else { None };
                        tx.commit().await?;
                        let _ = crate::tick(&self.storage, 0.85, 1.0, 20).await;
                        json!({ "raw_content": raw })
                    }
                    "commit_memory" => {
                        let label = args.get("label").and_then(|x| x.as_str()).unwrap_or("");
                        let pointer_summary = args.get("pointer_summary").and_then(|x| x.as_str()).unwrap_or("");
                        let raw_content = args.get("raw_content").and_then(|x| x.as_str()).unwrap_or("");
                        let connected = args.get("connected_node_ids").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                        let id = Uuid::from_u128(Utc::now().timestamp_nanos() as u128);
                        let mut tx = self.storage.pool().begin().await?;
                        sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                             ON CONFLICT(id) DO UPDATE SET label = excluded.label, pointer_summary = excluded.pointer_summary, base_utility = excluded.base_utility, current_heat = excluded.current_heat, is_pinned = excluded.is_pinned"#)
                            .bind(id.to_string())
                            .bind(label)
                            .bind(pointer_summary)
                            .bind(0.0f32)
                            .bind(1.0f32)
                            .bind(0i64)
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
                            let mut blob: Vec<u8> = Vec::with_capacity(embedding.len() * 4);
                            for v in embedding.iter() {
                                blob.extend(&v.to_le_bytes());
                            }
                            let _ = sqlx::query("INSERT INTO vec_nodes (node_id, embedding) VALUES (?, ?)")
                                .bind(id.to_string())
                                .bind(blob)
                                .execute(&mut *tx)
                                .await
                                .ok();
                        }
                        for x in connected.into_iter().filter_map(|v| v.as_str().map(|s| s.to_string())) {
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
                        sqlx::query("INSERT INTO memory_ops (op_type, payload, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
                            .bind("COMMIT")
                            .bind(payload_json.to_string())
                            .execute(&mut *tx)
                            .await?;
                        sqlx::query(r#"INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                             ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP"#)
                            .bind(id.to_string())
                            .bind(1.0f32)
                            .execute(&mut *tx)
                            .await?;
                        tx.commit().await?;
                        let _ = crate::tick(&self.storage, 0.85, 1.0, 20).await;
                        json!({ "node_id": id.to_string() })
                    }
                    "ignite_and_tick" => {
                        let prompt = args.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
                        if !prompt.is_empty() {
                            match self.embedder.embed(prompt) {
                                Ok(emb) => {
                                    let _ = crate::thermodynamics::ignite(&self.storage, &emb, 3).await;
                                }
                                Err(e) => tracing::warn!(error = %e, "embedding failed for ignite_and_tick"),
                            }
                        }
                        let _ = crate::tick(&self.storage, 0.85, 1.0, 20).await;
                        let active = self.active_index(20).await?;
                        json!(active)
                    }
                    "tick" => {
                        let decay = args.get("decay").and_then(|p| p.as_f64()).unwrap_or(0.85) as f32;
                        let prune_threshold = args.get("prune_threshold").and_then(|p| p.as_f64()).unwrap_or(1.0) as f32;
                        let active_limit = args.get("active_limit").and_then(|p| p.as_u64()).unwrap_or(20) as usize;
                        crate::tick(&self.storage, decay, prune_threshold, active_limit).await?;
                        json!({ "ok": true })
                    }
                    "list_memory_ops" => {
                        let ops = self.storage.list_memory_ops().await?;
                        json!(ops)
                    }
                    "record_memory_op" => {
                        let op_type = args.get("op_type").and_then(|p| p.as_str()).unwrap_or("GEN");
                        let payload = args.get("payload").cloned().unwrap_or(json!({}));
                        self.storage.record_memory_op(op_type, &payload).await?;
                        json!({ "ok": true })
                    }
                    "set_active_index" => {
                        let node_id_s = args.get("node_id").and_then(|p| p.as_str()).ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
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
                        let db_size_bytes = self.storage.db_file_size().ok().flatten().unwrap_or(0);
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
                        let server = std::env::var("SULCUS_SERVER_URL").map_err(|_| anyhow::anyhow!("SULCUS_SERVER_URL required for sync_now"))?;
                        let api_key = std::env::var("SULCUS_API_KEY").ok();
                        let engine = crate::sync_http::HttpSyncEngine::new(server, api_key);
                        let mut client = crate::LocalSyncClient::new(self.storage.clone());
                        client.push_to_engine(&engine).await?;
                        client.pull_from_engine_and_apply(&engine, None).await?;
                        json!({ "ok": true })
                    }
                    other => return Err(anyhow::anyhow!("unknown tool")),
                };

                // wrap inner_result as a string inside MCP `content` array
                let wrapped = json!({ "jsonrpc": "2.0", "id": id_val, "result": { "content": [ { "type": "text", "text": inner_result.to_string() } ] } });
                return Ok(wrapped.to_string());
            }

            "resources/list" => {
                let res = json!({ "jsonrpc": "2.0", "id": id_val, "result": { "resources": [ { "uri": "memory://active_index", "name": "Active Index" } ] } });
                return Ok(res.to_string());
            }

            "resources/read" => {
                let uri = v.pointer("/params/uri").and_then(|u| u.as_str()).unwrap_or("");
                match uri {
                    "memory://active_index" => {
                        let limit = v.pointer("/params/limit").and_then(|l| l.as_u64()).unwrap_or(20) as usize;
                        let active = self.active_index(limit).await?; // returns Value::String(minified JSON)
                        let active_text = active.as_str().unwrap_or("[]");
                        let res = json!({ "jsonrpc": "2.0", "id": id_val, "result": { "contents": [ { "uri": "memory://active_index", "mimeType": "application/json", "text": active_text } ] } });
                        return Ok(res.to_string());
                    }
                    _ => return Err(anyhow::anyhow!("unknown resource uri")),
                }
            }



                let id = Uuid::from_u128(Utc::now().timestamp_nanos() as u128);

                let mut tx = self.storage.pool().begin().await?;

                // upsert node (current_heat = 1.0)
                sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(id) DO UPDATE SET label = excluded.label, pointer_summary = excluded.pointer_summary, base_utility = excluded.base_utility, current_heat = excluded.current_heat, is_pinned = excluded.is_pinned"#)
                    .bind(id.to_string())
                    .bind(label)
                    .bind(pointer_summary)
                    .bind(0.0f32)
                    .bind(1.0f32)
                    .bind(0i64)
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
                    // convert f32 vec to little-endian bytes for sqlite-vec
                    let mut blob: Vec<u8> = Vec::with_capacity(embedding.len() * 4);
                    for v in embedding.iter() {
                        blob.extend(&v.to_le_bytes());
                    }
                    // sqlite-vec's virtual table does not support `ON CONFLICT` —
                    // use a plain INSERT and ignore errors (best-effort). This prevents
                    // the node transaction from failing when the vec_nodes table is
                    // absent or the virtual table doesn't support upsert.
                    let _ = sqlx::query("INSERT INTO vec_nodes (node_id, embedding) VALUES (?, ?)")
                        .bind(id.to_string())
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

                // record memory op and update active_index inside the same transaction for atomicity
                let payload_json = json!({ "id": id.to_string(), "label": label, "pointer_summary": pointer_summary });
                sqlx::query("INSERT INTO memory_ops (op_type, payload, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
                    .bind("COMMIT")
                    .bind(payload_json.to_string())
                    .execute(&mut *tx)
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

                let res = json!({ "id": id, "result": { "node_id": id.to_string() } });
                Ok(res.to_string())
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
            "metrics" => {
                // lightweight runtime/storage metrics for observability
                let active_index = self.storage.list_active_index(1000).await?;
                let active_index_size = active_index.len();
                let num_nodes = self.storage.count_nodes().await?;
                let memory_ops_count = self.storage.memory_ops_count().await?;
                let db_size_bytes = self.storage.db_file_size().ok().flatten().unwrap_or(0);
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
