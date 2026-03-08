/// sulcus-wasm — MCP Tool Handlers
///
/// These handlers mirror the `sulcus-local` MCP surface but use the JS bridges
/// (DbBridge + EmbedBridge) instead of sqlx + fastembed.  All heavy thermodynamics
/// and CRDT logic is delegated to `sulcus-core` (pure Rust, no I/O).
///
/// Tool surface:
///   add_memory      — record a text memory; insert node + embedding
///   search_memory   — hybrid FTS + cosine similarity search (native pgvector in SQL)
///   list_hot_nodes  — ordered by current_heat DESC
///   tick            — run one thermodynamics decay/spread cycle
use crate::bridge::{DbBridge, EmbedBridge};
use anyhow::Result;
use serde_json::{json, Value};
use uuid::Uuid;

// ── add_memory ──────────────────────────────────────────────────────────────

pub async fn add_memory(
    db: &DbBridge,
    embed: &EmbedBridge,
    text: String,
    memory_type: Option<String>,
    modality: Option<String>,
    source_mime: Option<String>,
    namespace: Option<String>,
) -> Result<Value> {
    let id = Uuid::new_v4();
    let id_str = id.to_string();
    let mtype = memory_type.unwrap_or_else(|| "episodic".to_string());
    let mod_val = modality.unwrap_or_else(|| "text".to_string());
    let ns_val = namespace.unwrap_or_else(|| "default".to_string());

    // Truncate to a 200-char summary for the pointer.
    let summary: String = text.chars().take(200).collect();

    // Insert node.
    db.execute(
        "INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, modality, source_mime, namespace)
         VALUES ($1, $2, $3, 0.0, 1.0, false, $4, $5, $6, $7)
         ON CONFLICT(id) DO NOTHING",
        &[
            json!(id_str),
            json!(text[..text.len().min(80)].to_string()),
            json!(summary),
            json!(mtype),
            json!(mod_val),
            json!(source_mime),
            json!(ns_val),
        ],
    )
    .await?;

    // Compute embedding; update PGlite.
    let vec = embed.embed(&text).await.unwrap_or_default();
    if !vec.is_empty() {
        let vec_sql = format!("[{}]", vec.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
        db.execute(
            "INSERT INTO embeddings (node_id, vector) VALUES ($1, $2::vector)
             ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector",
            &[json!(id_str.clone()), json!(vec_sql)],
        )
        .await?;
    }

    // Ensure the node appears immediately in the active index (heat = 1.0).
    db.execute(
        "INSERT INTO active_index (node_id, heat) VALUES ($1, 1.0)
         ON CONFLICT(node_id) DO UPDATE SET heat = 1.0",
        &[json!(id_str)],
    )
    .await
    .ok();

    Ok(json!({ "id": id_str, "status": "added" }))
}

// ── search_memory ────────────────────────────────────────────────────────────

pub async fn search_memory(
    db: &DbBridge,
    embed: &EmbedBridge,
    query: String,
    limit: Option<usize>,
    memory_type: Option<String>,
    modality: Option<String>,
    namespace: Option<String>,
) -> Result<Value> {
    let limit = limit.unwrap_or(10);
    let q_vec = embed.embed(&query).await.unwrap_or_default();

    let mut scores: std::collections::HashMap<String, (f64, f64, String, String, String, String)> =
        std::collections::HashMap::new();

    // --- Vector lane: Native pgvector search ---
    if !q_vec.is_empty() {
        let vec_sql = format!("[{}]", q_vec.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
        let vec_rows = db
            .query(
                "SELECT e.node_id, n.label, n.pointer_summary, n.memory_type, n.modality, n.namespace,
                        (1 - (e.vector <=> $1::vector)) AS score
                 FROM embeddings e
                 JOIN nodes n ON n.id = e.node_id
                 ORDER BY score DESC LIMIT $2",
                &[json!(vec_sql), json!(limit * 4)],
            )
            .await
            .unwrap_or_default();

        for r in &vec_rows {
            let id_s = r["node_id"].as_str().unwrap_or("").to_string();
            let label = r["label"].as_str().unwrap_or("").to_string();
            let ps = r["pointer_summary"].as_str().unwrap_or("").to_string();
            let mtype = r["memory_type"].as_str().unwrap_or("episodic").to_string();
            let mod_v = r["modality"].as_str().unwrap_or("text").to_string();
            let ns = r["namespace"].as_str().unwrap_or("default").to_string();
            let score = r["score"].as_f64().unwrap_or(0.0);

            if let Some(ref ft) = memory_type { if &mtype != ft { continue; } }
            if let Some(ref fm) = modality { if &mod_v != fm { continue; } }
            if let Some(ref fns) = namespace { if &ns != fns { continue; } }

            scores.insert(id_s, (score * 0.6, 0.0, label, ps, mtype, mod_v));
        }
    }

    // --- FTS lane (Postgres tsvector) ---
    let fts_rows = db
        .query(
            "SELECT n.id AS node_id, n.label, n.pointer_summary, n.memory_type, n.modality, n.namespace,
                    ts_rank(to_tsvector('english', n.pointer_summary),
                            plainto_tsquery('english', $1)) AS rank
             FROM nodes n
             WHERE to_tsvector('english', n.pointer_summary)
                   @@ plainto_tsquery('english', $1)
             ORDER BY rank DESC LIMIT 50",
            &[json!(query)],
        )
        .await
        .unwrap_or_default();

    for r in &fts_rows {
        let id_s = r["node_id"].as_str().unwrap_or("").to_string();
        let mtype = r["memory_type"].as_str().unwrap_or("episodic").to_string();
        let mod_v = r["modality"].as_str().unwrap_or("text").to_string();
        let ns = r["namespace"].as_str().unwrap_or("default").to_string();
        
        if let Some(ref ft) = memory_type { if &mtype != ft { continue; } }
        if let Some(ref fm) = modality { if &mod_v != fm { continue; } }
        if let Some(ref ns_filter) = namespace { if &ns != ns_filter { continue; } }

        let rank = r["rank"].as_f64().unwrap_or(0.0);
        let fts_score = rank.min(1.0) * 0.4;
        
        scores.entry(id_s.clone())
            .and_modify(|e| e.1 = fts_score)
            .or_insert_with(|| {
                let label = r["label"].as_str().unwrap_or("").to_string();
                let ps = r["pointer_summary"].as_str().unwrap_or("").to_string();
                (0.0, fts_score, label, ps, mtype, mod_v)
            });
    }

    // Sort and return results...
    let mut scored: Vec<(f64, String, String, String, String, String)> = scores
        .into_iter()
        .filter_map(|(id_s, (cos, fts, label, ps, mtype, mod_v))| {
            let combined = cos + fts;
            if combined <= 0.0 {
                return None;
            }
            Some((combined, id_s, label, ps, mtype, mod_v))
        })
        .collect();

    scored.sort_unstable_by(|a, b| {
        b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(limit);
    let results: Vec<Value> = scored
        .into_iter()
        .map(|(combined, id_s, label, ps, mtype, mod_v)| {
            json!({ "id": id_s, "label": label, "pointer_summary": ps, "memory_type": mtype, "modality": mod_v, "score": combined })
        })
        .collect();
    Ok(json!({ "results": results }))
}

// ── list_hot_nodes ───────────────────────────────────────────────────────────

pub async fn list_hot_nodes(db: &DbBridge, limit: Option<usize>) -> Result<Value> {
    let limit = limit.unwrap_or(20) as i64;
    let rows = db
        .query(
            "SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.memory_type, n.modality, n.namespace
             FROM nodes n
             ORDER BY n.current_heat DESC LIMIT $1",
            &[json!(limit)],
        )
        .await?;
    Ok(json!({ "nodes": rows }))
}

// ── tick ────────────────────────────────────────────────────────────────────

pub async fn tick(db: &DbBridge, decay: f64, spread: f64, limit: i64) -> Result<Value> {
    // 1. Decay all nodes.
    db.execute(
        "UPDATE nodes SET current_heat = current_heat * $1 WHERE NOT is_pinned",
        &[json!(decay)],
    )
    .await?;

    // 2. Spreading activation: push heat along edges (one hop, thermally gated).
    db.execute(
        "UPDATE nodes AS target
         SET current_heat = target.current_heat + (
             SELECT COALESCE(SUM(source.current_heat * e.edge_weight * $1), 0)
             FROM edges e
             JOIN nodes source ON source.id = e.source_id
             WHERE e.target_id = target.id
               AND e.valid_to IS NULL
               AND (source.current_heat * e.edge_weight * $1) > 0.05
         )
         WHERE EXISTS (
             SELECT 1 FROM edges e2
             WHERE e2.target_id = target.id AND e2.valid_to IS NULL
         )",
        &[json!(spread)],
    )
    .await?;

    // 3. Rebuild active_index from hot nodes.
    db.execute("DELETE FROM active_index", &[]).await?;
    db.execute(
        "INSERT INTO active_index (node_id, heat, consecutive_active_ticks)
         SELECT id, current_heat, 1 FROM nodes
         WHERE current_heat > 0.05
         ORDER BY current_heat DESC LIMIT $1
         ON CONFLICT(node_id) DO UPDATE SET heat = EXCLUDED.heat",
        &[json!(limit)],
    )
    .await?;

    Ok(json!({ "status": "tick_complete" }))
}
