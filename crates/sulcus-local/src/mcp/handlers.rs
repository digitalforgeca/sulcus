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

/// Sanitize content before recording to memory.
/// Strips recursive context blocks and rejects raw conversation JSON dumps.
/// Returns empty string for content that should not be stored.
fn sanitize_content(content: &str) -> String {
    // Strip sulcus_context blocks (recursion prevention)
    let mut out = content.to_string();
    while let Some(start) = out.find("<sulcus_context") {
        if let Some(end) = out[start..].find("</sulcus_context>") {
            out.replace_range(start..(start + end + 17), "");
        } else {
            out.replace_range(start.., "");
            break;
        }
    }
    let out = out.trim().to_string();

    // Reject raw conversation JSON dumps — these are the #1 source of junk nodes
    if out.contains(r#""type":"text""#)
        || out.contains("Conversation info (untrusted metadata)")
        || out.contains("[cron:")
        || out.contains(r#""sender_id""#)
        || out.contains(r#""chat_type""#)
        || out.contains(r#""message_id""#)
    {
        return String::new();
    }

    // Reject role-prefixed raw turns (user: [...], assistant: [...])
    if (out.starts_with("user: [")
        || out.starts_with("assistant: [")
        || out.starts_with("system: ["))
        && out.contains(r#""type""#)
    {
        return String::new();
    }

    // Reject content that's mostly JSON structural characters
    let json_chars = out
        .chars()
        .filter(|c| matches!(c, '{' | '}' | '[' | ']' | '"'))
        .count();
    let total = out.chars().count().max(1);
    if total > 50 && json_chars as f64 / total as f64 > 0.15 {
        return String::new();
    }

    out
}

pub struct AddMemory;

#[async_trait]
impl McpTool for AddMemory {
    fn name(&self) -> &str {
        "record_memory"
    }
    fn description(&self) -> &str {
        "Record text into Sulcus memory. Supports Markdown formatting for structured content. You control the memory type, decay rate, importance, and key details at creation time."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["content"],
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Memory content. Supports Markdown formatting — use headers, lists, and emphasis to structure key points and details. Well-formatted memories are more useful when recalled."
                },
                "memory_type": {
                    "type": "string",
                    "enum": ["episodic", "semantic", "preference", "procedural", "fact", "moment"],
                    "default": "episodic",
                    "description": "Memory type. episodic=events/conversations (fast decay), semantic=facts/knowledge (slow decay), preference=settings/opinions (slower), procedural=workflows/how-tos (slowest), moment=significant interactions (slow, high heat)."
                },
                "decay_class": {
                    "type": "string",
                    "enum": ["fast", "normal", "slow", "glacial"],
                    "default": "normal",
                    "description": "Decay speed override. fast=hours, normal=days, slow=weeks, glacial=months. Overrides the default for the memory_type."
                },
                "is_pinned": {
                    "type": "boolean",
                    "default": false,
                    "description": "Pin this memory to prevent decay entirely. Use for critical preferences, identity info, and core procedures."
                },
                "min_heat": {
                    "type": "number",
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "description": "Floor heat value — memory will never decay below this. 0.0 = can fully decay, 0.5 = always at least warm."
                },
                "initial_heat": {
                    "type": "number",
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "default": 1.0,
                    "description": "Starting heat. 1.0 = hot (immediately prominent), lower values for background knowledge."
                },
                "key_points": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Key takeaways from this memory. Stored as structured metadata for better recall and context building."
                },
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
        let memory_type = args
            .get("memory_type")
            .and_then(|m| m.as_str())
            .unwrap_or("episodic");
        let decay_class = args
            .get("decay_class")
            .and_then(|d| d.as_str())
            .unwrap_or("normal");
        let is_pinned = args
            .get("is_pinned")
            .and_then(|p| p.as_bool())
            .unwrap_or(false);
        let min_heat: Option<f32> = args
            .get("min_heat")
            .and_then(|m| m.as_f64())
            .map(|v| v as f32);
        let initial_heat = args
            .get("initial_heat")
            .and_then(|h| h.as_f64())
            .unwrap_or(1.0) as f32;
        let key_points: Option<Vec<String>> = args
            .get("key_points")
            .and_then(|kp| serde_json::from_value(kp.clone()).ok());

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

        // Build the full content: if key_points provided, append them as structured Markdown
        let full_content = if let Some(ref kps) = key_points {
            let kp_section = kps
                .iter()
                .map(|kp| format!("- {kp}"))
                .collect::<Vec<_>>()
                .join("\n");
            format!("{content}\n\n**Key Points:**\n{kp_section}")
        } else {
            content.clone()
        };

        let mut tx = handler.storage().pool().begin().await?;
        sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, modality, namespace, decay_class, stability, min_heat, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET label = EXCLUDED.label, pointer_summary = EXCLUDED.pointer_summary, base_utility = EXCLUDED.base_utility, current_heat = EXCLUDED.current_heat, is_pinned = EXCLUDED.is_pinned, memory_type = EXCLUDED.memory_type, modality = EXCLUDED.modality, namespace = EXCLUDED.namespace, decay_class = EXCLUDED.decay_class, stability = EXCLUDED.stability, min_heat = EXCLUDED.min_heat"#)
            .bind(id.to_string())
            .bind(&label)
            .bind(&pointer_summary)
            .bind(0.0f32)
            .bind(initial_heat)
            .bind(is_pinned)
            .bind(memory_type)
            .bind("text")
            .bind(namespace)
            .bind(decay_class)
            .bind(1.0f32) // initial stability
            .bind(min_heat)
            .execute(&mut *tx)
            .await?;

        sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET raw_content = EXCLUDED.raw_content")
            .bind(id.to_string())
            .bind(&full_content)
            .execute(&mut *tx)
            .await?;

        let embedding = handler.embedder().embed(&full_content)?;
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

        // Update in-memory HNSW index so the new node is searchable immediately
        if !embedding.is_empty() {
            handler.storage().add_to_hnsw(id, &embedding);
        }

        // Ignite heat for the new node so it's immediately active
        handler.storage().set_active_index(id, initial_heat).await?;

        handler
            .storage()
            .record_memory_op(
                "ADD",
                &json!({
                    "id": id.to_string(),
                    "label": label,
                    "pointer_summary": pointer_summary,
                    "current_heat": initial_heat,
                    "memory_type": memory_type,
                    "decay_class": decay_class,
                    "is_pinned": is_pinned,
                }),
            )
            .await?;

        // Evaluate on_store triggers
        let trigger_ctx = crate::triggers::TriggerContext {
            node_id: Some(id.to_string()),
            node_label: Some(pointer_summary.clone()),
            node_namespace: Some(namespace.to_string()),
            node_memory_type: Some(memory_type.to_string()),
            node_heat: Some(initial_heat),
            old_heat: None,
        };
        let trigger_results = crate::triggers::evaluate_triggers(
            handler.storage().pool(),
            crate::triggers::TriggerEvent::OnStore,
            &trigger_ctx,
        )
        .await;
        let notifications = crate::triggers::collect_notifications(&trigger_results);

        let mut result = json!({
            "node_id": id.to_string(),
            "memory_type": memory_type,
            "decay_class": decay_class,
            "is_pinned": is_pinned,
            "initial_heat": initial_heat,
            "min_heat": min_heat,
            "has_key_points": key_points.is_some(),
        });
        if !trigger_results.is_empty() {
            result["triggers_fired"] = json!(trigger_results.len());
        }
        if !notifications.is_empty() {
            result["trigger_notifications"] = json!(notifications);
        }

        Ok(result)
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
                "memory_type": { "type": "string", "enum": ["episodic", "semantic", "preference", "procedural", "fact"] },
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

        // Evaluate on_recall triggers for top results
        let mut all_notifications = Vec::new();
        for res in results.iter().take(3) {
            let trigger_ctx = crate::triggers::TriggerContext {
                node_id: res.get("id").and_then(|v| v.as_str()).map(String::from),
                node_label: res.get("label").and_then(|v| v.as_str()).map(String::from),
                node_namespace: None,
                node_memory_type: None,
                node_heat: res.get("heat").and_then(|v| v.as_f64()).map(|v| v as f32),
                old_heat: None,
            };
            let trigger_results = crate::triggers::evaluate_triggers(
                handler.storage().pool(),
                crate::triggers::TriggerEvent::OnRecall,
                &trigger_ctx,
            )
            .await;
            all_notifications.extend(crate::triggers::collect_notifications(&trigger_results));
        }

        let mut response = json!({ "results": results });
        if !all_notifications.is_empty() {
            response["trigger_notifications"] = json!(all_notifications);
        }
        Ok(response)
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
            "SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.memory_type, n.created_at, p.raw_content \
             FROM nodes n \
             LEFT JOIN payloads p ON p.node_id = n.id \
             WHERE n.current_heat > 0.01 \
             ORDER BY n.current_heat DESC, n.id ASC LIMIT 50",
        )
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

            // ── QUALITY FILTERS ──
            // Goal: only inject distilled, human-readable memories.
            // Reject raw conversation dumps, JSON blobs, context blocks, and noise.

            // Skip sulcus context blocks (recursion prevention)
            if text.contains("<sulcus_context") || text.contains("{\"sulcus_context\"") {
                continue;
            }

            // Skip raw conversation JSON dumps (any encoding variant)
            if text.contains(r#"[{"type":"text"#)
                || text.contains(r#"[{\"type\":\"text\""#)
                || text.contains(r#"{"type":"text"#)
                || text.contains("\"message_id\":")
                || text.contains("Conversation info (untrusted metadata)")
                || text.contains("[cron:")
                || text.contains("\"sender_id\":")
                || text.contains("\"chat_type\":")
            {
                continue;
            }

            // Skip items with role prefixes (raw turn dumps from conversations)
            if text.starts_with("user: ")
                || text.starts_with("assistant: ")
                || text.starts_with("system: ")
            {
                continue;
            }

            // Skip HTML-entity-heavy content (sign of double-encoded JSON)
            let entity_count = text.matches("&quot;").count()
                + text.matches("&amp;").count()
                + text.matches("&lt;").count()
                + text.matches("&gt;").count();
            if entity_count > 2 {
                continue;
            }

            // Skip content that's mostly JSON-like (high ratio of structural chars)
            let json_chars = text
                .chars()
                .filter(|c| matches!(c, '{' | '}' | '[' | ']' | '"'))
                .count();
            let total_chars = text.chars().count().max(1);
            if json_chars as f64 / total_chars as f64 > 0.15 {
                continue;
            }

            // Skip very short items (likely fragments or noise)
            if text.trim().len() < 10 {
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
                "semantic" | "fact" => facts.push(item_val),
                "procedural" => procs.push(item_val),
                _ => {
                    if include_recent {
                        recent.push(item_val);
                    }
                    // When include_recent is false, skip episodic items entirely
                }
            }
        }

        // ── TRIGGERS: fetch active triggers + recent fires for context injection ──
        let active_triggers = sqlx::query(
            "SELECT name, event, action, \
                    COALESCE(filter_memory_type, '') as filter_memory_type, \
                    COALESCE(filter_namespace, '') as filter_namespace, \
                    fire_count \
             FROM triggers WHERE enabled = true ORDER BY created_at ASC LIMIT 20",
        )
        .fetch_all(handler.storage().pool())
        .await
        .unwrap_or_default();

        let recent_fires = sqlx::query(
            "SELECT tl.event, tl.action, tl.node_id, tl.fired_at, \
                    COALESCE(n.label, '') as node_label \
             FROM trigger_log tl \
             LEFT JOIN nodes n ON n.id::text = tl.node_id \
             ORDER BY tl.fired_at DESC LIMIT 10",
        )
        .fetch_all(handler.storage().pool())
        .await
        .unwrap_or_default();

        let trigger_items: Vec<Value> = active_triggers
            .iter()
            .map(|r| {
                json!({
                    "name": r.try_get::<String, _>("name").unwrap_or_default(),
                    "event": r.try_get::<String, _>("event").unwrap_or_default(),
                    "action": r.try_get::<String, _>("action").unwrap_or_default(),
                    "filter_type": r.try_get::<String, _>("filter_memory_type").unwrap_or_default(),
                    "filter_ns": r.try_get::<String, _>("filter_namespace").unwrap_or_default(),
                    "fires": r.try_get::<i32, _>("fire_count").unwrap_or(0),
                })
            })
            .collect();

        let fire_items: Vec<Value> = recent_fires
            .iter()
            .map(|r| {
                json!({
                    "event": r.try_get::<String, _>("event").unwrap_or_default(),
                    "action": r.try_get::<String, _>("action").unwrap_or_default(),
                    "node": r.try_get::<String, _>("node_label").unwrap_or_default(),
                    "at": r.try_get::<String, _>("fired_at").unwrap_or_default(),
                })
            })
            .collect();

        if output_format == "json" {
            let mut sulcus_context = json!({
                "preferences": prefs,
                "facts": facts,
                "procedures": procs,
                "recent": recent,
                "active_triggers": trigger_items,
                "recent_fires": fire_items,
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

        let render_triggers = |triggers: &[Value]| -> String {
            if triggers.is_empty() {
                return "    <none />".to_string();
            }
            triggers
                .iter()
                .map(|t| {
                    let filter = if !t["filter_type"].as_str().unwrap_or("").is_empty()
                        || !t["filter_ns"].as_str().unwrap_or("").is_empty()
                    {
                        format!(
                            " filter=\"{}{}\"",
                            t["filter_type"].as_str().unwrap_or(""),
                            if !t["filter_ns"].as_str().unwrap_or("").is_empty() {
                                format!("@{}", t["filter_ns"].as_str().unwrap_or(""))
                            } else {
                                String::new()
                            }
                        )
                    } else {
                        String::new()
                    };
                    format!(
                        "    <trigger name=\"{}\" event=\"{}\" action=\"{}\" fires=\"{}\"{} />",
                        xml_escape(t["name"].as_str().unwrap_or("")),
                        t["event"].as_str().unwrap_or(""),
                        t["action"].as_str().unwrap_or(""),
                        t["fires"].as_i64().unwrap_or(0),
                        filter
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        };

        let render_fires = |fires: &[Value]| -> String {
            if fires.is_empty() {
                return "    <none />".to_string();
            }
            fires
                .iter()
                .map(|f| {
                    format!(
                        "    <fire event=\"{}\" action=\"{}\" node=\"{}\" at=\"{}\" />",
                        f["event"].as_str().unwrap_or(""),
                        f["action"].as_str().unwrap_or(""),
                        xml_escape(f["node"].as_str().unwrap_or("")),
                        f["at"].as_str().unwrap_or("")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        };

        let xml = format!(
            r#"<sulcus_context token_budget="{token_budget}">
  <cheatsheet>
    You have Sulcus — persistent memory with reactive triggers.
    STORE:    record_memory (quick), commit_memory (with summary/type)
    FIND:     search_memory (keyword/semantic), list_hot_nodes (most relevant now)
    RECALL:   page_in (pull a cold memory back into active context)
    MANAGE:   memory_boost / memory_deprecate / memory_relate / memory_reclassify /
              update_memory / forget_memory
    PIN:      Set is_pinned=true to make a memory permanent (immune to decay).
    TRIGGERS: create_trigger to set reactive rules on your memory graph:
              Events:  on_store, on_recall, on_decay, on_boost, on_relate, on_threshold
              Actions: notify (surface message), boost, pin, tag, deprecate, webhook
              Filters: memory_type, namespace, label_pattern, heat_above/below
              Example: "Pin anything I search for" → on_recall + pin
              Example: "Notify me when procedures are stored" → on_store + notify + filter=procedural
              Example: "Webhook Slack on deployment memories" → on_store + webhook + label_pattern=deploy
              Manage:  list_triggers, update_trigger, delete_trigger, trigger_history
              Triggers fire automatically. When one fires during a tool call, you'll see
              trigger_notifications in the response. Act on them when relevant.
    TYPES:    episodic (fast fade), semantic (slow), preference, procedural (slowest), moment
    Below is your active context. Search for deeper recall. Unlimited storage.
  </cheatsheet>
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
  <active_triggers>
{}
  </active_triggers>
  <recent_trigger_fires>
{}
  </recent_trigger_fires>
</sulcus_context>"#,
            render_items(prefs),
            render_items(facts),
            render_items(procs),
            render_items(recent),
            render_triggers(&trigger_items),
            render_fires(&fire_items)
        );

        // Return XML as a plain string (not wrapped in JSON).
        // The MCP handler will annotate this with audience=["assistant"]
        // so clients inject it into the system prompt, invisible to the user.
        Ok(Value::String(xml))
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
                "memory_type": { "type": "string", "enum": ["episodic", "semantic", "preference", "procedural", "fact"] },
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
                "memory_type": { "type": "string", "enum": ["episodic", "semantic", "preference", "procedural", "fact"] },
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
        let node_uuid = Uuid::parse_str(id_s)?;

        let mut patch = sulcus_core::crdt::NodePatch::new(node_uuid);
        let actor_id = handler.storage().get_or_create_client_id().await?;

        // Load existing clocks to generate monotonic updates
        let mut clocks = handler.storage().get_crdt_clocks(node_uuid).await?;

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
            handler
                .storage()
                .insert_payload(node_uuid, &content)
                .await?;
            re_embed = true;
        }
        if args.get("pointer_summary").is_some() {
            re_embed = true;
        }

        if let Some(mut existing) = handler.storage().get_node(node_uuid).await? {
            if patch.apply_to_with_clocks(&mut existing, &mut clocks) {
                handler.storage().upsert_node(existing.clone()).await?;
                handler
                    .storage()
                    .set_crdt_clocks(node_uuid, &clocks)
                    .await?;

                // If content or summary changed, re-embed and store
                if re_embed {
                    let et = if !existing.pointer_summary.is_empty() {
                        existing.pointer_summary.clone()
                    } else {
                        handler
                            .storage()
                            .get_payload(node_uuid)
                            .await?
                            .unwrap_or_default()
                    };
                    if !et.is_empty() {
                        if let Ok(emb) = handler.embedder().embed(&et) {
                            handler
                                .storage()
                                .store_node_embedding(node_uuid, emb)
                                .await?;
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
        let node_uuid = Uuid::parse_str(id_s)?;
        let node = handler.storage().on_page_fault(node_uuid).await?;
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

// ─── Agent Self-Modification Tools ──────────────────────────────────────────
// These tools let agents actively participate in memory management.

/// memory_boost: agent says "remember this strongly" — boosts heat + stability.
pub struct MemoryBoost;

#[async_trait]
impl McpTool for MemoryBoost {
    fn name(&self) -> &str {
        "memory_boost"
    }
    fn description(&self) -> &str {
        "Boost a memory's importance. Increases heat and stability, making it persist longer and appear more readily in context. Use when a memory is particularly important or the user explicitly says to remember something."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["node_id"],
            "properties": {
                "node_id": { "type": "string", "format": "uuid", "description": "The memory node to boost" },
                "strength": { "type": "number", "description": "Boost strength 0.1-1.0 (default 0.3)", "minimum": 0.1, "maximum": 1.0 }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let id_s = args
            .get("node_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
        let _id = Uuid::parse_str(id_s)?; // validate UUID format
        let strength = args.get("strength").and_then(|v| v.as_f64()).unwrap_or(0.3) as f32;
        let strength = strength.clamp(0.1, 1.0);

        let pool = handler.storage().pool();
        let row: Option<(f32, f32)> = sqlx::query_as(
            "SELECT current_heat, COALESCE(stability, 1.0) FROM nodes WHERE id = $1",
        )
        .bind(id_s)
        .fetch_optional(pool)
        .await?;

        let (old_heat, old_stability) = row.ok_or_else(|| anyhow::anyhow!("node not found"))?;
        let new_heat = (old_heat + strength).min(1.0);
        let new_stability = old_stability * (1.0 + strength);

        sqlx::query(
            "UPDATE nodes SET current_heat = $1, stability = $2, last_accessed_at = NOW() WHERE id = $3",
        )
        .bind(new_heat)
        .bind(new_stability)
        .bind(id_s)
        .execute(pool)
        .await?;

        // Evaluate on_boost triggers
        let trigger_ctx = crate::triggers::TriggerContext {
            node_id: Some(id_s.to_string()),
            node_label: None,
            node_namespace: None,
            node_memory_type: None,
            node_heat: Some(new_heat),
            old_heat: Some(old_heat),
        };
        let trigger_results = crate::triggers::evaluate_triggers(
            handler.storage().pool(),
            crate::triggers::TriggerEvent::OnBoost,
            &trigger_ctx,
        )
        .await;
        let notifications = crate::triggers::collect_notifications(&trigger_results);

        let mut result = json!({
            "ok": true,
            "node_id": id_s,
            "heat_before": old_heat,
            "heat_after": new_heat,
            "stability_before": old_stability,
            "stability_after": new_stability,
        });
        if !notifications.is_empty() {
            result["trigger_notifications"] = json!(notifications);
        }

        Ok(result)
    }
}

/// memory_deprecate: agent says "this is getting stale" — accelerates decay.
pub struct MemoryDeprecate;

#[async_trait]
impl McpTool for MemoryDeprecate {
    fn name(&self) -> &str {
        "memory_deprecate"
    }
    fn description(&self) -> &str {
        "Mark a memory as stale or less relevant. Reduces heat and stability, causing it to decay faster and appear less in context. Use when information is becoming outdated but shouldn't be deleted."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["node_id"],
            "properties": {
                "node_id": { "type": "string", "format": "uuid", "description": "The memory node to deprecate" },
                "reason": { "type": "string", "description": "Why this memory is being deprecated" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let id_s = args
            .get("node_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
        let _id = Uuid::parse_str(id_s)?; // validate UUID format

        let pool = handler.storage().pool();
        let row: Option<(f32, f32)> = sqlx::query_as(
            "SELECT current_heat, COALESCE(stability, 1.0) FROM nodes WHERE id = $1",
        )
        .bind(id_s)
        .fetch_optional(pool)
        .await?;

        let (old_heat, old_stability) = row.ok_or_else(|| anyhow::anyhow!("node not found"))?;
        let new_heat = (old_heat * 0.5).max(0.01);
        let new_stability = (old_stability * 0.3).max(0.1);

        sqlx::query(
            "UPDATE nodes SET current_heat = $1, stability = $2, decay_class = 'volatile' WHERE id = $3",
        )
        .bind(new_heat)
        .bind(new_stability)
        .bind(id_s)
        .execute(pool)
        .await?;

        Ok(json!({
            "ok": true,
            "node_id": id_s,
            "heat_before": old_heat,
            "heat_after": new_heat,
            "stability_before": old_stability,
            "stability_after": new_stability,
            "decay_class": "volatile",
        }))
    }
}

/// memory_relate: agent creates edges between concepts.
pub struct MemoryRelate;

#[async_trait]
impl McpTool for MemoryRelate {
    fn name(&self) -> &str {
        "memory_relate"
    }
    fn description(&self) -> &str {
        "Create a relationship between two memory nodes. This enables heat diffusion between related concepts — when one is recalled, the other warms up too. Use when you discover a connection between facts, preferences, or episodes."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["source_id", "target_id"],
            "properties": {
                "source_id": { "type": "string", "format": "uuid", "description": "The source memory node" },
                "target_id": { "type": "string", "format": "uuid", "description": "The target memory node" },
                "label": { "type": "string", "description": "Relationship label (e.g. 'related_to', 'contradicts', 'extends')" },
                "weight": { "type": "number", "description": "Edge weight 0.0-1.0 (default 0.5)", "minimum": 0.0, "maximum": 1.0 },
                "bidirectional": { "type": "boolean", "description": "Create edge in both directions (default true)" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let src_s = args
            .get("source_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing source_id"))?;
        let tgt_s = args
            .get("target_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing target_id"))?;
        let _src = Uuid::parse_str(src_s)?; // validate UUID format
        let _tgt = Uuid::parse_str(tgt_s)?; // validate UUID format
        let label = args
            .get("label")
            .and_then(|v| v.as_str())
            .unwrap_or("related_to");
        let weight = args.get("weight").and_then(|v| v.as_f64()).unwrap_or(0.5) as f32;
        let weight = weight.clamp(0.0, 1.0);
        let bidirectional = args
            .get("bidirectional")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let pool = handler.storage().pool();
        let edge_id = Uuid::new_v4();

        sqlx::query(
            "INSERT INTO edges (id, source_id, target_id, edge_label, edge_weight, valid_from)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (source_id, target_id) WHERE valid_to IS NULL
             DO UPDATE SET edge_weight = $5, edge_label = $4",
        )
        .bind(edge_id.to_string())
        .bind(src_s)
        .bind(tgt_s)
        .bind(label)
        .bind(weight)
        .execute(pool)
        .await?;

        let mut edges_created = 1;

        if bidirectional {
            let rev_id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO edges (id, source_id, target_id, edge_label, edge_weight, valid_from)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (source_id, target_id) WHERE valid_to IS NULL
                 DO UPDATE SET edge_weight = $5, edge_label = $4",
            )
            .bind(rev_id.to_string())
            .bind(tgt_s)
            .bind(src_s)
            .bind(label)
            .bind(weight)
            .execute(pool)
            .await?;
            edges_created = 2;
        }

        // Evaluate on_relate triggers for both nodes
        for nid in &[src_s, tgt_s] {
            let trigger_ctx = crate::triggers::TriggerContext {
                node_id: Some(nid.to_string()),
                node_label: None,
                node_namespace: None,
                node_memory_type: None,
                node_heat: None,
                old_heat: None,
            };
            let _ = crate::triggers::evaluate_triggers(
                handler.storage().pool(),
                crate::triggers::TriggerEvent::OnRelate,
                &trigger_ctx,
            )
            .await;
        }

        Ok(json!({
            "ok": true,
            "source_id": src_s,
            "target_id": tgt_s,
            "label": label,
            "weight": weight,
            "bidirectional": bidirectional,
            "edges_created": edges_created,
        }))
    }
}

/// memory_reclassify: agent changes a memory's type (e.g. episodic → semantic).
pub struct MemoryReclassify;

#[async_trait]
impl McpTool for MemoryReclassify {
    fn name(&self) -> &str {
        "memory_reclassify"
    }
    fn description(&self) -> &str {
        "Change a memory's type classification. This affects its decay rate — episodic memories fade fastest, procedural slowest. Use when a fact has proven its worth and should persist longer (e.g., promoting an episodic observation to a semantic fact)."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["node_id", "new_type"],
            "properties": {
                "node_id": { "type": "string", "format": "uuid" },
                "new_type": {
                    "type": "string",
                    "enum": ["episodic", "semantic", "preference", "procedural", "synthesis"],
                    "description": "New memory type. episodic=24h, semantic=30d, preference=90d, procedural=180d half-life."
                },
                "reason": { "type": "string", "description": "Why the reclassification is warranted" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let id_s = args
            .get("node_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing node_id"))?;
        let _id = Uuid::parse_str(id_s)?; // validate UUID format
        let new_type = args
            .get("new_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing new_type"))?;

        // Validate
        match new_type {
            "episodic" | "semantic" | "preference" | "procedural" | "fact" | "synthesis" => {}
            _ => return Err(anyhow::anyhow!("invalid memory_type: {}", new_type)),
        }

        let pool = handler.storage().pool();
        let old_type: Option<(String,)> =
            sqlx::query_as("SELECT memory_type FROM nodes WHERE id = $1")
                .bind(id_s)
                .fetch_optional(pool)
                .await?;

        let (old,) = old_type.ok_or_else(|| anyhow::anyhow!("node not found"))?;

        sqlx::query("UPDATE nodes SET memory_type = $1 WHERE id = $2")
            .bind(new_type)
            .bind(id_s)
            .execute(pool)
            .await?;

        Ok(json!({
            "ok": true,
            "node_id": id_s,
            "old_type": old,
            "new_type": new_type,
        }))
    }
}

/// configure_thermodynamics: agent reads/writes the thermo config.
pub struct ConfigureThermodynamics;

#[async_trait]
impl McpTool for ConfigureThermodynamics {
    fn name(&self) -> &str {
        "configure_thermodynamics"
    }
    fn description(&self) -> &str {
        "View or adjust the thermodynamic engine configuration. Without arguments, returns the current config with all decay profiles, resonance settings, and tick parameters. With arguments, updates specific settings."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["get", "set"],
                    "description": "get = read current config, set = update config"
                },
                "config": {
                    "type": "object",
                    "description": "Partial ThermoConfig JSON to merge (only for action=set)"
                }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("get");

        match action {
            "get" => {
                // Read persisted config from local DB, fall back to defaults
                let pool = handler.storage().pool();
                let row: Option<(serde_json::Value,)> =
                    sqlx::query_as("SELECT config FROM thermo_config WHERE tenant_id = 'local'")
                        .fetch_optional(pool)
                        .await
                        .ok()
                        .flatten();
                let config: sulcus_core::thermo::ThermoConfig = match row {
                    Some((val,)) => serde_json::from_value(val).unwrap_or_default(),
                    None => sulcus_core::thermo::ThermoConfig::default(),
                };
                Ok(json!({ "config": config }))
            }
            "set" => {
                let config_val = args
                    .get("config")
                    .ok_or_else(|| anyhow::anyhow!("missing config for action=set"))?;
                // Validate by deserializing
                let config: sulcus_core::thermo::ThermoConfig =
                    serde_json::from_value(config_val.clone())?;
                // Persist to local DB
                let pool = handler.storage().pool();
                sqlx::query(
                    "INSERT INTO thermo_config (tenant_id, config, updated_at) \
                     VALUES ('local', $1, NOW()) \
                     ON CONFLICT (tenant_id) DO UPDATE SET config = $1, updated_at = NOW()",
                )
                .bind(serde_json::to_value(&config)?)
                .execute(pool)
                .await?;
                Ok(json!({
                    "ok": true,
                    "config": config,
                    "note": "Config persisted. Worker will pick up changes within ~10 ticks."
                }))
            }
            _ => Err(anyhow::anyhow!("unknown action: {}", action)),
        }
    }
}

// ─── Trigger Tools ──────────────────────────────────────────────────────────
// First-of-kind: reactive memory triggers. No other memory system has these.

/// create_trigger: define a reactive rule on memory events.
pub struct CreateTrigger;

#[async_trait]
impl McpTool for CreateTrigger {
    fn name(&self) -> &str {
        "create_trigger"
    }
    fn description(&self) -> &str {
        "Create a reactive memory trigger. Triggers fire automatically when memory events occur. For example: auto-pin important memories when stored, boost recall of related context, send webhooks on decay, or surface notifications when specific topics appear. This is your proactive memory management — set rules and let Sulcus enforce them."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["event", "action"],
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Human-readable name for this trigger"
                },
                "description": {
                    "type": "string",
                    "description": "What this trigger does and why"
                },
                "event": {
                    "type": "string",
                    "enum": ["on_recall", "on_decay", "on_store", "on_boost", "on_relate", "on_threshold"],
                    "description": "When to fire: on_recall (memory searched), on_decay (heat dropped), on_store (new memory created), on_boost (memory boosted), on_relate (edge created), on_threshold (heat crosses boundary)"
                },
                "action": {
                    "type": "string",
                    "enum": ["notify", "boost", "pin", "tag", "deprecate", "webhook"],
                    "description": "What to do: notify (surface message), boost (increase heat), pin (prevent decay), tag (add label), deprecate (accelerate decay), webhook (HTTP callback)"
                },
                "action_config": {
                    "type": "object",
                    "description": "Action-specific config. notify: {\"message\": \"...\"}, boost: {\"strength\": 0.5}, tag: {\"label\": \"...\"}, webhook: {\"url\": \"...\"}"
                },
                "filter_memory_type": {
                    "type": "string",
                    "enum": ["episodic", "semantic", "preference", "procedural", "fact", "moment"],
                    "description": "Only fire for this memory type"
                },
                "filter_namespace": {
                    "type": "string",
                    "description": "Only fire for memories in this namespace"
                },
                "filter_label_pattern": {
                    "type": "string",
                    "description": "Only fire for memories whose label matches this pattern (case-insensitive contains)"
                },
                "filter_heat_below": {
                    "type": "number",
                    "description": "For on_threshold: fire when heat drops below this value"
                },
                "filter_heat_above": {
                    "type": "number",
                    "description": "For on_threshold: fire when heat rises above this value"
                },
                "max_fires": {
                    "type": "integer",
                    "description": "Maximum number of times this trigger can fire (null = unlimited)"
                },
                "cooldown_seconds": {
                    "type": "integer",
                    "description": "Minimum seconds between firings (0 = no cooldown)"
                }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let event = args
            .get("event")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing event"))?;
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing action"))?;

        // Validate event and action
        event.parse::<crate::triggers::TriggerEvent>()
            .map_err(|_| anyhow::anyhow!("invalid event: {}. Valid: on_recall, on_decay, on_store, on_boost, on_relate, on_threshold", event))?;
        action
            .parse::<crate::triggers::TriggerAction>()
            .map_err(|_| {
                anyhow::anyhow!(
                    "invalid action: {}. Valid: notify, boost, pin, tag, deprecate, webhook",
                    action
                )
            })?;

        let id = Uuid::now_v7().to_string();
        let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let description = args
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let action_config = args.get("action_config").cloned().unwrap_or(json!({}));
        let filter_memory_type = args.get("filter_memory_type").and_then(|v| v.as_str());
        let filter_namespace = args.get("filter_namespace").and_then(|v| v.as_str());
        let filter_label_pattern = args.get("filter_label_pattern").and_then(|v| v.as_str());
        let filter_heat_below = args
            .get("filter_heat_below")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32);
        let filter_heat_above = args
            .get("filter_heat_above")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32);
        let max_fires = args
            .get("max_fires")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32);
        let cooldown_seconds = args
            .get("cooldown_seconds")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let namespace = args
            .get("namespace")
            .and_then(|v| v.as_str())
            .unwrap_or("default");

        let pool = handler.storage().pool();
        sqlx::query(
            r#"INSERT INTO triggers (id, namespace, name, description, event, action, action_config,
               filter_memory_type, filter_namespace, filter_label_pattern,
               filter_heat_below, filter_heat_above, max_fires, cooldown_seconds)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)"#,
        )
        .bind(&id)
        .bind(namespace)
        .bind(name)
        .bind(description)
        .bind(event)
        .bind(action)
        .bind(&action_config)
        .bind(filter_memory_type)
        .bind(filter_namespace)
        .bind(filter_label_pattern)
        .bind(filter_heat_below)
        .bind(filter_heat_above)
        .bind(max_fires)
        .bind(cooldown_seconds)
        .execute(pool)
        .await?;

        Ok(json!({
            "ok": true,
            "trigger_id": id,
            "name": name,
            "event": event,
            "action": action,
            "message": format!("Trigger '{}' created: {} → {}", name, event, action)
        }))
    }
}

/// list_triggers: see all active triggers for this namespace.
pub struct ListTriggers;

#[async_trait]
impl McpTool for ListTriggers {
    fn name(&self) -> &str {
        "list_triggers"
    }
    fn description(&self) -> &str {
        "List all memory triggers. Shows what reactive rules are active, their events, actions, fire counts, and whether they're enabled. Use to audit your memory automation."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "include_disabled": {
                    "type": "boolean",
                    "description": "Include disabled triggers (default: false)"
                },
                "event_filter": {
                    "type": "string",
                    "description": "Filter by event type"
                }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let include_disabled = args
            .get("include_disabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let event_filter = args.get("event_filter").and_then(|v| v.as_str());

        let pool = handler.storage().pool();

        let mut query = String::from(
            "SELECT id, namespace, name, description, enabled, event, action, action_config, \
             filter_memory_type, filter_namespace, filter_label_pattern, \
             filter_heat_below, filter_heat_above, max_fires, fire_count, \
             cooldown_seconds, last_fired_at, created_at \
             FROM triggers WHERE 1=1",
        );
        if !include_disabled {
            query.push_str(" AND enabled = TRUE");
        }
        if let Some(ev) = event_filter {
            query.push_str(&format!(" AND event = '{}'", ev.replace('\'', "''")));
        }
        query.push_str(" ORDER BY created_at DESC");

        let rows = sqlx::query(&query).fetch_all(pool).await?;

        let triggers: Vec<Value> = rows.iter().map(|r| {
            json!({
                "id": r.try_get::<String, _>("id").unwrap_or_default(),
                "namespace": r.try_get::<String, _>("namespace").unwrap_or_default(),
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "description": r.try_get::<String, _>("description").unwrap_or_default(),
                "enabled": r.try_get::<bool, _>("enabled").unwrap_or(true),
                "event": r.try_get::<String, _>("event").unwrap_or_default(),
                "action": r.try_get::<String, _>("action").unwrap_or_default(),
                "action_config": r.try_get::<serde_json::Value, _>("action_config").unwrap_or(json!({})),
                "filters": {
                    "memory_type": r.try_get::<Option<String>, _>("filter_memory_type").unwrap_or(None),
                    "namespace": r.try_get::<Option<String>, _>("filter_namespace").unwrap_or(None),
                    "label_pattern": r.try_get::<Option<String>, _>("filter_label_pattern").unwrap_or(None),
                    "heat_below": r.try_get::<Option<f32>, _>("filter_heat_below").unwrap_or(None),
                    "heat_above": r.try_get::<Option<f32>, _>("filter_heat_above").unwrap_or(None),
                },
                "max_fires": r.try_get::<Option<i32>, _>("max_fires").unwrap_or(None),
                "fire_count": r.try_get::<i32, _>("fire_count").unwrap_or(0),
                "cooldown_seconds": r.try_get::<i32, _>("cooldown_seconds").unwrap_or(0),
                "last_fired_at": r.try_get::<Option<String>, _>("last_fired_at").unwrap_or(None),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
            })
        }).collect();

        Ok(json!({
            "triggers": triggers,
            "count": triggers.len(),
        }))
    }
}

/// delete_trigger: remove a trigger.
pub struct DeleteTrigger;

#[async_trait]
impl McpTool for DeleteTrigger {
    fn name(&self) -> &str {
        "delete_trigger"
    }
    fn description(&self) -> &str {
        "Delete a memory trigger by ID. Also removes its firing history."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["trigger_id"],
            "properties": {
                "trigger_id": {
                    "type": "string",
                    "description": "The trigger ID to delete"
                }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let id = args
            .get("trigger_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing trigger_id"))?;

        let pool = handler.storage().pool();
        let result = sqlx::query("DELETE FROM triggers WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Ok(json!({"ok": false, "error": "trigger not found"}));
        }

        Ok(json!({
            "ok": true,
            "deleted": id,
        }))
    }
}

/// update_trigger: modify a trigger (enable/disable, change config, etc.)
pub struct UpdateTrigger;

#[async_trait]
impl McpTool for UpdateTrigger {
    fn name(&self) -> &str {
        "update_trigger"
    }
    fn description(&self) -> &str {
        "Update an existing trigger. Enable/disable it, change the action config, adjust filters, or modify limits."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["trigger_id"],
            "properties": {
                "trigger_id": { "type": "string", "description": "The trigger ID to update" },
                "enabled": { "type": "boolean", "description": "Enable or disable the trigger" },
                "name": { "type": "string", "description": "New name" },
                "action_config": { "type": "object", "description": "New action config" },
                "max_fires": { "type": "integer", "description": "New max fires limit" },
                "cooldown_seconds": { "type": "integer", "description": "New cooldown" },
                "reset_fire_count": { "type": "boolean", "description": "Reset fire_count to 0" }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let id = args
            .get("trigger_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing trigger_id"))?;

        let pool = handler.storage().pool();

        // Build dynamic update
        let mut sets = Vec::new();
        let mut bind_idx = 1;

        if args.get("enabled").is_some() {
            sets.push(format!("enabled = ${}", bind_idx));
            bind_idx += 1;
        }
        if args.get("name").is_some() {
            sets.push(format!("name = ${}", bind_idx));
            bind_idx += 1;
        }
        if args.get("action_config").is_some() {
            sets.push(format!("action_config = ${}", bind_idx));
            bind_idx += 1;
        }
        if args.get("max_fires").is_some() {
            sets.push(format!("max_fires = ${}", bind_idx));
            bind_idx += 1;
        }
        if args.get("cooldown_seconds").is_some() {
            sets.push(format!("cooldown_seconds = ${}", bind_idx));
            // bind_idx not incremented — last dynamic bind before static SQL
        }
        if args
            .get("reset_fire_count")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            sets.push("fire_count = 0".to_string());
        }
        sets.push("updated_at = NOW()".to_string());

        if sets.is_empty() {
            return Ok(json!({"ok": false, "error": "nothing to update"}));
        }

        // For simplicity, use a straightforward query approach
        // Update individual fields that are present
        if let Some(enabled) = args.get("enabled").and_then(|v| v.as_bool()) {
            sqlx::query("UPDATE triggers SET enabled = $1, updated_at = NOW() WHERE id = $2")
                .bind(enabled)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(name) = args.get("name").and_then(|v| v.as_str()) {
            sqlx::query("UPDATE triggers SET name = $1, updated_at = NOW() WHERE id = $2")
                .bind(name)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(config) = args.get("action_config") {
            sqlx::query("UPDATE triggers SET action_config = $1, updated_at = NOW() WHERE id = $2")
                .bind(config)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(mf) = args.get("max_fires").and_then(|v| v.as_i64()) {
            sqlx::query("UPDATE triggers SET max_fires = $1, updated_at = NOW() WHERE id = $2")
                .bind(mf as i32)
                .bind(id)
                .execute(pool)
                .await?;
        }
        if let Some(cs) = args.get("cooldown_seconds").and_then(|v| v.as_i64()) {
            sqlx::query(
                "UPDATE triggers SET cooldown_seconds = $1, updated_at = NOW() WHERE id = $2",
            )
            .bind(cs as i32)
            .bind(id)
            .execute(pool)
            .await?;
        }
        if args
            .get("reset_fire_count")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            sqlx::query("UPDATE triggers SET fire_count = 0, updated_at = NOW() WHERE id = $1")
                .bind(id)
                .execute(pool)
                .await?;
        }

        Ok(json!({
            "ok": true,
            "trigger_id": id,
            "message": "Trigger updated"
        }))
    }
}

/// trigger_history: see what triggers have fired and when.
pub struct TriggerHistory;

#[async_trait]
impl McpTool for TriggerHistory {
    fn name(&self) -> &str {
        "trigger_history"
    }
    fn description(&self) -> &str {
        "View trigger firing history. Shows which triggers fired, when, what event caused them, what action was taken, and the result. Useful for debugging and auditing your memory automation."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "trigger_id": {
                    "type": "string",
                    "description": "Filter by specific trigger ID (optional)"
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results (default 20)"
                }
            }
        })
    }
    async fn call(&self, handler: &McpHandler, args: Value) -> anyhow::Result<Value> {
        let trigger_id = args.get("trigger_id").and_then(|v| v.as_str());
        let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20) as i32;

        let pool = handler.storage().pool();

        let rows: Vec<(
            String,
            String,
            String,
            Option<String>,
            String,
            serde_json::Value,
            String,
        )> = if let Some(tid) = trigger_id {
            sqlx::query_as(
                "SELECT id, trigger_id, event, node_id, action, action_result, fired_at \
                 FROM trigger_log WHERE trigger_id = $1 ORDER BY fired_at DESC LIMIT $2",
            )
            .bind(tid)
            .bind(limit)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as(
                "SELECT id, trigger_id, event, node_id, action, action_result, fired_at \
                 FROM trigger_log ORDER BY fired_at DESC LIMIT $1",
            )
            .bind(limit)
            .fetch_all(pool)
            .await?
        };

        let entries: Vec<Value> = rows
            .iter()
            .map(|(id, tid, event, node_id, action, result, fired_at)| {
                json!({
                    "id": id,
                    "trigger_id": tid,
                    "event": event,
                    "node_id": node_id,
                    "action": action,
                    "result": result,
                    "fired_at": fired_at,
                })
            })
            .collect();

        Ok(json!({
            "history": entries,
            "count": entries.len(),
        }))
    }
}
