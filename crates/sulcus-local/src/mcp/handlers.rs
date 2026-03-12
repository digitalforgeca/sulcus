use super::types::McpTool;
use crate::mcp::McpHandler;
use crate::tokenizer::count_tokens;
use async_trait::async_trait;
use serde_json::{json, Value};
use sqlx::Row;
use sulcus_core::StorageBackend;
use uuid::Uuid;

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Strip recursive context blocks (<sulcus_context>...</sulcus_context>) to prevent
/// the system from learning its own temporary memory headers.
fn sanitize_content(content: &str) -> String {
    let mut out = content.to_string();
    while let Some(start) = out.find("<sulcus_context") {
        if let Some(end) = out[start..].find("</sulcus_context>") {
            out.replace_range(start..(start + end + 17), "");
        } else {
            out.replace_range(start.., "");
            break;
        }
    }
    out.trim().to_string()
}

pub struct AddMemory;

#[async_trait]
impl McpTool for AddMemory {
    fn name(&self) -> &str {
        "record_memory"
    }
    fn description(&self) -> &str {
        "Record text into Sulcus memory and assign to a Fold"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["content"],
            "properties": {
                "content": { "type": "string" },
                "fold_name": { "type": "string" },
                "namespace": { "type": "string", "default": "default" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let raw_content = args.get("content").and_then(|c| c.as_str()).unwrap_or("");
        let fold_name = args
            .get("fold_name")
            .and_then(|f| f.as_str())
            .unwrap_or("default");
        let namespace = args
            .get("namespace")
            .and_then(|n| n.as_str())
            .unwrap_or("default");

        let content = sanitize_content(raw_content);
        if content.is_empty() {
            return Ok(json!({ "ok": true, "status": "ignored_empty_after_sanitize" }));
        }

        let id = Uuid::now_v7();
        let pointer_summary = if content.len() > 200 {
            content.chars().take(200).collect::<String>()
        } else {
            content.clone()
        };
        let label = pointer_summary
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_string();

        let mut tx = handler.storage().pool().begin().await?;
        sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, modality, namespace, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET label = EXCLUDED.label, pointer_summary = EXCLUDED.pointer_summary, base_utility = EXCLUDED.base_utility, current_heat = EXCLUDED.current_heat, is_pinned = EXCLUDED.is_pinned, memory_type = EXCLUDED.memory_type, modality = EXCLUDED.modality, namespace = EXCLUDED.namespace"#)
            .bind(id.to_string())
            .bind(&label)
            .bind(&pointer_summary)
            .bind(0.0f32)
            .bind(1.0f32)
            .bind(false)
            .bind("episodic")
            .bind("text")
            .bind(namespace)
            .execute(&mut *tx)
            .await?;

        sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET raw_content = EXCLUDED.raw_content")
            .bind(id.to_string())
            .bind(&content)
            .execute(&mut *tx)
            .await?;

        let embedding = handler.embedder().embed(&content)?;
        if !embedding.is_empty() {
            // Use a savepoint to allow fallback if 'vector' type is missing
            sqlx::query("SAVEPOINT embedding_insert")
                .execute(&mut *tx)
                .await?;

            let emb_sql = format!(
                "[{}]",
                embedding
                    .iter()
                    .map(|v| v.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            );
            let res = sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2::vector) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                .bind(id.to_string())
                .bind(&emb_sql)
                .execute(&mut *tx)
                .await;

            if res.is_err() {
                sqlx::query("ROLLBACK TO SAVEPOINT embedding_insert")
                    .execute(&mut *tx)
                    .await?;
                // Fallback to BYTEA blob
                let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
                sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                    .bind(id.to_string())
                    .bind(bytes)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query("RELEASE SAVEPOINT embedding_insert")
                    .execute(&mut *tx)
                    .await?;
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

        handler
            .storage()
            .record_memory_op(
                "ADD",
                &json!({
                    "id": id.to_string(),
                    "label": label,
                    "pointer_summary": pointer_summary,
                    "current_heat": 1.0,
                    "memory_type": "episodic"
                }),
            )
            .await?;

        Ok(json!({ "node_id": id.to_string() }))
    }
}

pub struct GetNode;

#[async_trait]
impl McpTool for GetNode {
    fn name(&self) -> &str {
        "get_node"
    }
    fn description(&self) -> &str {
        "Fetch a node by id"
    }
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
        let node_id_s = args
            .get("node_id")
            .and_then(|x| x.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
        let node_id_v = Uuid::parse_str(node_id_s)?;
        let node_v = handler.storage().get_node(node_id_v).await?;
        Ok(json!({ "node": node_v }))
    }
}

pub struct Summarize;

#[async_trait]
impl McpTool for Summarize {
    fn name(&self) -> &str {
        "summarize"
    }
    fn description(&self) -> &str {
        "Generate a short extractive summary of text"
    }
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
        let max = args
            .get("max_chars")
            .and_then(|m| m.as_u64())
            .unwrap_or(500) as usize;

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
    fn name(&self) -> &str {
        "search_memory"
    }
    fn description(&self) -> &str {
        "Hybrid semantic search: combines cosine similarity with FTS"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": { "type": "string" },
                "limit": { "type": "number", "default": 10 },
                "memory_type": { "type": "string", "enum": ["episodic", "semantic", "preference", "procedural"] },
                "modality": { "type": "string", "enum": ["text", "image", "audio", "video", "mixed"] },
                "namespace": { "type": "string" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let q = args.get("query").and_then(|x| x.as_str()).unwrap_or("");
        let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(10) as usize;
        let type_filter = args.get("memory_type").and_then(|x| x.as_str());
        let modality_filter = args.get("modality").and_then(|x| x.as_str());
        let namespace_filter = args.get("namespace").and_then(|x| x.as_str());

        let q_emb = if !q.is_empty() {
            handler.embedder().embed(q).unwrap_or_default()
        } else {
            Vec::new()
        };
        let mut scores: std::collections::HashMap<String, (f64, f64, String, String, f32)> =
            std::collections::HashMap::new();

        if !q_emb.is_empty() {
            let vec_hits = handler
                .storage()
                .search_vectors(
                    &q_emb,
                    limit * 4,
                    namespace_filter,
                    modality_filter,
                    type_filter,
                )
                .await;
            if !vec_hits.is_empty() {
                let candidate_ids: Vec<String> =
                    vec_hits.iter().map(|(id, _)| id.to_string()).collect();
                let meta_rows = sqlx::query("SELECT id, label, pointer_summary, current_heat, memory_type, modality, namespace FROM nodes WHERE id = ANY($1)")
                    .bind(&candidate_ids)
                    .fetch_all(handler.storage().pool())
                    .await.unwrap_or_default();

                let mut meta_map: std::collections::HashMap<
                    String,
                    (String, String, f32, String, String, String),
                > = std::collections::HashMap::new();
                for r in &meta_rows {
                    let id_s: String = r.try_get("id").unwrap_or_default();
                    let lbl: String = r.try_get("label").unwrap_or_default();
                    let ps: String = r.try_get("pointer_summary").unwrap_or_default();
                    let heat: f32 = r.try_get("current_heat").unwrap_or(0.0);
                    let mtype: String = r.try_get("memory_type").unwrap_or_default();
                    let modality: String = r.try_get("modality").unwrap_or_default();
                    let namespace: String = r.try_get("namespace").unwrap_or_default();
                    meta_map.insert(id_s, (lbl, ps, heat, mtype, modality, namespace));
                }

                for (id, cos_sim) in vec_hits {
                    let id_s = id.to_string();
                    if let Some((lbl, ps, heat, _, _, _)) = meta_map.remove(&id_s) {
                        scores.insert(id_s, (cos_sim as f64 * 0.6, 0.0, lbl, ps, heat));
                    }
                }
            }
        }

        let fts_rows = if let Some(ns) = namespace_filter {
            sqlx::query(
                "SELECT n.id AS node_id, \
                 ts_rank(to_tsvector('english', n.pointer_summary), plainto_tsquery('english', $1)) AS rank \
                 FROM nodes n \
                 WHERE to_tsvector('english', n.pointer_summary) @@ plainto_tsquery('english', $1) \
                 AND n.namespace = $2 \
                 ORDER BY rank DESC LIMIT 50",
            )
            .bind(q).bind(ns)
            .fetch_all(handler.storage().pool()).await.unwrap_or_default()
        } else {
            sqlx::query(
                "SELECT n.id AS node_id, \
                 ts_rank(to_tsvector('english', n.pointer_summary), plainto_tsquery('english', $1)) AS rank \
                 FROM nodes n \
                 WHERE to_tsvector('english', n.pointer_summary) @@ plainto_tsquery('english', $1) \
                 ORDER BY rank DESC LIMIT 50",
            )
            .bind(q)
            .fetch_all(handler.storage().pool()).await.unwrap_or_default()
        };

        for r in &fts_rows {
            let id_s: String = r.try_get("node_id").unwrap_or_default();
            let rank: f64 = r.try_get::<f32, _>("rank").map(|v| v as f64).unwrap_or(0.0);
            let fts_score = rank.min(1.0);
            scores
                .entry(id_s.clone())
                .and_modify(|e| e.1 = fts_score * 0.4)
                .or_insert_with(|| {
                    (
                        0.0f64,
                        fts_score * 0.4,
                        String::new(),
                        String::new(),
                        0.0f32,
                    )
                });
        }

        let mut scored: Vec<(f64, String, String, String, f32)> = scores
            .into_iter()
            .filter_map(|(id_s, (cos, fts, label, ps, heat))| {
                let combined = cos + fts;
                if combined <= 0.0 {
                    return None;
                }
                Some((combined, id_s, label, ps, heat))
            })
            .collect();
        scored.sort_unstable_by(|a, b| {
            b.0.partial_cmp(&a.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.1.cmp(&b.1)) // Deterministic tie-breaker using UUID string
        });
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
    fn name(&self) -> &str {
        "build_context"
    }
    fn description(&self) -> &str {
        "Render hot nodes as a structured XML context block"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string" },
                "token_budget": { "type": "number", "default": 2000 },
                "format": { "type": "string", "enum": ["xml", "json"], "default": "xml" },
                "include_recent": { "type": "boolean", "default": true, "description": "Whether to include episodic/recent items. Set false to only return curated preferences, facts, and procedures." }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let prompt = args.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
        let token_budget = args
            .get("token_budget")
            .and_then(|t| t.as_u64())
            .unwrap_or(2000) as usize;
        let output_format = args.get("format").and_then(|f| f.as_str()).unwrap_or("xml");
        let include_recent = args
            .get("include_recent")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        if !prompt.is_empty() {
            if let Ok(emb) = handler.embedder().embed(prompt) {
                let _ = crate::thermodynamics::ignite(handler.storage(), &emb, 5).await;
            }
        }
        // Force a tick to apply decay/utility before rendering
        let _ = crate::tick(handler.storage(), 0.85, 0.05, handler.active_limit()).await;

        let rows = sqlx::query(
            "SELECT n.id, n.label, n.pointer_summary, ai.heat as current_heat, n.memory_type, n.created_at, p.raw_content \
             FROM nodes n \
             JOIN active_index ai ON ai.node_id = n.id \
             LEFT JOIN payloads p ON p.node_id = n.id \
             WHERE ai.heat > 0.01 \
             ORDER BY ai.heat DESC, n.id ASC LIMIT 50",        )
        .fetch_all(handler.storage().pool()).await?;

        let mut prefs: Vec<Value> = Vec::new();
        let mut facts: Vec<Value> = Vec::new();
        let mut procs: Vec<Value> = Vec::new();
        let mut recent: Vec<Value> = Vec::new();
        let mut seen_content = std::collections::HashSet::new();
        let mut used_tokens: usize = 0;
        let tag_overhead: usize = 200;
        let effective_budget = token_budget.saturating_sub(tag_overhead);

        for r in &rows {
            if used_tokens >= effective_budget {
                break;
            }
            let mtype: String = r
                .try_get("memory_type")
                .unwrap_or_else(|_| "episodic".to_string());
            let _heat: f32 = r.try_get("current_heat").unwrap_or(0.0);
            let ps: String = r.try_get("pointer_summary").unwrap_or_default();
            let content: Option<String> = r.try_get("raw_content").ok().flatten();
            let text = content.unwrap_or_else(|| ps.clone());

            // FILTER: Skip anything that looks like a SULCUS context block
            if text.contains("<sulcus_context") || text.contains("{\"sulcus_context\"") {
                continue;
            }

            // FILTER: Skip raw conversation JSON dumps (escaped message envelopes)
            // These are raw turns that haven't been distilled into useful memories
            if text.contains(r#"[{"type":"text"#)
                || text.contains(r#"[{\"type\":\"text\""#)
                || text.contains(r#"[{&quot;type&quot;:&quot;text&quot;"#)
                || text.contains("\"message_id\":")
                || text.contains("Conversation info (untrusted metadata)")
                || (text.starts_with("user: [") && text.contains("\"type\""))
                || (text.starts_with("assistant: [") && text.contains("\"type\""))
            {
                continue;
            }

            // FILTER: Skip items that are mostly escaped entities (sign of raw JSON)
            let entity_count = text.matches("&quot;").count()
                + text.matches("&amp;").count()
                + text.matches("&lt;").count()
                + text.matches("&gt;").count();
            if entity_count > 5 {
                continue;
            }

            // DEDUPLICATE: Skip if we've already included this semantic content
            let normalized = text.to_lowercase().trim().to_string();
            if seen_content.contains(&normalized) {
                continue;
            }
            seen_content.insert(normalized);

            let snippet = if text.chars().count() > 500 {
                format!("{}…", text.chars().take(500).collect::<String>())
            } else {
                text.clone()
            };

            let item_val = json!({
                "id": r.try_get::<String, _>("id").unwrap_or_default(),
                "text": snippet,
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default()
            });

            let token_cost = if output_format == "xml" {
                count_tokens(&format!(
                    "<item id=\"{}\">{}</item>",
                    r.try_get::<String, _>("id").unwrap_or_default(),
                    snippet
                ))
            } else {
                count_tokens(&serde_json::to_string(&item_val).unwrap_or_default())
            };

            if used_tokens + token_cost > effective_budget {
                continue;
            }
            used_tokens += token_cost;

            match mtype.as_str() {
                "preference" => prefs.push(item_val),
                "semantic" => facts.push(item_val),
                "procedural" => procs.push(item_val),
                _ => {
                    if include_recent {
                        recent.push(item_val);
                    }
                    // When include_recent is false, skip episodic items entirely
                }
            }
        }

        if output_format == "json" {
            let mut sulcus_context = json!({
                "preferences": prefs,
                "facts": facts,
                "procedures": procs,
                "recent": recent
            });
            // Sort for determinism and Prompt Caching stability (Append-only behavior via created_at ASC)
            if let Some(map) = sulcus_context.as_object_mut() {
                for key in ["preferences", "facts", "procedures", "recent"] {
                    if let Some(arr) = map.get_mut(key).and_then(|a| a.as_array_mut()) {
                        arr.sort_by(|a, b| {
                            a["created_at"]
                                .as_str()
                                .cmp(&b["created_at"].as_str())
                                .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
                        });
                    }
                }
            }
            return Ok(json!({ "sulcus_context": sulcus_context }));
        }

        // XML Format (Default)
        let render_items = |mut items: Vec<Value>| -> String {
            // Sort for determinism and Prompt Caching stability (Append-only behavior via created_at ASC)
            items.sort_by(|a, b| {
                a["created_at"]
                    .as_str()
                    .cmp(&b["created_at"].as_str())
                    .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
            });
            items
                .iter()
                .map(|v| {
                    format!(
                        "    <item id=\"{}\">{}</item>",
                        v["id"].as_str().unwrap_or(""),
                        xml_escape(v["text"].as_str().unwrap_or(""))
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        };

        let xml = format!(
            r#"<sulcus_context token_budget="{token_budget}">
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
</sulcus_context>"#,
            render_items(prefs),
            render_items(facts),
            render_items(procs),
            render_items(recent)
        );

        Ok(json!({
            "context": xml,
            "token_estimate": used_tokens + tag_overhead
        }))
    }
}

pub struct CommitImage;
#[async_trait]
impl McpTool for CommitImage {
    fn name(&self) -> &str {
        "commit_image"
    }
    fn description(&self) -> &str {
        "Commit an image to memory by embedding its content via CLIP/Vision model"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["image_path", "label"],
            "properties": {
                "image_path": { "type": "string", "description": "Local path to the image file" },
                "label": { "type": "string", "description": "A short descriptive label for the image" },
                "pointer_summary": { "type": "string", "description": "A longer description of the image content" },
                "source_mime": { "type": "string", "description": "Mime type (e.g. image/png)" },
                "namespace": { "type": "string", "default": "default" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let path = args
            .get("image_path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing image_path"))?;
        let label = args
            .get("label")
            .and_then(|v| v.as_str())
            .unwrap_or("image");
        let ps = args
            .get("pointer_summary")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let source_mime = args.get("source_mime").and_then(|v| v.as_str());
        let namespace = args
            .get("namespace")
            .and_then(|v| v.as_str())
            .unwrap_or("default");

        let id = Uuid::now_v7();
        let mut tx = handler.storage().pool().begin().await?;

        let mut final_ps = ps.to_string();
        let mut embedding = Vec::new();

        // Structured Multimodal Pre-processing:
        // Use Vision LLM to describe image first, then embed description.
        // This provides higher semantic density than raw CLIP.
        if let Ok(desc) = crate::folds::abstractive_describe_image(path).await {
            if final_ps.is_empty() {
                final_ps = desc.clone();
            } else {
                final_ps = format!("{ps}\n\nVision Analysis: {desc}");
            }
            // Embed the structured text description instead of raw pixels
            if let Ok(emb) = handler.embedder().embed(&final_ps) {
                embedding = emb;
            }
        }

        // Fallback to raw CLIP if vision extraction failed or was skipped
        if embedding.is_empty() {
            if let Ok(emb) = handler.embedder().embed_image(path) {
                embedding = emb;
            }
        }

        sqlx::query("INSERT INTO nodes (id, label, pointer_summary, memory_type, modality, source_mime, namespace, current_heat) VALUES ($1, $2, $3, $4, $5, $6, $7, 1.0) ON CONFLICT(id) DO UPDATE SET label = EXCLUDED.label, pointer_summary = EXCLUDED.pointer_summary, memory_type = EXCLUDED.memory_type, modality = EXCLUDED.modality, source_mime = EXCLUDED.source_mime, namespace = EXCLUDED.namespace, current_heat = 1.0")
            .bind(id.to_string()).bind(label).bind(&final_ps).bind("episodic").bind("image").bind(source_mime).bind(namespace).execute(&mut *tx).await?;

        if !embedding.is_empty() {
            sqlx::query("SAVEPOINT embedding_insert")
                .execute(&mut *tx)
                .await?;
            let emb_sql = format!(
                "[{}]",
                embedding
                    .iter()
                    .map(|v| v.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            );
            let res = sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2::vector) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                .bind(id.to_string())
                .bind(&emb_sql)
                .execute(&mut *tx)
                .await;

            if res.is_err() {
                sqlx::query("ROLLBACK TO SAVEPOINT embedding_insert")
                    .execute(&mut *tx)
                    .await?;
                let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
                sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                    .bind(id.to_string())
                    .bind(bytes)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query("RELEASE SAVEPOINT embedding_insert")
                    .execute(&mut *tx)
                    .await?;
            }
        }
        tx.commit().await?;
        handler
            .storage()
            .record_memory_op_internal(
                "ADD",
                &json!({
                    "id": id.to_string(),
                    "label": label,
                    "pointer_summary": ps,
                    "current_heat": 1.0,
                    "memory_type": "episodic",
                    "modality": "image",
                    "source_mime": source_mime,
                    "namespace": namespace
                }),
            )
            .await?;
        let _ = crate::tick(handler.storage(), 0.85, 0.05, handler.active_limit()).await;
        Ok(json!({ "node_id": id.to_string() }))
    }
}

pub struct CommitMemory;
#[async_trait]
impl McpTool for CommitMemory {
    fn name(&self) -> &str {
        "commit_memory"
    }
    fn description(&self) -> &str {
        "Explicitly upsert a node with label and summary"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["label", "pointer_summary"],
            "properties": {
                "label": { "type": "string" },
                "pointer_summary": { "type": "string" },
                "raw_content": { "type": "string" },
                "memory_type": { "type": "string", "enum": ["episodic", "semantic", "preference", "procedural"] },
                "modality": { "type": "string", "enum": ["text", "image", "audio", "video", "mixed"], "default": "text" },
                "source_mime": { "type": "string" },
                "namespace": { "type": "string", "default": "default" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let label = args.get("label").and_then(|v| v.as_str()).unwrap_or("");
        let raw_ps = args
            .get("pointer_summary")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let raw_content = args
            .get("raw_content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let mtype = args
            .get("memory_type")
            .and_then(|v| v.as_str())
            .unwrap_or("episodic");
        let modality = args
            .get("modality")
            .and_then(|v| v.as_str())
            .unwrap_or("text");
        let source_mime = args.get("source_mime").and_then(|v| v.as_str());
        let namespace = args
            .get("namespace")
            .and_then(|v| v.as_str())
            .unwrap_or("default");

        let ps = sanitize_content(raw_ps);
        let content = sanitize_content(raw_content);

        let id = Uuid::now_v7();
        let mut tx = handler.storage().pool().begin().await?;
        sqlx::query("INSERT INTO nodes (id, label, pointer_summary, memory_type, modality, source_mime, namespace, current_heat) VALUES ($1, $2, $3, $4, $5, $6, $7, 1.0) ON CONFLICT(id) DO UPDATE SET label = EXCLUDED.label, pointer_summary = EXCLUDED.pointer_summary, memory_type = EXCLUDED.memory_type, modality = EXCLUDED.modality, source_mime = EXCLUDED.source_mime, namespace = EXCLUDED.namespace, current_heat = 1.0")
            .bind(id.to_string())
            .bind(label)
            .bind(&ps)
            .bind(mtype)
            .bind(modality)
            .bind(source_mime)
            .bind(namespace)
            .execute(&mut *tx)
            .await?;

        if !content.is_empty() {
            sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET raw_content = EXCLUDED.raw_content")
                .bind(id.to_string()).bind(&content).execute(&mut *tx).await?;
        }

        let et = if !ps.is_empty() { &ps } else { &content };
        if !et.is_empty() {
            if let Ok(emb) = handler.embedder().embed(et) {
                if !emb.is_empty() {
                    // Use a savepoint to allow fallback if 'vector' type is missing
                    sqlx::query("SAVEPOINT embedding_insert")
                        .execute(&mut *tx)
                        .await?;

                    let emb_sql = format!(
                        "[{}]",
                        emb.iter()
                            .map(|v| v.to_string())
                            .collect::<Vec<_>>()
                            .join(",")
                    );
                    let res = sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2::vector) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                        .bind(id.to_string())
                        .bind(&emb_sql)
                        .execute(&mut *tx)
                        .await;

                    if res.is_err() {
                        sqlx::query("ROLLBACK TO SAVEPOINT embedding_insert")
                            .execute(&mut *tx)
                            .await?;
                        let bytes: Vec<u8> = emb.iter().flat_map(|f| f.to_le_bytes()).collect();
                        sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                            .bind(id.to_string())
                            .bind(bytes)
                            .execute(&mut *tx)
                            .await?;
                    } else {
                        sqlx::query("RELEASE SAVEPOINT embedding_insert")
                            .execute(&mut *tx)
                            .await?;
                    }
                }
            }
        }
        tx.commit().await?;
        handler
            .storage()
            .record_memory_op_internal(
                "ADD",
                &json!({
                    "id": id.to_string(),
                    "label": label,
                    "pointer_summary": ps,
                    "current_heat": 1.0,
                    "memory_type": mtype,
                    "modality": modality,
                    "source_mime": source_mime,
                    "namespace": namespace
                }),
            )
            .await?;
        let _ = crate::tick(handler.storage(), 0.85, 0.05, handler.active_limit()).await;
        Ok(json!({ "node_id": id.to_string() }))
    }
}

pub struct SearchByImage;

#[async_trait]
impl McpTool for SearchByImage {
    fn name(&self) -> &str {
        "search_by_image"
    }
    fn description(&self) -> &str {
        "Search for similar memories using an image as query (Vision/CLIP)"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["image_path"],
            "properties": {
                "image_path": { "type": "string", "description": "Local path to the query image" },
                "limit": { "type": "number", "default": 10 },
                "namespace": { "type": "string" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let path = args
            .get("image_path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing image_path"))?;
        let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(10) as usize;
        let namespace_filter = args.get("namespace").and_then(|x| x.as_str());

        let q_emb = handler.embedder().embed_image(path)?;
        if q_emb.is_empty() {
            return Ok(json!({ "results": [] }));
        }

        let vec_hits = handler
            .storage()
            .search_vectors(&q_emb, limit * 2, namespace_filter, Some("image"), None)
            .await;
        if vec_hits.is_empty() {
            return Ok(json!({ "results": [] }));
        }

        let candidate_ids: Vec<String> = vec_hits.iter().map(|(id, _)| id.to_string()).collect();
        let meta_rows = sqlx::query("SELECT id, label, pointer_summary, current_heat, modality, namespace FROM nodes WHERE id = ANY($1)")
            .bind(&candidate_ids)
            .fetch_all(handler.storage().pool())
            .await?;

        let mut meta_map: std::collections::HashMap<String, (String, String, f32, String, String)> =
            std::collections::HashMap::new();
        for r in &meta_rows {
            let id_s: String = r.try_get("id").unwrap_or_default();
            let lbl: String = r.try_get("label").unwrap_or_default();
            let ps: String = r.try_get("pointer_summary").unwrap_or_default();
            let heat: f32 = r.try_get("current_heat").unwrap_or(0.0);
            let modality: String = r.try_get("modality").unwrap_or_default();
            let namespace: String = r.try_get("namespace").unwrap_or_default();
            meta_map.insert(id_s, (lbl, ps, heat, modality, namespace));
        }

        let mut results = Vec::new();
        for (id, score) in vec_hits {
            let id_s = id.to_string();
            if let Some((lbl, ps, heat, modality, _)) = meta_map.remove(&id_s) {
                results.push(json!({
                    "id": id_s,
                    "label": lbl,
                    "pointer_summary": ps,
                    "heat": heat,
                    "modality": modality,
                    "score": score
                }));
            }
        }

        results.truncate(limit);
        Ok(json!({ "results": results }))
    }
}

pub struct UpdateMemory;
#[async_trait]
impl McpTool for UpdateMemory {
    fn name(&self) -> &str {
        "update_memory"
    }
    fn description(&self) -> &str {
        "Update specific fields of a node via HLC-based CRDT Patch"
    }
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
                "is_pinned": { "type": "boolean" },
                "memory_type": { "type": "string", "enum": ["episodic", "semantic", "preference", "procedural"] },
                "modality": { "type": "string", "enum": ["text", "image", "audio", "video", "mixed"] },
                "source_mime": { "type": "string" },
                "namespace": { "type": "string" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let id_s = args
            .get("node_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
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
        if let Some(raw_ps) = args.get("pointer_summary").and_then(|v| v.as_str()) {
            let ps = sanitize_content(raw_ps);
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
        if let Some(mt) = args.get("memory_type").and_then(|v| v.as_str()) {
            let prev = clocks.get("memory_type").copied();
            let clock = sulcus_core::crdt::Hlc::now(actor_id, prev);
            patch = patch.with_memory_type(mt, clock);
        }
        if let Some(mo) = args.get("modality").and_then(|v| v.as_str()) {
            let prev = clocks.get("modality").copied();
            let clock = sulcus_core::crdt::Hlc::now(actor_id, prev);
            patch = patch.with_modality(mo, clock);
        }
        if let Some(sm) = args
            .get("source_mime")
            .map(|v| v.as_str().map(|s| s.to_string()))
        {
            let prev = clocks.get("source_mime").copied();
            let clock = sulcus_core::crdt::Hlc::now(actor_id, prev);
            patch = patch.with_source_mime(sm, clock);
        }
        if let Some(ns) = args.get("namespace").and_then(|v| v.as_str()) {
            let prev = clocks.get("namespace").copied();
            let clock = sulcus_core::crdt::Hlc::now(actor_id, prev);
            patch = patch.with_namespace(ns, clock);
        }

        let mut re_embed = false;
        if let Some(raw) = args.get("raw_content").and_then(|v| v.as_str()) {
            let content = sanitize_content(raw);
            handler.storage().insert_payload(id, &content).await?;
            re_embed = true;
        }
        if args.get("pointer_summary").is_some() {
            re_embed = true;
        }

        if let Some(mut existing) = handler.storage().get_node(id).await? {
            if patch.apply_to_with_clocks(&mut existing, &mut clocks) {
                handler.storage().upsert_node(existing.clone()).await?;
                handler.storage().set_crdt_clocks(id, &clocks).await?;

                // If content or summary changed, re-embed and store
                if re_embed {
                    let et = if !existing.pointer_summary.is_empty() {
                        existing.pointer_summary.clone()
                    } else {
                        handler.storage().get_payload(id).await?.unwrap_or_default()
                    };
                    if !et.is_empty() {
                        if let Ok(emb) = handler.embedder().embed(&et) {
                            handler.storage().store_node_embedding(id, emb).await?;
                        }
                    }
                }

                // Record the PATCH operation in the WAL for sync
                handler
                    .storage()
                    .record_memory_op_internal("PATCH", &serde_json::to_value(&patch)?)
                    .await?;
            }
        }

        Ok(json!({ "ok": true }))
    }
}

pub struct ForgetMemory;
#[async_trait]
impl McpTool for ForgetMemory {
    fn name(&self) -> &str {
        "forget_memory"
    }
    fn description(&self) -> &str {
        "Hard-delete a node and its related records"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["node_id"],
            "properties": { "node_id": { "type": "string", "format": "uuid" }, "purge_cold": { "type": "boolean", "default": false } }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let id_s = args
            .get("node_id")
            .and_then(|x| x.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing id"))?;
        let _id = Uuid::parse_str(id_s)?;
        let purge = args
            .get("purge_cold")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);

        let mut tx = handler.storage().pool().begin().await?;
        sqlx::query("DELETE FROM embeddings WHERE node_id = $1")
            .bind(id_s)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM payloads WHERE node_id = $1")
            .bind(id_s)
            .execute(&mut *tx)
            .await?;
        if purge {
            sqlx::query("DELETE FROM cold_storage WHERE node_id = $1")
                .bind(id_s)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("DELETE FROM nodes WHERE id = $1")
            .bind(id_s)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        handler
            .storage()
            .record_memory_op_internal("FORGET", &json!({ "node_id": id_s, "purge_cold": purge }))
            .await?;
        Ok(json!({ "ok": true }))
    }
}

pub struct ListHotNodes;
#[async_trait]
impl McpTool for ListHotNodes {
    fn name(&self) -> &str {
        "list_hot_nodes"
    }
    fn description(&self) -> &str {
        "List most relevant nodes"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": { "limit": { "type": "number", "default": 20 }, "namespace": { "type": "string" } } })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(20) as usize;
        let ns = args.get("namespace").and_then(|v| v.as_str());

        if let Some(namespace) = ns {
            let rows = sqlx::query("SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, modality, source_mime, namespace FROM nodes WHERE namespace = $1 ORDER BY current_heat DESC LIMIT $2")
                .bind(namespace)
                .bind(limit as i64)
                .fetch_all(handler.storage().pool()).await?;
            let mut out = Vec::new();
            for r in rows {
                out.push(sulcus_core::Node {
                    id: Uuid::parse_str(&r.get::<String, _>("id"))?,
                    label: r.get("label"),
                    pointer_summary: r.get("pointer_summary"),
                    base_utility: r.get("base_utility"),
                    current_heat: r.get("current_heat"),
                    is_pinned: r.get("is_pinned"),
                    memory_type: r.get("memory_type"),
                    modality: r.get("modality"),
                    source_mime: r.get("source_mime"),
                    namespace: r.get("namespace"),
                });
            }
            Ok(json!(out))
        } else {
            Ok(json!(handler.storage().list_hot_nodes(limit).await?))
        }
    }
}

pub struct Tick;
#[async_trait]
impl McpTool for Tick {
    fn name(&self) -> &str {
        "tick"
    }
    fn description(&self) -> &str {
        "Run one thermodynamics decay + spread cycle"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": { "decay": { "type": "number", "default": 0.85 }, "prune_threshold": { "type": "number", "default": 0.05 } } })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let decay = args.get("decay").and_then(|v| v.as_f64()).unwrap_or(0.85) as f32;
        let prune = args
            .get("prune_threshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.05) as f32;
        crate::tick(handler.storage(), decay, prune, handler.active_limit()).await?;
        Ok(json!({ "ok": true }))
    }
}

pub struct GetMetrics;
#[async_trait]
impl McpTool for GetMetrics {
    fn name(&self) -> &str {
        "metrics"
    }
    fn description(&self) -> &str {
        "Storage and health metrics"
    }
    fn input_schema(&self) -> Value {
        json!({})
    }
    async fn call(&self, handler: &McpHandler, _args: Value) -> anyhow::Result<Value> {
        let num_nodes = handler.storage().count_nodes().await?;
        let active_index_size = handler.storage().list_active_index(1000).await?.len();
        let memory_ops_count = handler.storage().memory_ops_count().await?;
        Ok(
            json!({ "num_nodes": num_nodes, "active_index_size": active_index_size, "memory_ops_count": memory_ops_count }),
        )
    }
}

pub struct SyncNow;
#[async_trait]
impl McpTool for SyncNow {
    fn name(&self) -> &str {
        "sync_now"
    }
    fn description(&self) -> &str {
        "Force immediate push/pull sync"
    }
    fn input_schema(&self) -> Value {
        json!({})
    }
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
    fn name(&self) -> &str {
        "list_memory_ops"
    }
    fn description(&self) -> &str {
        "List ops"
    }
    fn input_schema(&self) -> Value {
        json!({})
    }
    async fn call(&self, handler: &McpHandler, _args: Value) -> anyhow::Result<Value> {
        Ok(json!(handler.storage().list_memory_ops_internal().await?))
    }
}

pub struct PruneColdMemories;
#[async_trait::async_trait]
impl McpTool for PruneColdMemories {
    fn name(&self) -> &str {
        "prune_cold_memories"
    }
    fn description(&self) -> &str {
        "Run thermodynamic pruning passes until no cold nodes remain (max 5 passes)"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "decay": { "type": "number", "default": 0.85 },
                "prune_threshold": { "type": "number", "default": 0.05 }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let decay = args.get("decay").and_then(|v| v.as_f64()).unwrap_or(0.85) as f32;
        let prune_threshold = args
            .get("prune_threshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.05) as f32;

        let initial_hot = handler.storage().list_active_index(1000).await?.len() as i64;

        for _ in 0..5 {
            let active = handler.storage().list_active_index(1000).await?;
            let mut cold_found = false;
            for (_, heat) in active {
                if heat < prune_threshold {
                    cold_found = true;
                    break;
                }
            }
            if !cold_found {
                break;
            }
            crate::thermodynamics::tick(
                handler.storage(),
                decay,
                prune_threshold,
                handler.active_limit(),
            )
            .await?;
        }

        let remaining_hot = handler.storage().list_active_index(1000).await?.len() as i64;
        let pruned_count = (initial_hot - remaining_hot).max(0);
        Ok(json!({ "pruned_count": pruned_count, "remaining_hot": remaining_hot }))
    }
}

pub struct CompactMemory;
#[async_trait]
impl McpTool for CompactMemory {
    fn name(&self) -> &str {
        "compact_memory"
    }
    fn description(&self) -> &str {
        "Semantically compact cold nodes using the local LLM summarizer (Ollama). \
         Nodes below fold_threshold heat are condensed and paged to cold_storage."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "fold_threshold": {
                    "type": "number",
                    "default": 0.3,
                    "description": "Heat level below which nodes are eligible for folding"
                }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let threshold = args
            .get("fold_threshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.3) as f32;
        let folded = crate::folds::fold_cold_nodes(handler.storage(), threshold).await?;
        Ok(json!({ "folded": folded, "fold_threshold": threshold }))
    }
}

pub struct UpgradeToTeam;
#[async_trait]
impl McpTool for UpgradeToTeam {
    fn name(&self) -> &str {
        "upgrade_to_team"
    }
    fn description(&self) -> &str {
        "Returns the URL to upgrade SULCUS to the Team tier ($299/mo) for cloud sync and remote MCP."
    }
    fn input_schema(&self) -> Value {
        json!({})
    }
    async fn call(&self, _handler: &McpHandler, _args: Value) -> anyhow::Result<Value> {
        let public_url = std::env::var("SULCUS_PUBLIC_URL")
            .unwrap_or_else(|_| "http://sulcus.dforge.ca".to_string());

        Ok(json!({
            "status": "success",
            "url": format!("{}/dashboard/billing", public_url),
            "message": "Visit this URL in your browser to complete the upgrade."
        }))
    }
}

pub struct RecordMemoryOp;
#[async_trait]
impl McpTool for RecordMemoryOp {
    fn name(&self) -> &str {
        "record_memory_op"
    }
    fn description(&self) -> &str {
        "Record a custom memory op"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["op_type", "payload"], "properties": { "op_type": { "type": "string" }, "payload": { "type": "object" } } })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let op_type = args
            .get("op_type")
            .and_then(|v| v.as_str())
            .unwrap_or("CUSTOM");
        let default_payload = json!({});
        let payload = args.get("payload").unwrap_or(&default_payload);
        handler
            .storage()
            .record_memory_op_internal(op_type, payload)
            .await?;
        Ok(json!({ "ok": true }))
    }
}

pub struct PageIn;
#[async_trait]
impl McpTool for PageIn {
    fn name(&self) -> &str {
        "page_in"
    }
    fn description(&self) -> &str {
        "Manually promote a cold node: restores heat=1.0 and active_index membership."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["node_id"],
            "properties": { "node_id": { "type": "string", "format": "uuid" } }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        use sulcus_core::mmu::PageFaultHandler;
        let id_s = args
            .get("node_id")
            .and_then(|x| x.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
        let id = Uuid::parse_str(id_s)?;
        let node = handler.storage().on_page_fault(id).await?;
        Ok(json!({ "node": node }))
    }
}

pub struct CompactWal;
#[async_trait]
impl McpTool for CompactWal {
    fn name(&self) -> &str {
        "compact_wal"
    }
    fn description(&self) -> &str {
        "Compact the WAL by removing synced ops up to the horizon."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "up_to_seq": { "type": "number" } }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        use sulcus_core::sync::WalCompactor;
        let horizon = if let Some(seq) = args.get("up_to_seq").and_then(|x| x.as_i64()) {
            seq
        } else {
            handler.storage().compaction_horizon().await?
        };
        let rows_deleted = handler.storage().compact(horizon).await?;
        Ok(json!({ "rows_deleted": rows_deleted, "horizon": horizon }))
    }
}

pub struct GetServerCursor;
#[async_trait]
impl McpTool for GetServerCursor {
    fn name(&self) -> &str {
        "get_server_cursor"
    }
    fn description(&self) -> &str {
        "Get the last synced server cursor string"
    }
    fn input_schema(&self) -> Value {
        json!({})
    }
    async fn call(&self, handler: &McpHandler, _args: Value) -> anyhow::Result<Value> {
        let cursor = handler.storage().get_server_cursor().await?;
        Ok(json!({ "cursor": cursor }))
    }
}

pub struct SetServerCursor;
#[async_trait]
impl McpTool for SetServerCursor {
    fn name(&self) -> &str {
        "set_server_cursor"
    }
    fn description(&self) -> &str {
        "Set the last synced server cursor string"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": { "cursor": { "type": "string" } } })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let cursor = args.get("cursor").and_then(|v| v.as_str());
        handler.storage().set_server_cursor(cursor).await?;
        Ok(json!({ "ok": true }))
    }
}

pub struct GetLastSeq;
#[async_trait]
impl McpTool for GetLastSeq {
    fn name(&self) -> &str {
        "get_last_seq"
    }
    fn description(&self) -> &str {
        "Get the last processed WAL sequence number"
    }
    fn input_schema(&self) -> Value {
        json!({})
    }
    async fn call(&self, handler: &McpHandler, _args: Value) -> anyhow::Result<Value> {
        let seq = handler.storage().get_last_seq().await?;
        Ok(json!({ "seq": seq }))
    }
}

pub struct SetLastSeq;
#[async_trait]
impl McpTool for SetLastSeq {
    fn name(&self) -> &str {
        "set_last_seq"
    }
    fn description(&self) -> &str {
        "Set the last processed WAL sequence number"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": { "seq": { "type": "number" } } })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let seq = args.get("seq").and_then(|v| v.as_i64());
        handler.storage().set_last_seq(seq).await?;
        Ok(json!({ "ok": true }))
    }
}
