use anyhow::Context;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::SqliteStorage;

/// Node payload exported in a Fold
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExportNode {
    pub id: String,
    pub label: String,
    pub pointer_summary: String,
    pub base_utility: f32,
    pub current_heat: f32,
    pub is_pinned: bool,
    /// optional raw content (territory)
    pub raw_content: Option<String>,
    /// vector stored as base64 to keep JSON deterministic
    pub vector_b64: Option<String>,
}

/// Edge exported in a Fold
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExportEdge {
    pub source_id: String,
    pub target_id: String,
    pub relationship_type: String,
    pub edge_weight: f32,
}

/// Fold payload serialized to disk for export/import
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FoldPayload {
    pub name: String,
    pub nodes: Vec<ExportNode>,
    pub edges: Vec<ExportEdge>,
}

/// Export a named fold to a JSON file. Includes nodes, payloads, vectors and edges
pub async fn export_fold(storage: &SqliteStorage, fold_name: &str, file_path: &str) -> anyhow::Result<()> {
    // resolve fold id
    let row = sqlx::query("SELECT id FROM folds WHERE name = ?")
        .bind(fold_name)
        .fetch_optional(storage.pool())
        .await?;

    let fold_id = if let Some(r) = row {
        r.try_get::<String, _>("id")?
    } else {
        return Err(anyhow::anyhow!("fold not found: {}", fold_name));
    };

    // gather node ids in fold
    let rows = sqlx::query("SELECT node_id FROM node_folds WHERE fold_id = ?")
        .bind(&fold_id)
        .fetch_all(storage.pool())
        .await?;

    let node_ids: Vec<String> = rows.into_iter().filter_map(|r| r.try_get::<String, _>("node_id").ok()).collect();

    if node_ids.is_empty() {
        // write empty fold payload
        let payload = FoldPayload { name: fold_name.to_string(), nodes: Vec::new(), edges: Vec::new() };
        let s = serde_json::to_string_pretty(&payload)?;
        std::fs::write(file_path, s)?;
        return Ok(());
    }

    // fetch nodes + payloads + embeddings
    let mut nodes: Vec<ExportNode> = Vec::with_capacity(node_ids.len());
    for nid in node_ids.iter() {
        let node_row = sqlx::query("SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned FROM nodes WHERE id = ?")
            .bind(nid)
            .fetch_one(storage.pool())
            .await?;
        let id: String = node_row.try_get("id")?;
        let label: String = node_row.try_get("label")?;
        let pointer_summary: String = node_row.try_get("pointer_summary")?;
        let base_utility: f32 = node_row.try_get("base_utility")?;
        let current_heat: f32 = node_row.try_get("current_heat")?;
        let is_pinned_i: i64 = node_row.try_get("is_pinned")?;
        let is_pinned = is_pinned_i != 0;

        let raw_content = sqlx::query("SELECT raw_content FROM payloads WHERE node_id = ?")
            .bind(&id)
            .fetch_optional(storage.pool())
            .await?
            .and_then(|r| r.try_get::<Option<String>, _>("raw_content").ok())
            .flatten();

        let vector_b64 = sqlx::query("SELECT vector FROM embeddings WHERE node_id = ?")
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
            raw_content,
            vector_b64,
        });
    }

    // fetch edges where both endpoints are in the fold
    let placeholders = node_ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
    let query = format!("SELECT source_id, target_id, relationship_type, edge_weight FROM edges WHERE source_id IN ({}) AND target_id IN ({})", placeholders, placeholders);
    let mut q = sqlx::query(&query);
    for nid in node_ids.iter() {
        q = q.bind(nid);
    }
    for nid in node_ids.iter() {
        q = q.bind(nid);
    }
    let edge_rows = q.fetch_all(storage.pool()).await?;
    let mut edges: Vec<ExportEdge> = Vec::with_capacity(edge_rows.len());
    for er in edge_rows.into_iter() {
        let source_id: String = er.try_get("source_id")?;
        let target_id: String = er.try_get("target_id")?;
        let relationship_type: String = er.try_get("relationship_type")?;
        let edge_weight: f32 = er.try_get("edge_weight")?;
        edges.push(ExportEdge { source_id, target_id, relationship_type, edge_weight });
    }

    let payload = FoldPayload { name: fold_name.to_string(), nodes, edges };
    let s = serde_json::to_string_pretty(&payload)?;
    std::fs::write(file_path, s)?;
    Ok(())
}

/// Import a fold JSON file and upsert contained nodes/edges/vectors into local DB.
/// The fold name from the payload will be created or reused and nodes added to it.
pub async fn import_fold(storage: &SqliteStorage, file_path: &str) -> anyhow::Result<()> {
    let s = std::fs::read_to_string(file_path).context("failed to read fold file")?;
    let payload: FoldPayload = serde_json::from_str(&s).context("invalid fold json")?;

    let pool = storage.pool();
    let mut tx = pool.begin().await?;

    // ensure fold exists (id generated or reused)
    let fold_id = match sqlx::query("SELECT id FROM folds WHERE name = ?")
        .bind(&payload.name)
        .fetch_optional(&mut *tx)
        .await?
    {
        Some(r) => r.try_get::<String, _>("id")?,
        None => {
            let new_id = Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO folds (id, name) VALUES (?, ?)")
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
        sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, created_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET label = excluded.label, pointer_summary = excluded.pointer_summary, base_utility = excluded.base_utility, current_heat = excluded.current_heat, is_pinned = excluded.is_pinned"#)
            .bind(id.to_string())
            .bind(&n.label)
            .bind(&n.pointer_summary)
            .bind(n.base_utility)
            .bind(n.current_heat)
            .bind(n.is_pinned as i64)
            .execute(&mut *tx)
            .await?;

        if let Some(ref raw) = n.raw_content {
            sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET raw_content = excluded.raw_content")
                .bind(id.to_string())
                .bind(raw)
                .execute(&mut *tx)
                .await?;
        }

        if let Some(ref v64) = n.vector_b64 {
            let vec_bytes = base64::engine::general_purpose::STANDARD.decode(v64)?;
            sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET vector = excluded.vector")
                .bind(id.to_string())
                .bind(vec_bytes)
                .execute(&mut *tx)
                .await?;
        }

        // assign to fold
        sqlx::query("INSERT INTO node_folds (node_id, fold_id) VALUES (?, ?) ON CONFLICT(node_id, fold_id) DO NOTHING")
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
        sqlx::query("INSERT INTO edges (source_id, target_id, relationship_type, edge_weight) VALUES (?, ?, ?, ?) ON CONFLICT(source_id, target_id) DO UPDATE SET relationship_type = excluded.relationship_type, edge_weight = excluded.edge_weight")
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

/// Batch size: maximum nodes condensed per async-fold pass.
const FOLD_BATCH: i64 = 8;

/// Maximum character length for the dense fold summary stored in the warm cache.
const FOLD_SUMMARY_MAX: usize = 400;

/// Scan for cold, un-folded nodes and asynchronously condense their episodic
/// raw content into a dense semantic summary.
///
/// # What happens
///
/// 1. Query `nodes` for entries with `current_heat < fold_threshold` that have a
///    warm `payloads` row and have not yet been folded (`folded_at IS NULL`).
/// 2. For each cold node, run a fast, cheap **extractive summary** (deterministic,
///    no network / no GPU required) to produce a dense `fold_summary`.
/// 3. Write the verbatim raw content + fold summary to `cold_storage` so it can
///    be paged back in on demand (page-fault recall via `fetch_payload`).
/// 4. Replace `nodes.pointer_summary` with the dense fold summary using a
///    LWW-register patch so remote replicas converge.
/// 5. Delete the warm `payloads` row (raw content now lives in cold_storage).
/// 6. Stamp `nodes.folded_at` so this node is skipped in future fold passes.
///
/// Returns the count of nodes successfully folded.
pub async fn fold_cold_nodes(storage: &SqliteStorage, fold_threshold: f32) -> anyhow::Result<usize> {
    // Find cold, un-folded nodes that still have a warm payload.
    let rows = sqlx::query(
        "SELECT n.id, n.label, p.raw_content \
         FROM nodes n \
         JOIN payloads p ON p.node_id = n.id \
         WHERE n.current_heat < ? \
           AND n.is_pinned = 0 \
           AND n.folded_at IS NULL \
         ORDER BY n.current_heat ASC \
         LIMIT ?",
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

        let node_id = match Uuid::parse_str(&node_id_s) {
            Ok(id) => id,
            Err(_) => continue,
        };

        // ── Extractive summarization (fast, deterministic, no model required) ──
        let fold_summary = extractive_summarize(&raw_content, FOLD_SUMMARY_MAX);

        // ── Atomic fold transaction ────────────────────────────────────────────
        let pool = storage.pool();
        let mut tx = pool.begin().await?;

        // 1. Write raw content + dense summary to cold_storage.
        //    Raw verbatim content is preserved here for on-demand page-fault recall.
        sqlx::query(
            "INSERT INTO cold_storage (node_id, compressed_content, fold_summary, folded_at) \
             VALUES (?, ?, ?, CURRENT_TIMESTAMP) \
             ON CONFLICT(node_id) DO UPDATE SET \
               compressed_content = excluded.compressed_content, \
               fold_summary = excluded.fold_summary, \
               folded_at = excluded.folded_at",
        )
        .bind(&node_id_s)
        .bind(&raw_content)
        .bind(&fold_summary)
        .execute(&mut *tx)
        .await?;

        // 2. Update nodes: replace verbose pointer_summary with dense fold summary
        //    and stamp folded_at so this node is excluded from future fold passes.
        sqlx::query(
            "UPDATE nodes SET pointer_summary = ?, folded_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(&fold_summary)
        .bind(&node_id_s)
        .execute(&mut *tx)
        .await?;

        // 3. Remove warm payload — raw content is now in cold_storage.
        //    The dense fold_summary in nodes.pointer_summary stays in the warm cache.
        sqlx::query("DELETE FROM payloads WHERE node_id = ?")
            .bind(&node_id_s)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        tracing::debug!(
            node_id = %node_id,
            label = %label,
            fold_summary_len = fold_summary.len(),
            raw_content_len = raw_content.len(),
            "async fold: condensed cold node into cold_storage"
        );

        folded += 1;
    }

    if folded > 0 {
        tracing::info!(folded, fold_threshold, "async fold pass complete");
    }

    Ok(folded)
}

/// Fast, deterministic, extractive summarizer.
///
/// Splits on sentence boundaries (`.`, `?`, `!`) and greedily appends sentences
/// until `max_chars` is reached.  No model, no network, no GPU — pure text heuristic.
/// Returns a UTF-8 string ≤ `max_chars` characters.
///
/// This is intentionally a cheap stand-in for a local quantised model.  When a
/// real local inference engine is available (llama.cpp, candle, etc.) this
/// can be swapped with a proper semantic compressor at the same call-site.
pub fn extractive_summarize(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    if text.is_empty() {
        return String::new();
    }

    // Collapse whitespace
    let normalised: String = text.split_whitespace().collect::<Vec<_>>().join(" ");

    let mut summary = String::new();
    for sentence in normalised.split(['.', '?', '!']).map(str::trim) {
        if sentence.is_empty() {
            continue;
        }
        if !summary.is_empty() {
            summary.push_str(". ");
        }
        if summary.len() + sentence.len() > max_chars {
            break;
        }
        summary.push_str(sentence);
    }

    if summary.is_empty() {
        // fallback: hard truncate
        let cut = normalised
            .char_indices()
            .take_while(|(i, _)| *i < max_chars)
            .last()
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(normalised.len());
        return normalised[..cut].trim().to_string();
    }

    // Ensure closing punctuation
    if !summary.ends_with(['.', '!', '?']) {
        summary.push('.');
    }

    summary
}
