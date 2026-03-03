use super::types::McpTool;
use crate::mcp::McpHandler;
use async_trait::async_trait;
use serde_json::{json, Value};
use uuid::Uuid;
use chrono::Utc;
use crate::tokenizer::count_tokens;
use sqlx::Row;
use sulcus_core::StorageBackend;

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&apos;")
}

pub struct AddMemory;

#[async_trait]
impl McpTool for AddMemory {
    fn name(&self) -> &str { "record_memory" }
    fn description(&self) -> &str { "Record text into Sulcus memory and assign to a Fold" }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["content"],
            "properties": {
                "content": { "type": "string" },
                "fold_name": { "type": "string" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let content = args.get("content").and_then(|c| c.as_str()).unwrap_or("");
        let fold_name = args.get("fold_name").and_then(|f| f.as_str()).unwrap_or("default");

        let id = Uuid::now_v7();
        let pointer_summary = if content.len() > 200 {
            content.chars().take(200).collect::<String>()
        } else {
            content.to_string()
        };
        let label = pointer_summary
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_string();

        let mut tx = handler.storage().pool().begin().await?;
        sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET label = EXCLUDED.label, pointer_summary = EXCLUDED.pointer_summary, base_utility = EXCLUDED.base_utility, current_heat = EXCLUDED.current_heat, is_pinned = EXCLUDED.is_pinned, memory_type = EXCLUDED.memory_type"#)
            .bind(id.to_string())
            .bind(&label)
            .bind(&pointer_summary)
            .bind(0.0f32)
            .bind(1.0f32)
            .bind(false)
            .bind("episodic")
            .execute(&mut *tx)
            .await?;

        sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET raw_content = EXCLUDED.raw_content")
            .bind(id.to_string())
            .bind(content)
            .execute(&mut *tx)
            .await?;

        let embedding = handler.embedder().embed(content)?;
        if !embedding.is_empty() {
            // Use a savepoint to allow fallback if 'vector' type is missing
            sqlx::query("SAVEPOINT embedding_insert").execute(&mut *tx).await?;
            
            let emb_sql = format!("[{}]", embedding.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
            let res = sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2::vector) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                .bind(id.to_string())
                .bind(&emb_sql)
                .execute(&mut *tx)
                .await;
            
            if res.is_err() {
                sqlx::query("ROLLBACK TO SAVEPOINT embedding_insert").execute(&mut *tx).await?;
                // Fallback to BYTEA blob
                let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
                sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                    .bind(id.to_string())
                    .bind(bytes)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query("RELEASE SAVEPOINT embedding_insert").execute(&mut *tx).await?;
            }
        }

        let fold_row = sqlx::query("SELECT id FROM folds WHERE name = $1")
            .bind(fold_name)
            .fetch_optional(&mut *tx)
            .await?;
        let fold_id = if let Some(r) = fold_row {
            r.try_get::<String, _>("id")?
        } else {
            let nid = Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO folds (id, name) VALUES ($1, $2)")
                .bind(&nid)
                .bind(fold_name)
                .execute(&mut *tx)
                .await?;
            nid
        };

        sqlx::query("INSERT INTO node_folds (node_id, fold_id) VALUES ($1, $2) ON CONFLICT(node_id, fold_id) DO NOTHING")
            .bind(id.to_string())
            .bind(&fold_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query(r#"INSERT INTO active_index (node_id, heat, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
             ON CONFLICT(node_id) DO UPDATE SET heat = EXCLUDED.heat, updated_at = CURRENT_TIMESTAMP"#)
            .bind(id.to_string())
            .bind(1.0f32)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        
        // Ignite heat for the new node so it's immediately active
        handler.storage().set_active_index(id, 1.0).await?;

        handler.storage().record_memory_op("ADD", &json!({
            "id": id.to_string(),
            "label": label,
            "pointer_summary": pointer_summary,
            "current_heat": 1.0,
            "memory_type": "episodic"
        })).await?;

        Ok(json!({ "node_id": id.to_string() }))
    }
}

pub struct GetNode;

#[async_trait]
impl McpTool for GetNode {
    fn name(&self) -> &str { "get_node" }
    fn description(&self) -> &str { "Fetch a node by id" }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["node_id"],
            "properties": {
                "node_id": { "type": "string", "format": "uuid" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let node_id_s = args.get("node_id").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
        let node_id_v = Uuid::parse_str(node_id_s)?;
        let node_v = handler.storage().get_node(node_id_v).await?;
        Ok(json!({ "node": node_v }))
    }
}

pub struct Summarize;

#[async_trait]
impl McpTool for Summarize {
    fn name(&self) -> &str { "summarize" }
    fn description(&self) -> &str { "Generate a short extractive summary of text" }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["text"],
            "properties": {
                "text": { "type": "string" },
                "max_chars": { "type": "number", "default": 500 }
            }
        })
    }
    async fn call(&self, _handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let text = args.get("text").and_then(|t| t.as_str()).unwrap_or("");
        let max = args.get("max_chars").and_then(|m| m.as_u64()).unwrap_or(500) as usize;
        
        let summary = if text.chars().count() > max {
            format!("{}...", text.chars().take(max).collect::<String>())
        } else {
            text.to_string()
        };
        
        Ok(json!({ "summary": summary }))
    }
}

pub struct SearchMemory;

#[async_trait]
impl McpTool for SearchMemory {
    fn name(&self) -> &str { "search_memory" }
    fn description(&self) -> &str { "Hybrid semantic search: combines cosine similarity with FTS" }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": { "type": "string" },
                "limit": { "type": "number", "default": 10 },
                "memory_type": { "type": "string", "enum": ["episodic", "semantic", "preference", "procedural"] }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let q = args.get("query").and_then(|x| x.as_str()).unwrap_or("");
        let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(10) as usize;
        let type_filter = args.get("memory_type").and_then(|x| x.as_str());

        let q_emb = handler.embedder().embed(q).unwrap_or_default();
        let mut scores: std::collections::HashMap<String, (f64, f64, String, String, f32)> = std::collections::HashMap::new();

        if !q_emb.is_empty() {
            let vec_hits = handler.storage().search_vectors(&q_emb, limit * 2).await;
            if !vec_hits.is_empty() {
                let candidate_ids: Vec<String> = vec_hits.iter().map(|(id, _)| id.to_string()).collect();
                let meta_rows = sqlx::query("SELECT id, label, pointer_summary, current_heat, memory_type FROM nodes WHERE id = ANY($1)")
                    .bind(&candidate_ids)
                    .fetch_all(handler.storage().pool())
                    .await.unwrap_or_default();

                let mut meta_map: std::collections::HashMap<String, (String, String, f32, String)> = std::collections::HashMap::new();
                for r in &meta_rows {
                    let id_s: String = r.try_get("id").unwrap_or_default();
                    let lbl: String = r.try_get("label").unwrap_or_default();
                    let ps: String = r.try_get("pointer_summary").unwrap_or_default();
                    let heat: f32 = r.try_get("current_heat").unwrap_or(0.0);
                    let mtype: String = r.try_get("memory_type").unwrap_or_default();
                    meta_map.insert(id_s, (lbl, ps, heat, mtype));
                }

                for (id, cos_sim) in vec_hits {
                    let id_s = id.to_string();
                    if let Some(f) = type_filter {
                        if meta_map.get(&id_s).map_or(false, |(_, _, _, mtype)| mtype.as_str() != f) {
                            continue;
                        }
                    }
                    if let Some((lbl, ps, heat, _)) = meta_map.remove(&id_s) {
                        scores.insert(id_s, (cos_sim as f64 * 0.6, 0.0, lbl, ps, heat));
                    }
                }
            }
        }

        let fts_rows = sqlx::query(
            "SELECT n.id AS node_id, \
             ts_rank(to_tsvector('english', n.pointer_summary), plainto_tsquery('english', $1)) AS rank \
             FROM nodes n \
             WHERE to_tsvector('english', n.pointer_summary) @@ plainto_tsquery('english', $1) \
             ORDER BY rank DESC LIMIT 50",
        )
        .bind(q)
        .fetch_all(handler.storage().pool()).await.unwrap_or_default();

        for r in &fts_rows {
            let id_s: String = r.try_get("node_id").unwrap_or_default();
            let rank: f64 = r.try_get::<f32, _>("rank").map(|v| v as f64).unwrap_or(0.0);
            let fts_score = rank.min(1.0);
            scores.entry(id_s.clone()).and_modify(|e| e.1 = fts_score * 0.4).or_insert_with(|| {
                (0.0f64, fts_score * 0.4, String::new(), String::new(), 0.0f32)
            });
        }

        let mut scored: Vec<(f64, String, String, String, f32)> = scores.into_iter().filter_map(|(id_s, (cos, fts, label, ps, heat))| {
            let combined = cos + fts;
            if combined <= 0.0 { return None; }
            Some((combined, id_s, label, ps, heat))
        }).collect();
        scored.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        let results: Vec<Value> = scored.into_iter().map(|(combined, id_s, label, ps, heat)| {
            json!({ "id": id_s, "label": label, "pointer_summary": ps, "heat": heat, "score": combined })
        }).collect();
        Ok(json!({ "results": results }))
    }
}

pub struct BuildContext;

#[async_trait]
impl McpTool for BuildContext {
    fn name(&self) -> &str { "build_context" }
    fn description(&self) -> &str { "Render hot nodes as a structured XML context block" }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string" },
                "token_budget": { "type": "number", "default": 2000 }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let prompt = args.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
        let token_budget = args.get("token_budget").and_then(|t| t.as_u64()).unwrap_or(2000) as usize;

        if !prompt.is_empty() {
            if let Ok(emb) = handler.embedder().embed(prompt) {
                let _ = crate::thermodynamics::ignite(handler.storage(), &emb, 5).await;
            }
        }
        // Force a tick to apply decay/utility before rendering
        let _ = crate::tick(handler.storage(), 0.85, 0.05, 30).await;

        let rows = sqlx::query(
            "SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.memory_type, n.created_at, p.raw_content \
             FROM nodes n \
             JOIN active_index ai ON ai.node_id = n.id \
             LEFT JOIN payloads p ON p.node_id = n.id \
             ORDER BY ai.heat DESC LIMIT 30",
        )
        .fetch_all(handler.storage().pool()).await?;

        let mut prefs: Vec<String> = Vec::new();
        let mut facts: Vec<String> = Vec::new();
        let mut procs: Vec<String> = Vec::new();
        let mut recent: Vec<String> = Vec::new();
        let mut used_tokens: usize = 0;
        let tag_overhead: usize = 300;
        let effective_budget = token_budget.saturating_sub(tag_overhead);

        for r in &rows {
            if used_tokens >= effective_budget { break; }
            let mtype: String = r.try_get("memory_type").unwrap_or_else(|_| "episodic".to_string());
            let heat: f32 = r.try_get("current_heat").unwrap_or(0.0);
            let ps: String = r.try_get("pointer_summary").unwrap_or_default();
            let content: Option<String> = r.try_get("raw_content").ok().flatten();
            let text = content.unwrap_or_else(|| ps.clone());
            let snippet = if text.chars().count() > 400 {
                format!("{}…", text.chars().take(400).collect::<String>())
            } else {
                text.clone()
            };
            let entry = format!("<item heat=\"{:.2}\">{}</item>", heat, xml_escape(&snippet));
            used_tokens += count_tokens(&entry);
            if used_tokens > effective_budget { break; }
            match mtype.as_str() {
                "preference" => prefs.push(entry),
                "semantic" => facts.push(entry),
                "procedural" => procs.push(entry),
                _ => recent.push(entry),
            }
        }

        let tombstone_rows = sqlx::query(
            "SELECT label, address FROM tombstones ORDER BY evicted_at DESC LIMIT 5",
        )
        .fetch_all(handler.storage().pool()).await.unwrap_or_default();
        let tombstone_xml: String = tombstone_rows.iter().map(|r| {
            let label: String = r.try_get("label").unwrap_or_default();
            let addr: String = r.try_get("address").unwrap_or_default();
            format!("<paged_out>{} @ {}</paged_out>", xml_escape(&label), xml_escape(&addr))
        }).collect::<Vec<_>>().join("\n  ");

        let now = Utc::now().to_rfc3339();
        let xml = format!(
            r#"<sulcus_context generated_at="{now}" token_budget="{token_budget}">
  <preferences>
    {}
  </preferences>
  <facts>
    {}
  </facts>
  <procedures>
    {}
  </procedures>
  <recent>
    {}
  </recent>
  <tombstones>
    {}
  </tombstones>
</sulcus_context>"#,
            prefs.join("\n    "),
            facts.join("\n    "),
            procs.join("\n    "),
            recent.join("\n    "),
            tombstone_xml
        );

        Ok(json!({ "xml": xml }))
    }
}

pub struct CommitMemory;
#[async_trait]
impl McpTool for CommitMemory {
    fn name(&self) -> &str { "commit_memory" }
    fn description(&self) -> &str { "Explicitly upsert a node with label and summary" }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["label", "pointer_summary"],
            "properties": {
                "label": { "type": "string" },
                "pointer_summary": { "type": "string" },
                "raw_content": { "type": "string" },
                "memory_type": { "type": "string", "enum": ["episodic", "semantic", "preference", "procedural"] }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let label = args.get("label").and_then(|v| v.as_str()).unwrap_or("");
        let ps = args.get("pointer_summary").and_then(|v| v.as_str()).unwrap_or("");
        let content = args.get("raw_content").and_then(|v| v.as_str()).unwrap_or("");
        let mtype = args.get("memory_type").and_then(|v| v.as_str()).unwrap_or("episodic");

        let id = Uuid::now_v7();
        let mut tx = handler.storage().pool().begin().await?;
        sqlx::query("INSERT INTO nodes (id, label, pointer_summary, memory_type, current_heat) VALUES ($1, $2, $3, $4, 1.0) ON CONFLICT(id) DO UPDATE SET label = EXCLUDED.label, pointer_summary = EXCLUDED.pointer_summary, memory_type = EXCLUDED.memory_type, current_heat = 1.0")
            .bind(id.to_string()).bind(label).bind(ps).bind(mtype).execute(&mut *tx).await?;
        
        if !content.is_empty() {
            sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET raw_content = EXCLUDED.raw_content")
                .bind(id.to_string()).bind(content).execute(&mut *tx).await?;
        }

        let et = if !ps.is_empty() { ps } else { content };
        if !et.is_empty() {
            if let Ok(emb) = handler.embedder().embed(et) {
                if !emb.is_empty() {
                    // Use a savepoint to allow fallback if 'vector' type is missing
                    sqlx::query("SAVEPOINT embedding_insert").execute(&mut *tx).await?;

                    let emb_sql = format!("[{}]", emb.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
                    let res = sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2::vector) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                        .bind(id.to_string())
                        .bind(&emb_sql)
                        .execute(&mut *tx)
                        .await;
                    
                    if res.is_err() {
                        sqlx::query("ROLLBACK TO SAVEPOINT embedding_insert").execute(&mut *tx).await?;
                        let bytes: Vec<u8> = emb.iter().flat_map(|f| f.to_le_bytes()).collect();
                        sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                            .bind(id.to_string())
                            .bind(bytes)
                            .execute(&mut *tx)
                            .await?;
                    } else {
                        sqlx::query("RELEASE SAVEPOINT embedding_insert").execute(&mut *tx).await?;
                    }
                }
            }
        }
        tx.commit().await?;
        handler.storage().record_memory_op_internal("COMMIT", &json!({ "id": id.to_string(), "label": label })).await?;
        let _ = crate::tick(handler.storage(), 0.85, 0.05, 20).await;
        Ok(json!({ "node_id": id.to_string() }))
    }
}

pub struct UpdateMemory;
#[async_trait]
impl McpTool for UpdateMemory {
    fn name(&self) -> &str { "update_memory" }
    fn description(&self) -> &str { "Update specific fields of a node via HLC-based CRDT Patch" }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["node_id"],
            "properties": {
                "node_id": { "type": "string", "format": "uuid" },
                "label": { "type": "string" },
                "pointer_summary": { "type": "string" },
                "raw_content": { "type": "string" },
                "base_utility": { "type": "number" },
                "is_pinned": { "type": "boolean" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let id_s = args.get("node_id").and_then(|v| v.as_str()).ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
        let id = Uuid::parse_str(id_s)?;
        
        let mut patch = sulcus_core::crdt::NodePatch::new(id);
        let actor_id = handler.storage().get_or_create_client_id().await?;
        
        // Load existing clocks to generate monotonic updates
        let mut clocks = handler.storage().get_crdt_clocks(id).await?;
        
        if let Some(lbl) = args.get("label").and_then(|v| v.as_str()) {
            let prev = clocks.get("label").copied();
            let clock = sulcus_core::crdt::Hlc::now(actor_id, prev);
            patch = patch.with_label(lbl, clock);
        }
        if let Some(ps) = args.get("pointer_summary").and_then(|v| v.as_str()) {
            let prev = clocks.get("pointer_summary").copied();
            let clock = sulcus_core::crdt::Hlc::now(actor_id, prev);
            patch = patch.with_summary(ps, clock);
        }
        if let Some(util) = args.get("base_utility").and_then(|v| v.as_f64()) {
            let prev = clocks.get("base_utility").copied();
            let clock = sulcus_core::crdt::Hlc::now(actor_id, prev);
            patch = patch.with_utility(util as f32, clock);
        }
        if let Some(p) = args.get("is_pinned").and_then(|v| v.as_bool()) {
            let prev = clocks.get("is_pinned").copied();
            let clock = sulcus_core::crdt::Hlc::now(actor_id, prev);
            patch = patch.with_pinned(p, clock);
        }

        if let Some(raw) = args.get("raw_content").and_then(|v| v.as_str()) {
            handler.storage().insert_payload(id, raw).await?;
        }

        if let Some(mut existing) = handler.storage().get_node(id).await? {
            if patch.apply_to_with_clocks(&mut existing, &mut clocks) {
                handler.storage().upsert_node(existing).await?;
                handler.storage().set_crdt_clocks(id, &clocks).await?;
                
                // Record the PATCH operation in the WAL for sync
                handler.storage().record_memory_op_internal("PATCH", &serde_json::to_value(&patch)?).await?;
            }
        }

        Ok(json!({ "ok": true }))
    }
}

pub struct ForgetMemory;
#[async_trait]
impl McpTool for ForgetMemory {
    fn name(&self) -> &str { "forget_memory" }
    fn description(&self) -> &str { "Hard-delete a node and its related records" }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["node_id"],
            "properties": { "node_id": { "type": "string", "format": "uuid" }, "purge_cold": { "type": "boolean", "default": false } }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let id_s = args.get("node_id").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("missing id"))?;
        let _id = Uuid::parse_str(id_s)?;
        let purge = args.get("purge_cold").and_then(|x| x.as_bool()).unwrap_or(false);
        
        let mut tx = handler.storage().pool().begin().await?;
        sqlx::query("DELETE FROM embeddings WHERE node_id = $1").bind(id_s).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM payloads WHERE node_id = $1").bind(id_s).execute(&mut *tx).await?;
        if purge { sqlx::query("DELETE FROM cold_storage WHERE node_id = $1").bind(id_s).execute(&mut *tx).await?; }
        sqlx::query("DELETE FROM nodes WHERE id = $1").bind(id_s).execute(&mut *tx).await?;
        tx.commit().await?;
        handler.storage().record_memory_op_internal("FORGET", &json!({ "node_id": id_s, "purge_cold": purge })).await?;
        Ok(json!({ "ok": true }))
    }
}

pub struct ListHotNodes;
#[async_trait]
impl McpTool for ListHotNodes {
    fn name(&self) -> &str { "list_hot_nodes" }
    fn description(&self) -> &str { "List most relevant nodes" }
    fn input_schema(&self) -> Value { json!({ "type": "object", "properties": { "limit": { "type": "number", "default": 20 } } }) }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(20) as usize;
        Ok(json!(handler.storage().list_hot_nodes(limit).await?))
    }
}

pub struct Tick;
#[async_trait]
impl McpTool for Tick {
    fn name(&self) -> &str { "tick" }
    fn description(&self) -> &str { "Run one thermodynamics decay + spread cycle" }
    fn input_schema(&self) -> Value { json!({ "type": "object", "properties": { "decay": { "type": "number", "default": 0.85 }, "prune_threshold": { "type": "number", "default": 0.05 } } }) }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let decay = args.get("decay").and_then(|v| v.as_f64()).unwrap_or(0.85) as f32;
        let prune = args.get("prune_threshold").and_then(|v| v.as_f64()).unwrap_or(0.05) as f32;
        crate::tick(handler.storage(), decay, prune, 20).await?;
        Ok(json!({ "ok": true }))
    }
}

pub struct GetMetrics;
#[async_trait]
impl McpTool for GetMetrics {
    fn name(&self) -> &str { "metrics" }
    fn description(&self) -> &str { "Storage and health metrics" }
    fn input_schema(&self) -> Value { json!({}) }
    async fn call(&self, handler: &McpHandler, _args: Value) -> anyhow::Result<Value> {
        let num_nodes = handler.storage().count_nodes().await?;
        let active_index_size = handler.storage().list_active_index(1000).await?.len();
        let memory_ops_count = handler.storage().memory_ops_count().await?;
        Ok(json!({ "num_nodes": num_nodes, "active_index_size": active_index_size, "memory_ops_count": memory_ops_count }))
    }
}

pub struct SyncNow;
#[async_trait]
impl McpTool for SyncNow {
    fn name(&self) -> &str { "sync_now" }
    fn description(&self) -> &str { "Force immediate push/pull sync" }
    fn input_schema(&self) -> Value { json!({}) }
    async fn call(&self, handler: &McpHandler, _args: Value) -> anyhow::Result<Value> {
        if let Ok(server_url) = std::env::var("SULCUS_SERVER_URL") {
            let api_key = std::env::var("SULCUS_API_KEY").ok();
            let engine = crate::sync_http::HttpSyncEngine::new(server_url, api_key);
            let mut client = crate::LocalSyncClient::new(handler.storage().clone());
            client.load_persisted_state().await?;
            client.pull_from_engine_and_apply(&engine, None).await?;
            client.push_to_engine(&engine).await?;
            Ok(json!({ "ok": true }))
        } else {
            anyhow::bail!("SULCUS_SERVER_URL not set")
        }
    }
}

pub struct ListMemoryOps;
#[async_trait]
impl McpTool for ListMemoryOps {
    fn name(&self) -> &str { "list_memory_ops" }
    fn description(&self) -> &str { "List ops" }
    fn input_schema(&self) -> Value { json!({}) }
    async fn call(&self, handler: &McpHandler, _args: Value) -> anyhow::Result<Value> { Ok(json!(handler.storage().list_memory_ops_internal().await?)) }
}

pub struct RecordMemoryOp;
#[async_trait]
impl McpTool for RecordMemoryOp {
    fn name(&self) -> &str { "record_memory_op" }
    fn description(&self) -> &str { "Record a custom memory op" }
    fn input_schema(&self) -> Value { json!({ "type": "object", "required": ["op_type", "payload"], "properties": { "op_type": { "type": "string" }, "payload": { "type": "object" } } }) }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let op_type = args.get("op_type").and_then(|v| v.as_str()).unwrap_or("CUSTOM");
        let default_payload = json!({});
        let payload = args.get("payload").unwrap_or(&default_payload);
        handler.storage().record_memory_op_internal(op_type, payload).await?;
        Ok(json!({ "ok": true }))
    }
}
