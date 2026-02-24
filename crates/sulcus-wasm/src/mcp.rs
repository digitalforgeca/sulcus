/// sulcus-wasm — MCP Tool Handlers
///
/// These handlers mirror the `sulcus-local` MCP surface but use the JS bridges
/// (DbBridge + EmbedBridge) instead of sqlx + fastembed.  All heavy thermodynamics
/// and CRDT logic is delegated to `sulcus-core` (pure Rust, no I/O).
///
/// Tool surface:
///   warm_cache      — bulk-load embeddings from PGlite into WASM RAM
///   add_memory      — record a text memory; insert node + embedding
///   search_memory   — hybrid FTS + cosine similarity search (vector lane uses RAM)
///   list_hot_nodes  — ordered by current_heat DESC
///   tick            — run one thermodynamics decay/spread cycle
use crate::bridge::{DbBridge, EmbedBridge};
use crate::WasmVecCache;
use anyhow::Result;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde_json::{json, Value};
use uuid::Uuid;

// ── warm_cache ───────────────────────────────────────────────────────────────

/// Bulk-load all embeddings stored in PGlite into the WASM in-process cache.
///
/// Call once after `SulcusMem::create()` when the PGlite DB already has data.
/// New embeddings added via `add_memory` are cached automatically.
pub async fn warm_cache(db: &DbBridge, cache: &WasmVecCache) -> Result<Value> {
    let rows = db
        .query(
            "SELECT node_id, encode(vector, 'base64') AS vec_b64 FROM embeddings",
            &[],
        )
        .await
        .unwrap_or_default();

    let mut count = 0usize;
    if let Ok(mut guard) = cache.lock() {
        for r in &rows {
            let id_s = r["node_id"].as_str().unwrap_or("").to_string();
            if id_s.is_empty() {
                continue;
            }
            if let Some(b64) = r["vec_b64"].as_str() {
                if let Ok(bytes) = BASE64_STANDARD.decode(b64) {
                    if bytes.len() % 4 == 0 {
                        let vf: Vec<f32> = bytes
                            .chunks_exact(4)
                            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                            .collect();
                        guard.insert(id_s, vf);
                        count += 1;
                    }
                }
            }
        }
    }
    Ok(json!({ "loaded": count }))
}

// ── add_memory ──────────────────────────────────────────────────────────────

pub async fn add_memory(
    db: &DbBridge,
    embed: &EmbedBridge,
    cache: &WasmVecCache,
    text: String,
    memory_type: Option<String>,
) -> Result<Value> {
    let id = Uuid::new_v4();
    let id_str = id.to_string();
    let mtype = memory_type.unwrap_or_else(|| "episodic".to_string());

    // Truncate to a 200-char summary for the pointer.
    let summary: String = text.chars().take(200).collect();

    // Insert node.
    db.execute(
        "INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type)
         VALUES ($1, $2, $3, 0.0, 1.0, false, $4)
         ON CONFLICT(id) DO NOTHING",
        &[
            json!(id_str),
            json!(text[..text.len().min(80)].to_string()),
            json!(summary),
            json!(mtype),
        ],
    )
    .await?;

    // Compute embedding; update both PGlite and the WASM in-process cache.
    let vec = embed.embed(&text).await.unwrap_or_default();
    if !vec.is_empty() {
        // Encode Vec<f32> as little-endian bytes → base64 for BYTEA transport.
        let bytes: Vec<u8> = vec.iter().flat_map(|f| f.to_le_bytes()).collect();
        let b64 = BASE64_STANDARD.encode(&bytes);
        db.execute(
            "INSERT INTO embeddings (node_id, vector) VALUES ($1, decode($2, 'base64'))
             ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector",
            &[json!(id_str.clone()), json!(b64)],
        )
        .await?;
        // Update the in-memory cache so subsequent searches see this embedding
        // without a round-trip through the JS↔WASM FFI boundary.
        if let Ok(mut guard) = cache.lock() {
            guard.insert(id_str.clone(), vec);
        }
    }

    Ok(json!({ "id": id_str, "status": "added" }))
}

// ── search_memory ────────────────────────────────────────────────────────────

pub async fn search_memory(
    db: &DbBridge,
    embed: &EmbedBridge,
    cache: &WasmVecCache,
    query: String,
    limit: Option<usize>,
) -> Result<Value> {
    let limit = limit.unwrap_or(10);
    let q_vec = embed.embed(&query).await.unwrap_or_default();

    // --- FTS lane (Postgres tsvector) ---
    let fts_rows = db
        .query(
            "SELECT n.id AS node_id, n.label, n.pointer_summary,
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

    let mut scores: std::collections::HashMap<String, (f64, f64, String, String)> =
        std::collections::HashMap::new();

    for r in &fts_rows {
        let id_s = r["node_id"].as_str().unwrap_or("").to_string();
        let label = r["label"].as_str().unwrap_or("").to_string();
        let ps = r["pointer_summary"].as_str().unwrap_or("").to_string();
        let rank = r["rank"].as_f64().unwrap_or(0.0);
        scores.insert(id_s, (0.0, rank.min(1.0) * 0.4, label, ps));
    }

    // --- Vector lane: pure WASM RAM — no SQL fetch, no FFI round-trip ---
    // The entire embeddings table is NOT fetched; only the preloaded RAM cache
    // is scanned. This prevents locking the browser UI thread with megabytes of
    // base64-encoded data crossing the JS↔WASM boundary on every search.
    if !q_vec.is_empty() {
        let na: f32 = q_vec.iter().map(|v| v * v).sum::<f32>().sqrt();
        if na > 0.0 {
            if let Ok(guard) = cache.lock() {
                for (id_s, vf) in guard.iter() {
                    if vf.len() != q_vec.len() {
                        continue;
                    }
                    let cos = cosine(&q_vec, vf) as f64;
                    scores
                        .entry(id_s.clone())
                        .and_modify(|e| e.0 = cos * 0.6)
                        .or_insert((cos * 0.6, 0.0, String::new(), String::new()));
                }
            }
        }
    }

    // For vector-only hits (no FTS), fetch label/summary in a single SQL query.
    let needs_metadata: Vec<Value> = scores
        .iter()
        .filter(|(_, (_, _, lbl, _))| lbl.is_empty())
        .map(|(id, _)| json!(id))
        .collect();

    if !needs_metadata.is_empty() {
        let meta_rows = db
            .query(
                "SELECT id, label, pointer_summary FROM nodes WHERE id = ANY($1)",
                &[json!(needs_metadata)],
            )
            .await
            .unwrap_or_default();

        for r in &meta_rows {
            let id_s = r["id"].as_str().unwrap_or("").to_string();
            if let Some(entry) = scores.get_mut(&id_s) {
                entry.2 = r["label"].as_str().unwrap_or("").to_string();
                entry.3 = r["pointer_summary"].as_str().unwrap_or("").to_string();
            }
        }
    }

    let mut results: Vec<Value> = scores
        .into_iter()
        .filter_map(|(id_s, (cos, fts, label, ps))| {
            let combined = cos + fts;
            if combined <= 0.0 {
                return None;
            }
            Some(json!({ "id": id_s, "label": label, "pointer_summary": ps, "score": combined }))
        })
        .collect();

    results.sort_by(|a, b| {
        b["score"]
            .as_f64()
            .partial_cmp(&a["score"].as_f64())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit);
    Ok(json!({ "results": results }))
}

// ── list_hot_nodes ───────────────────────────────────────────────────────────

pub async fn list_hot_nodes(db: &DbBridge, limit: Option<usize>) -> Result<Value> {
    let limit = limit.unwrap_or(20) as i64;
    let rows = db
        .query(
            "SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.memory_type
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

// ── Utilities ────────────────────────────────────────────────────────────────

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        (dot / (na * nb)).clamp(-1.0, 1.0)
    }
}
