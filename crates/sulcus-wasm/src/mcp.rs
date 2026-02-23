/// sulcus-wasm — MCP Tool Handlers
///
/// These handlers mirror the `sulcus-local` MCP surface but use the JS bridges
/// (DbBridge + EmbedBridge) instead of sqlx + fastembed.  All heavy thermodynamics
/// and CRDT logic is delegated to `sulcus-core` (pure Rust, no I/O).
///
/// Tool surface:
///   add_memory      — record a text memory; insert node + embedding
///   search_memory   — hybrid FTS + cosine similarity search
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

    // Compute and store embedding.
    let vec = embed.embed(&text).await.unwrap_or_default();
    if !vec.is_empty() {
        // Encode Vec<f32> as little-endian bytes → base64 for JSON transport.
        let bytes: Vec<u8> = vec.iter().flat_map(|f| f.to_le_bytes()).collect();
        let b64 = base64_encode(&bytes);
        db.execute(
            "INSERT INTO embeddings (node_id, vector) VALUES ($1, decode($2, 'base64'))
             ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector",
            &[json!(id_str), json!(b64)],
        )
        .await?;
    }

    Ok(json!({ "id": id_str, "status": "added" }))
}

// ── search_memory ────────────────────────────────────────────────────────────

pub async fn search_memory(
    db: &DbBridge,
    embed: &EmbedBridge,
    query: String,
    limit: Option<usize>,
) -> Result<Value> {
    let limit = limit.unwrap_or(10);
    let q_vec = embed.embed(&query).await.unwrap_or_default();

    // --- FTS lane ---
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

    // --- Vector lane ---
    if !q_vec.is_empty() {
        let vec_rows = db
            .query(
                "SELECT n.id, n.label, n.pointer_summary,
                        encode(e.vector, 'base64') AS vec_b64
                 FROM nodes n JOIN embeddings e ON e.node_id = n.id",
                &[],
            )
            .await
            .unwrap_or_default();

        for r in &vec_rows {
            let id_s = r["id"].as_str().unwrap_or("").to_string();
            let label = r["label"].as_str().unwrap_or("").to_string();
            let ps = r["pointer_summary"].as_str().unwrap_or("").to_string();
            if let Some(b64) = r["vec_b64"].as_str() {
                if let Ok(bytes) = base64_decode(b64) {
                    if bytes.len() % 4 == 0 {
                        let vf: Vec<f32> = bytes
                            .chunks_exact(4)
                            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                            .collect();
                        if vf.len() == q_vec.len() {
                            let cos = cosine(&q_vec, &vf) as f64;
                            scores
                                .entry(id_s)
                                .and_modify(|e| e.0 = cos * 0.6)
                                .or_insert((cos * 0.6, 0.0, label, ps));
                        }
                    }
                }
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

/// Minimal base64 encoder for BYTEA ↔ SQL interchange (no external dep).
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 {
            chunk[1] as usize
        } else {
            0
        };
        let b2 = if chunk.len() > 2 {
            chunk[2] as usize
        } else {
            0
        };
        out.push(TABLE[(b0 >> 2) & 0x3F]);
        out.push(TABLE[((b0 << 4) | (b1 >> 4)) & 0x3F]);
        out.push(if chunk.len() > 1 {
            TABLE[((b1 << 2) | (b2 >> 6)) & 0x3F]
        } else {
            b'='
        });
        out.push(if chunk.len() > 2 {
            TABLE[b2 & 0x3F]
        } else {
            b'='
        });
    }
    String::from_utf8(out).unwrap_or_default()
}

fn base64_decode(input: &str) -> Result<Vec<u8>, ()> {
    const DEC: [u8; 256] = {
        let mut t = [255u8; 256];
        let enc = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0usize;
        while i < 64 {
            t[enc[i] as usize] = i as u8;
            i += 1;
        }
        t
    };
    let bytes = input.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4 + 1);
    let mut i = 0;
    while i + 1 < bytes.len() {
        let a = DEC[bytes[i] as usize];
        let b = DEC[bytes[i + 1] as usize];
        if a == 255 || b == 255 {
            return Err(());
        }
        out.push((a << 2) | (b >> 4));
        if i + 2 < bytes.len() {
            let c = DEC[bytes[i + 2] as usize];
            if c != 255 {
                out.push((b << 4) | (c >> 2));
            }
            if i + 3 < bytes.len() {
                let d = DEC[bytes[i + 3] as usize];
                if d != 255 {
                    out.push((c << 6) | d);
                }
            }
        }
        i += 4;
    }
    Ok(out)
}
