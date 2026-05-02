use anyhow::Context;
use base64::Engine as _;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use crate::LocalStorage;

use sulcus_types::folds::{ExportEdge, ExportNode, FoldPayload, FOLD_BATCH, FOLD_SUMMARY_MAX};
use sulcus_core::folds::{
    extractive_summarize_fallback, parse_link_line, parse_markdown_export, render_nodes_to_markdown,
    summarize_prompt,
};

#[async_trait::async_trait]
pub trait FoldStorage: Send + Sync {
    async fn get_cold_storage(&self, node_id: Uuid) -> anyhow::Result<Option<(String, String)>>;
    async fn evict_to_cold_storage(&self, node_id: Uuid, final_heat: f32) -> anyhow::Result<()>;
}

/// Export a named fold to a JSON file. Includes nodes, payloads, vectors and edges
pub async fn export_fold(
    storage: &LocalStorage,
    fold_name: &str,
    file_path: &str,
) -> anyhow::Result<()> {
    // resolve fold id
    let row = sqlx::query("SELECT id FROM folds WHERE name = $1")
        .bind(fold_name)
        .fetch_optional(storage.pool())
        .await?;

    let fold_id = if let Some(r) = row {
        r.try_get::<String, _>("id")?
    } else {
        return Err(anyhow::anyhow!("fold not found: {}", fold_name));
    };

    // gather node ids in fold
    let rows = sqlx::query("SELECT node_id FROM node_folds WHERE fold_id = $1")
        .bind(&fold_id)
        .fetch_all(storage.pool())
        .await?;

    let node_ids: Vec<String> = rows
        .into_iter()
        .filter_map(|r| r.try_get::<String, _>("node_id").ok())
        .collect();

    if node_ids.is_empty() {
        // write empty fold payload
        let payload = FoldPayload {
            name: fold_name.to_string(),
            nodes: Vec::new(),
            edges: Vec::new(),
        };
        let s = serde_json::to_string_pretty(&payload)?;
        std::fs::write(file_path, s)?;
        return Ok(());
    }

    // fetch nodes + payloads + embeddings
    let mut nodes: Vec<ExportNode> = Vec::with_capacity(node_ids.len());
    for nid in node_ids.iter() {
        let node_row = sqlx::query(
            "SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned, \
             COALESCE(memory_type, 'episodic') AS memory_type, modality, source_mime, namespace FROM nodes WHERE id = $1",
        )
        .bind(nid)
        .fetch_one(storage.pool())
        .await?;
        let id: String = node_row.try_get("id")?;
        let label: String = node_row.try_get("label")?;
        let pointer_summary: String = node_row.try_get("pointer_summary")?;
        let base_utility: f32 = node_row.try_get("base_utility")?;
        let current_heat: f32 = node_row.try_get("current_heat")?;
        let is_pinned: bool = node_row.try_get("is_pinned")?;
        let memory_type: String = node_row
            .try_get("memory_type")
            .unwrap_or_else(|_| "episodic".to_string());
        let modality: String = node_row
            .try_get("modality")
            .unwrap_or_else(|_| "text".to_string());
        let source_mime: Option<String> = node_row.get("source_mime");
        let namespace: String = node_row
            .try_get("namespace")
            .unwrap_or_else(|_| "default".to_string());

        let raw_content = sqlx::query("SELECT raw_content FROM payloads WHERE node_id = $1")
            .bind(&id)
            .fetch_optional(storage.pool())
            .await?
            .and_then(|r| r.try_get::<Option<String>, _>("raw_content").ok())
            .flatten();

        let vector_b64 = sqlx::query("SELECT vector FROM embeddings WHERE node_id = $1")
            .bind(&id)
            .fetch_optional(storage.pool())
            .await?
            .and_then(|r| r.try_get::<Option<Vec<u8>>, _>("vector").ok())
            .flatten()
            .map(|b| base64::engine::general_purpose::STANDARD.encode(&b));

        nodes.push(ExportNode {
            id,
            label,
            pointer_summary,
            base_utility,
            current_heat,
            is_pinned,
            memory_type,
            modality,
            source_mime,
            namespace,
            raw_content,
            vector_b64,
        });
    }

    // fetch edges where both endpoints are in the fold; ANY($1) replaces dynamic IN-list
    let edge_rows = sqlx::query(
        "SELECT source_id, target_id, relationship_type, edge_weight \
         FROM edges WHERE source_id = ANY($1) AND target_id = ANY($1)",
    )
    .bind(&node_ids)
    .fetch_all(storage.pool())
    .await?;
    let mut edges: Vec<ExportEdge> = Vec::with_capacity(edge_rows.len());
    for er in edge_rows.into_iter() {
        let source_id: String = er.try_get("source_id")?;
        let target_id: String = er.try_get("target_id")?;
        let relationship_type: String = er.try_get("relationship_type")?;
        let edge_weight: f32 = er.try_get("edge_weight")?;
        edges.push(ExportEdge {
            source_id,
            target_id,
            relationship_type,
            edge_weight,
        });
    }

    let payload = FoldPayload {
        name: fold_name.to_string(),
        nodes,
        edges,
    };
    let s = serde_json::to_string_pretty(&payload)?;
    std::fs::write(file_path, s)?;
    Ok(())
}

/// Import a fold JSON file and upsert contained nodes/edges/vectors into local DB.
/// The fold name from the payload will be created or reused and nodes added to it.
pub async fn import_fold(storage: &LocalStorage, file_path: &str) -> anyhow::Result<()> {
    let s = std::fs::read_to_string(file_path).context("failed to read fold file")?;
    let payload: FoldPayload = serde_json::from_str(&s).context("invalid fold json")?;

    let pool = storage.pool();
    let mut tx = pool.begin().await?;

    // ensure fold exists (id generated or reused)
    let fold_id = match sqlx::query("SELECT id FROM folds WHERE name = $1")
        .bind(&payload.name)
        .fetch_optional(&mut *tx)
        .await?
    {
        Some(r) => r.try_get::<String, _>("id")?,
        None => {
            let new_id = Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO folds (id, name) VALUES ($1, $2)")
                .bind(&new_id)
                .bind(&payload.name)
                .execute(&mut *tx)
                .await?;
            new_id
        }
    };

    // upsert nodes + payloads + embeddings
    for n in payload.nodes.iter() {
        let id = Uuid::parse_str(&n.id)?;
        sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, modality, source_mime, namespace, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET label = EXCLUDED.label, pointer_summary = EXCLUDED.pointer_summary, base_utility = EXCLUDED.base_utility, current_heat = EXCLUDED.current_heat, is_pinned = EXCLUDED.is_pinned, memory_type = EXCLUDED.memory_type, modality = EXCLUDED.modality, source_mime = EXCLUDED.source_mime, namespace = EXCLUDED.namespace, updated_at = CURRENT_TIMESTAMP"#)
            .bind(id.to_string())
            .bind(&n.label)
            .bind(&n.pointer_summary)
            .bind(n.base_utility)
            .bind(n.current_heat)
            .bind(n.is_pinned)
            .bind(&n.memory_type)
            .bind(&n.modality)
            .bind(&n.source_mime)
            .bind(&n.namespace)
            .execute(&mut *tx)
            .await?;

        if let Some(ref raw) = n.raw_content {
            sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET raw_content = EXCLUDED.raw_content")
                .bind(id.to_string())
                .bind(raw)
                .execute(&mut *tx)
                .await?;
        }

        if let Some(ref v64) = n.vector_b64 {
            let vec_bytes = base64::engine::general_purpose::STANDARD.decode(v64)?;
            sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                .bind(id.to_string())
                .bind(vec_bytes)
                .execute(&mut *tx)
                .await?;
        }

        // assign to fold
        sqlx::query("INSERT INTO node_folds (node_id, fold_id) VALUES ($1, $2) ON CONFLICT(node_id, fold_id) DO NOTHING")
            .bind(id.to_string())
            .bind(&fold_id)
            .execute(&mut *tx)
            .await?;
    }

    // upsert edges
    for e in payload.edges.iter() {
        // validate uuids
        let _ = Uuid::parse_str(&e.source_id)?;
        let _ = Uuid::parse_str(&e.target_id)?;
        sqlx::query("INSERT INTO edges (source_id, target_id, relationship_type, edge_weight) VALUES ($1, $2, $3, $4) ON CONFLICT(source_id, target_id) DO UPDATE SET relationship_type = EXCLUDED.relationship_type, edge_weight = EXCLUDED.edge_weight")
            .bind(&e.source_id)
            .bind(&e.target_id)
            .bind(&e.relationship_type)
            .bind(e.edge_weight)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

// ─── Async Hierarchical Folding ───────────────────────────────────────────────

/// Scan for cold, un-folded nodes and asynchronously condense their episodic
/// raw content into a dense semantic summary.
///
/// Returns the count of nodes successfully folded.
pub async fn fold_cold_nodes(storage: &LocalStorage, fold_threshold: f32) -> anyhow::Result<usize> {
    // Find cold, un-folded nodes that still have a warm payload.
    let rows = sqlx::query(
        "SELECT n.id, n.label, p.raw_content, COALESCE(n.memory_type, 'episodic') AS memory_type, modality, namespace \
         FROM nodes n \
         JOIN payloads p ON p.node_id = n.id \
         WHERE n.current_heat < $1 \
           AND n.is_pinned = FALSE \
           AND n.folded_at IS NULL \
         ORDER BY n.current_heat ASC \
         LIMIT $2",
    )
    .bind(fold_threshold)
    .bind(FOLD_BATCH)
    .fetch_all(storage.pool())
    .await?;

    if rows.is_empty() {
        return Ok(0);
    }

    let mut folded = 0usize;
    for row in rows.iter() {
        let node_id_s: String = row.try_get("id")?;
        let label: String = row.try_get("label")?;
        let raw_content: String = row.try_get("raw_content")?;
        let memory_type: String = row
            .try_get("memory_type")
            .unwrap_or_else(|_| "episodic".to_string());

        let node_id = match Uuid::parse_str(&node_id_s) {
            Ok(id) => id,
            Err(_) => continue,
        };

        // ── LLM-Native Compacting (Abstractive Summarization) ──
        let fold_summary = abstractive_summarize(&raw_content, &memory_type).await;

        // ── Atomic fold transaction ────────────────────────────────────────────
        let pool = storage.pool();
        let mut tx = pool.begin().await?;

        sqlx::query(
            "INSERT INTO cold_storage (node_id, compressed_content, fold_summary, folded_at) \
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP) \
             ON CONFLICT(node_id) DO UPDATE SET \
               compressed_content = EXCLUDED.compressed_content, \
               fold_summary = EXCLUDED.fold_summary, \
               folded_at = EXCLUDED.folded_at",
        )
        .bind(&node_id_s)
        .bind(&raw_content)
        .bind(&fold_summary)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE nodes SET pointer_summary = $1, folded_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(&fold_summary)
        .bind(&node_id_s)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM payloads WHERE node_id = $1")
            .bind(&node_id_s)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        tracing::info!(
            node_id = %node_id,
            label = %label,
            fold_summary_len = fold_summary.len(),
            raw_content_len = raw_content.len(),
            "memory consolidation: condensed cold episodic memory into semantic summary"
        );

        folded += 1;
    }

    if folded > 0 {
        tracing::info!(folded, "memory consolidation pass complete");
    }

    Ok(folded)
}

// ─── LLM-Native Compacting ───

/// Generate a dense, abstractive summary of a cold node before paging it out.
///
/// Falls back to the extractive truncation if the LLM is unreachable or returns
/// an error, so folding is never blocked by LLM availability.
pub async fn abstractive_summarize(content: &str, mtype: &str) -> String {
    let base_url =
        std::env::var("SULCUS_LLM_URL").unwrap_or_else(|_| "http://localhost:11434".to_string());
    let model = std::env::var("SULCUS_LLM_MODEL").unwrap_or_else(|_| "llama3.2".to_string());

    let prompt = summarize_prompt(content, mtype);
    let endpoint = format!("{}/api/generate", base_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "options": { "num_predict": 200, "temperature": 0.3 }
    });

    let result: anyhow::Result<String> = async {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()?;
        let resp = client.post(&endpoint).json(&body).send().await?;
        if !resp.status().is_success() {
            anyhow::bail!("LLM returned HTTP {}", resp.status());
        }
        let json: serde_json::Value = resp.json().await?;
        let text = json
            .get("response")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if text.is_empty() {
            anyhow::bail!("LLM returned empty response");
        }
        Ok(text)
    }
    .await;

    match result {
        Ok(summary) => {
            tracing::debug!(model, mtype, "abstractive_summarize: LLM summary generated");
            if summary.chars().count() > FOLD_SUMMARY_MAX {
                summary.chars().take(FOLD_SUMMARY_MAX).collect()
            } else {
                summary
            }
        }
        Err(e) => {
            tracing::debug!(error = %e, "abstractive_summarize: LLM unavailable, using extractive fallback");
            extractive_summarize_fallback(content, FOLD_SUMMARY_MAX)
        }
    }
}

/// Generate a structured description of an image before embedding it.
pub async fn abstractive_describe_image(image_path: &str) -> anyhow::Result<String> {
    let base_url =
        std::env::var("SULCUS_LLM_URL").unwrap_or_else(|_| "http://localhost:11434".to_string());
    let model = std::env::var("SULCUS_VISION_MODEL").unwrap_or_else(|_| "llava".to_string());

    let image_data = std::fs::read(image_path)
        .with_context(|| format!("failed to read image file: {image_path}"))?;
    let b64_image = base64::engine::general_purpose::STANDARD.encode(image_data);

    let prompt = "Describe this image in detail. Focus on identifying entities, topics, and overall importance. Output a single dense paragraph.";
    let endpoint = format!("{}/api/generate", base_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "images": [b64_image],
        "stream": false,
        "options": { "num_predict": 300, "temperature": 0.2 }
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let resp = client.post(&endpoint).json(&body).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("Vision LLM (Ollama) returned HTTP {}", resp.status());
    }
    let json: serde_json::Value = resp.json().await?;
    let text = json
        .get("response")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if text.is_empty() {
        anyhow::bail!("Vision LLM returned empty response");
    }

    Ok(text)
}

// ─── Markdown Export / Import ────────────────────────────────────────────────

/// Export nodes to a portable Markdown file that any SULCUS environment can import.
///
/// If `fold_name` is `Some`, only nodes belonging to that fold are exported;
/// if `None`, **all** nodes are exported ordered by descending heat.
///
/// Returns the number of nodes exported.
pub async fn export_markdown(
    storage: &LocalStorage,
    file_path: &str,
    fold_name: Option<&str>,
) -> anyhow::Result<usize> {
    // Resolve the list of node IDs to export.
    let node_ids: Vec<String> = if let Some(name) = fold_name {
        let fold_row = sqlx::query("SELECT id FROM folds WHERE name = $1")
            .bind(name)
            .fetch_optional(storage.pool())
            .await?;
        let fold_id = fold_row
            .and_then(|r| r.try_get::<String, _>("id").ok())
            .ok_or_else(|| anyhow::anyhow!("fold not found: {}", name))?;
        sqlx::query("SELECT node_id FROM node_folds WHERE fold_id = $1")
            .bind(&fold_id)
            .fetch_all(storage.pool())
            .await?
            .into_iter()
            .filter_map(|r| r.try_get::<String, _>("node_id").ok())
            .collect()
    } else {
        sqlx::query("SELECT id FROM nodes ORDER BY current_heat DESC")
            .fetch_all(storage.pool())
            .await?
            .into_iter()
            .filter_map(|r| r.try_get::<String, _>("id").ok())
            .collect()
    };

    // Gather each node with metadata + warm/cold payload.
    let mut nodes: Vec<ExportNode> = Vec::with_capacity(node_ids.len());
    for nid in node_ids.iter() {
        let Some(row) = sqlx::query(
            "SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned, \
             COALESCE(memory_type, 'episodic') AS memory_type, modality, source_mime, namespace FROM nodes WHERE id = $1",
        )
        .bind(nid)
        .fetch_optional(storage.pool())
        .await?
        else {
            continue;
        };

        let id: String = row.try_get("id")?;
        let label: String = row.try_get("label")?;
        let pointer_summary: String = row.try_get("pointer_summary")?;
        let base_utility: f32 = row.try_get("base_utility")?;
        let current_heat: f32 = row.try_get("current_heat")?;
        let is_pinned: bool = row.try_get("is_pinned")?;
        let memory_type: String = row
            .try_get("memory_type")
            .unwrap_or_else(|_| "episodic".to_string());
        let modality: String = row
            .try_get("modality")
            .unwrap_or_else(|_| "text".to_string());
        let source_mime: Option<String> = row.get("source_mime");
        let namespace: String = row
            .try_get("namespace")
            .unwrap_or_else(|_| "default".to_string());

        // Warm payload first; fall back to cold_storage.
        let raw_content = sqlx::query("SELECT raw_content FROM payloads WHERE node_id = $1")
            .bind(&id)
            .fetch_optional(storage.pool())
            .await?
            .and_then(|r| r.try_get::<Option<String>, _>("raw_content").ok())
            .flatten();
        let raw_content = if raw_content.is_none() {
            sqlx::query("SELECT compressed_content FROM cold_storage WHERE node_id = $1")
                .bind(&id)
                .fetch_optional(storage.pool())
                .await?
                .and_then(|r| r.try_get::<Option<String>, _>("compressed_content").ok())
                .flatten()
        } else {
            raw_content
        };

        nodes.push(ExportNode {
            id,
            label,
            pointer_summary,
            base_utility,
            current_heat,
            is_pinned,
            memory_type,
            modality,
            source_mime,
            namespace,
            raw_content,
            vector_b64: None,
        });
    }

    // Edges — only between exported nodes.
    let edges: Vec<ExportEdge> = if node_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query(
            "SELECT source_id, target_id, relationship_type, edge_weight \
             FROM edges WHERE source_id = ANY($1) AND target_id = ANY($1)",
        )
        .bind(&node_ids)
        .fetch_all(storage.pool())
        .await?
        .into_iter()
        .filter_map(|r| {
            Some(ExportEdge {
                source_id: r.try_get("source_id").ok()?,
                target_id: r.try_get("target_id").ok()?,
                relationship_type: r.try_get("relationship_type").ok()?,
                edge_weight: r.try_get("edge_weight").ok()?,
            })
        })
        .collect()
    };

    let node_count = nodes.len();
    let exported_at = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    // Delegate markdown rendering to the pure function in sulcus-core.
    let md = render_nodes_to_markdown(&nodes, &edges, &exported_at, fold_name);

    std::fs::write(file_path, &md)?;
    Ok(node_count)
}

/// Import a SULCUS Markdown file produced by [`export_markdown`] and upsert its
/// nodes, payloads, and edges into storage.
///
/// Returns the number of nodes imported.
pub async fn import_markdown(storage: &LocalStorage, file_path: &str) -> anyhow::Result<usize> {
    let text = std::fs::read_to_string(file_path).context("failed to read markdown export file")?;

    // Delegate parsing to the pure function in sulcus-core.
    let parsed_nodes = parse_markdown_export(&text);

    let pool = storage.pool();
    let mut tx = pool.begin().await?;
    let mut imported = 0usize;

    for node in parsed_nodes.iter() {
        let id_str = match &node.id {
            Some(s) => s.clone(),
            None => Uuid::new_v4().to_string(),
        };
        let id = Uuid::parse_str(&id_str)?;
        let pointer_summary = node.pointer_summary();
        let raw_content = node.raw_content();

        sqlx::query(
            r#"INSERT INTO nodes
               (id, label, pointer_summary, base_utility, current_heat, is_pinned,
                memory_type, modality, namespace, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT(id) DO UPDATE SET
                 label          = EXCLUDED.label,
                 pointer_summary = EXCLUDED.pointer_summary,
                 base_utility   = EXCLUDED.base_utility,
                 current_heat   = EXCLUDED.current_heat,
                 is_pinned      = EXCLUDED.is_pinned,
                 memory_type    = EXCLUDED.memory_type,
                 modality       = EXCLUDED.modality,
                 namespace      = EXCLUDED.namespace,
                 updated_at     = CURRENT_TIMESTAMP"#,
        )
        .bind(id.to_string())
        .bind(&node.label)
        .bind(&pointer_summary)
        .bind(node.base_utility)
        .bind(node.current_heat)
        .bind(node.is_pinned)
        .bind(&node.memory_type)
        .bind(&node.modality)
        .bind(&node.namespace)
        .execute(&mut *tx)
        .await?;

        if let Some(ref content) = raw_content {
            sqlx::query(
                "INSERT INTO payloads (node_id, raw_content) VALUES ($1, $2) \
                 ON CONFLICT(node_id) DO UPDATE SET raw_content = EXCLUDED.raw_content",
            )
            .bind(id.to_string())
            .bind(content)
            .execute(&mut *tx)
            .await?;
        }

        // Parse and upsert edges.
        for link in node.link_lines.iter() {
            if let Some((target_id, rel_type, weight)) = parse_link_line(link) {
                if Uuid::parse_str(&target_id).is_ok() && Uuid::parse_str(&id_str).is_ok() {
                    sqlx::query(
                        "INSERT INTO edges (source_id, target_id, relationship_type, edge_weight)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT(source_id, target_id) DO UPDATE SET
                           relationship_type = EXCLUDED.relationship_type,
                           edge_weight       = EXCLUDED.edge_weight",
                    )
                    .bind(&id_str)
                    .bind(&target_id)
                    .bind(&rel_type)
                    .bind(weight)
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }

        imported += 1;
    }

    tx.commit().await?;
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn describe_image_fails_on_missing_file() {
        let res = abstractive_describe_image("/tmp/nonexistent_image_12345.png").await;
        assert!(res.is_err());
    }
}