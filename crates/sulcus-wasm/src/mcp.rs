/// sulcus-wasm — MCP Tool Handlers
///
/// These handlers mirror the `sulcus` MCP surface but use the JS bridges
/// (DbBridge + EmbedBridge) instead of sqlx + fastembed.  All heavy thermodynamics,
/// consolidation, fold rendering, and trigger logic is delegated to `sulcus-core`
/// (pure Rust, no I/O).
///
/// Tool surface:
///   add_memory        — record a text memory; insert node + embedding
///   add_image_memory  — record an image memory with CLIP embedding
///   search_memory     — hybrid FTS + cosine similarity search (native pgvector in SQL)
///   search_by_image   — find similar memories using an image query (CLIP)
///   list_hot_nodes    — ordered by current_heat DESC
///   tick              — run one thermodynamics decay/spread cycle
///   tick_v2           — configurable ThermoConfig-based thermodynamics cycle
///   consolidate       — semantic clustering of hot memories via sulcus-core
///   export_markdown   — export all nodes + edges as SULCUS Markdown format
///   import_markdown   — parse SULCUS Markdown and insert nodes into DB
///   evaluate_triggers — evaluate triggers for an event using pure sulcus-core logic
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
        let vec_sql = format!(
            "[{}]",
            vec.iter()
                .map(|v| v.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
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

// ── add_image_memory ───────────────────────────────────────────────────────

pub async fn add_image_memory(
    db: &DbBridge,
    embed: &EmbedBridge,
    label: Option<String>,
    bitmap: Vec<u8>,
    mime: String,
    namespace: Option<String>,
) -> Result<Value> {
    let id = Uuid::new_v4();
    let id_str = id.to_string();
    let label_val = label.unwrap_or_else(|| format!("Image ({})", mime));
    let ns_val = namespace.unwrap_or_else(|| "default".to_string());

    // Insert node with modality='image'.
    db.execute(
        "INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, modality, source_mime, namespace)
         VALUES ($1, $2, $3, 0.0, 1.0, false, 'episodic', 'image', $4, $5)
         ON CONFLICT(id) DO NOTHING",
        &[
            json!(id_str),
            json!(label_val),
            json!(format!("Visual memory: {}", mime)),
            json!(mime),
            json!(ns_val),
        ],
    )
    .await?;

    // Compute CLIP embedding; update PGlite.
    let vec = embed.embed_image(&bitmap).await.unwrap_or_default();
    if !vec.is_empty() {
        let vec_sql = format!(
            "[{}]",
            vec.iter()
                .map(|v| v.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        db.execute(
            "INSERT INTO embeddings (node_id, vector) VALUES ($1, $2::vector)
             ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector",
            &[json!(id_str.clone()), json!(vec_sql)],
        )
        .await?;
    }

    // Ensure the node appears immediately in the active index.
    db.execute(
        "INSERT INTO active_index (node_id, heat) VALUES ($1, 1.0)
         ON CONFLICT(node_id) DO UPDATE SET heat = 1.0",
        &[json!(id_str)],
    )
    .await
    .ok();

    Ok(json!({ "id": id_str, "status": "added" }))
}

// ── search_by_image ─────────────────────────────────────────────────────────

pub async fn search_by_image(
    db: &DbBridge,
    embed: &EmbedBridge,
    bitmap: Vec<u8>,
    limit: Option<usize>,
    modality: Option<String>,
    namespace: Option<String>,
) -> Result<Value> {
    let limit = limit.unwrap_or(10);
    let q_vec = embed.embed_image(&bitmap).await.unwrap_or_default();

    if q_vec.is_empty() {
        return Ok(json!({ "results": [] }));
    }

    let vec_sql = format!(
        "[{}]",
        q_vec
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );
    let vec_rows = db
        .query(
            "SELECT e.node_id, n.label, n.pointer_summary, n.memory_type, n.modality, n.namespace,
                    (1 - (e.vector <=> $1::vector)) AS score
             FROM embeddings e
             JOIN nodes n ON n.id = e.node_id
             ORDER BY score DESC LIMIT $2",
            &[json!(vec_sql), json!(limit)],
        )
        .await
        .unwrap_or_default();

    let mut results = Vec::new();
    for r in &vec_rows {
        let id_s = r["node_id"].as_str().unwrap_or("").to_string();
        let label = r["label"].as_str().unwrap_or("").to_string();
        let ps = r["pointer_summary"].as_str().unwrap_or("").to_string();
        let mtype = r["memory_type"].as_str().unwrap_or("episodic").to_string();
        let mod_v = r["modality"].as_str().unwrap_or("text").to_string();
        let ns = r["namespace"].as_str().unwrap_or("default").to_string();
        let score = r["score"].as_f64().unwrap_or(0.0);

        if let Some(ref fm) = modality {
            if &mod_v != fm {
                continue;
            }
        }
        if let Some(ref fns) = namespace {
            if &ns != fns {
                continue;
            }
        }

        results.push(json!({
            "id": id_s,
            "label": label,
            "pointer_summary": ps,
            "memory_type": mtype,
            "modality": mod_v,
            "score": score
        }));
    }

    Ok(json!({ "results": results }))
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
        let vec_sql = format!(
            "[{}]",
            q_vec
                .iter()
                .map(|v| v.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
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

            if let Some(ref ft) = memory_type {
                if &mtype != ft {
                    continue;
                }
            }
            if let Some(ref fm) = modality {
                if &mod_v != fm {
                    continue;
                }
            }
            if let Some(ref fns) = namespace {
                if &ns != fns {
                    continue;
                }
            }

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

        if let Some(ref ft) = memory_type {
            if &mtype != ft {
                continue;
            }
        }
        if let Some(ref fm) = modality {
            if &mod_v != fm {
                continue;
            }
        }
        if let Some(ref ns_filter) = namespace {
            if &ns != ns_filter {
                continue;
            }
        }

        let rank = r["rank"].as_f64().unwrap_or(0.0);
        let fts_score = rank.min(1.0) * 0.4;

        scores
            .entry(id_s.clone())
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

    scored.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
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

/// Configurable tick using ThermoConfig. Applies per-type decay, respects
/// decay_class, stability, floors, TTLs, and temporal validity.
///
/// This replaces the raw-parameter `tick()` for systems using the new config.
pub async fn tick_with_config(
    db: &DbBridge,
    config: &sulcus_core::thermo::ThermoConfig,
) -> Result<Value> {
    use sulcus_core::thermo::DecayClass;

    let tick_secs = config.tick.effective_interval_secs();

    // 1. Per-type decay: compute decay factor per memory type and apply.
    //    For each type, we compute the factor and batch-update.
    for (memory_type, profile) in &config.decay_profiles {
        let base_factor = profile.decay_factor(tick_secs);
        let floor = profile.floor as f64;

        // Normal decay_class, stability=1.0 baseline
        // Nodes with custom stability/decay_class will be handled in step 1b.
        db.execute(
            &format!(
                "UPDATE nodes SET current_heat = GREATEST(current_heat * {base_factor}, {floor})
                 WHERE memory_type = $1
                   AND NOT is_pinned
                   AND COALESCE(decay_class, 'normal') = 'normal'
                   AND COALESCE(stability, 1.0) <= 1.05"
            ),
            &[json!(memory_type)],
        )
        .await?;

        // Volatile: 2x faster decay (half the half-life)
        let volatile_factor = profile.decay_factor(tick_secs / DecayClass::Volatile.multiplier());
        db.execute(
            &format!(
                "UPDATE nodes SET current_heat = GREATEST(current_heat * {volatile_factor}, {floor})
                 WHERE memory_type = $1
                   AND NOT is_pinned
                   AND decay_class = 'volatile'"
            ),
            &[json!(memory_type)],
        )
        .await?;

        // Persistent: 2x slower decay
        let persistent_factor =
            profile.decay_factor(tick_secs / DecayClass::Persistent.multiplier());
        db.execute(
            &format!(
                "UPDATE nodes SET current_heat = GREATEST(current_heat * {persistent_factor}, {floor})
                 WHERE memory_type = $1
                   AND NOT is_pinned
                   AND decay_class = 'persistent'"
            ),
            &[json!(memory_type)],
        )
        .await?;

        // High-stability nodes: compute adjusted factor using stability
        // For simplicity in SQL, bucket stability into tiers
        for &stability_tier in &[2.0, 5.0, 10.0] {
            let adj_factor = profile.decay_factor(tick_secs).powf(1.0 / stability_tier); // slower decay = higher factor
            let lower = stability_tier - 1.0;
            let upper = if stability_tier < 10.0 {
                stability_tier + 1.0
            } else {
                f64::MAX
            };
            db.execute(
                &format!(
                    "UPDATE nodes SET current_heat = GREATEST(current_heat * {adj_factor}, {floor})
                     WHERE memory_type = $1
                       AND NOT is_pinned
                       AND COALESCE(decay_class, 'normal') = 'normal'
                       AND COALESCE(stability, 1.0) > {lower}
                       AND COALESCE(stability, 1.0) <= {upper}"
                ),
                &[json!(memory_type)],
            )
            .await?;
        }
    }

    // 2. Apply per-node min_heat floors
    db.execute(
        "UPDATE nodes SET current_heat = GREATEST(current_heat, min_heat)
         WHERE min_heat IS NOT NULL AND current_heat < min_heat",
        &[],
    )
    .await?;

    // 3. Expire TTL-based nodes
    db.execute(
        "UPDATE nodes SET current_heat = 0.01
         WHERE ttl_hours IS NOT NULL
           AND created_at + (ttl_hours * INTERVAL '1 hour') < now()",
        &[],
    )
    .await?;

    // 4. Expire temporally-bounded nodes
    db.execute(
        "UPDATE nodes SET current_heat = 0.01
         WHERE valid_until IS NOT NULL AND valid_until < now()",
        &[],
    )
    .await?;

    // 5. Resonance: multi-hop heat diffusion
    let resonance = &config.resonance;
    let spread = resonance.spread_factor as f64;
    let gate = resonance.thermal_gate as f64;
    let mut current_damping = 1.0_f64;

    for _hop in 0..resonance.depth {
        current_damping *= resonance.damping as f64;
        let effective_spread = spread * current_damping;

        db.execute(
            &format!(
                "UPDATE nodes AS target
                 SET current_heat = LEAST(target.current_heat + (
                     SELECT COALESCE(SUM(source.current_heat * e.edge_weight * {effective_spread}), 0)
                     FROM edges e
                     JOIN nodes source ON source.id = e.source_id
                     WHERE e.target_id = target.id
                       AND e.valid_to IS NULL
                       AND (source.current_heat * e.edge_weight * {effective_spread}) > {gate}
                 ), 1.0)
                 WHERE EXISTS (
                     SELECT 1 FROM edges e2
                     WHERE e2.target_id = target.id AND e2.valid_to IS NULL
                 )"
            ),
            &[],
        )
        .await?;
    }

    // 6. Rebuild active_index
    let max_nodes = config.active_index.max_nodes as i64;
    let hot_threshold = config.active_index.cold_threshold as f64;

    db.execute("DELETE FROM active_index", &[]).await?;
    db.execute(
        &format!(
            "INSERT INTO active_index (node_id, heat, consecutive_active_ticks)
             SELECT id, current_heat, 1 FROM nodes
             WHERE current_heat > {hot_threshold}
             ORDER BY current_heat DESC LIMIT {max_nodes}
             ON CONFLICT(node_id) DO UPDATE SET heat = EXCLUDED.heat"
        ),
        &[],
    )
    .await?;

    Ok(json!({
        "status": "tick_complete",
        "engine": "thermo_v2",
        "tick_interval_secs": config.tick.effective_interval_secs(),
        "decay_profiles": config.decay_profiles.len(),
        "resonance_depth": resonance.depth,
    }))
}

// ── consolidate ──────────────────────────────────────────────────────────────

/// Semantic consolidation: fetch hot nodes, cluster them using sulcus-core's
/// pure greedy algorithm, and return cluster metadata.
///
/// This is purely in-memory clustering — it does NOT write any synthesis nodes
/// to the DB.  The caller can decide whether to persist results.
pub async fn consolidate(db: &DbBridge, _embed: &EmbedBridge, min_heat: f32) -> Result<Value> {
    // 1. Fetch nodes with heat > min_heat.
    let rows = db
        .query(
            "SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.namespace
             FROM nodes n
             WHERE n.current_heat > $1
             ORDER BY n.current_heat DESC
             LIMIT 100",
            &[json!(min_heat as f64)],
        )
        .await
        .unwrap_or_default();

    if rows.is_empty() {
        return Ok(json!({ "clusters": [] }));
    }

    // 2. Fetch embeddings for these nodes.
    let node_ids: Vec<Value> = rows
        .iter()
        .filter_map(|r| r["id"].as_str().map(|s| json!(s)))
        .collect();

    // Build a map of node_id → embedding.
    let mut embedding_map: std::collections::HashMap<String, Vec<f32>> =
        std::collections::HashMap::new();

    // Fetch embeddings one node at a time (PGlite parameterisation with IN
    // lists via $1 arrays is dialect-specific; simpler to batch-fetch all
    // and filter in Rust).
    let emb_rows = db
        .query(
            "SELECT node_id, vector::text AS vec_text FROM embeddings",
            &[],
        )
        .await
        .unwrap_or_default();

    for er in &emb_rows {
        let nid = er["node_id"].as_str().unwrap_or("").to_string();
        if !node_ids.iter().any(|v| v.as_str() == Some(nid.as_str())) {
            continue;
        }
        // Vector comes back as a string like "[0.1,0.2,...]"
        if let Some(vec_str) = er["vec_text"].as_str() {
            let trimmed = vec_str.trim_start_matches('[').trim_end_matches(']');
            let floats: Vec<f32> = trimmed
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            if !floats.is_empty() {
                embedding_map.insert(nid, floats);
            }
        }
    }

    // 3. Build ClusterMember list.
    let members: Vec<sulcus_types::consolidation::ClusterMember> = rows
        .iter()
        .filter_map(|r| {
            let id = r["id"].as_str()?.to_string();
            let label = r["label"].as_str().unwrap_or("").to_string();
            let summary = r["pointer_summary"].as_str().unwrap_or("").to_string();
            let heat = r["current_heat"].as_f64().unwrap_or(0.0) as f32;
            let namespace = r["namespace"].as_str().unwrap_or("default").to_string();
            let embedding = embedding_map.get(&id).cloned();
            Some(sulcus_types::consolidation::ClusterMember {
                id,
                label,
                summary,
                heat,
                namespace,
                embedding,
            })
        })
        .collect();

    // 4. Run pure clustering algorithm from sulcus-core.
    let clusters = sulcus_core::consolidation::cluster_members(&members);

    // 5. Build result: for each cluster, synthesise a node ID and summary.
    let result_clusters: Vec<Value> = clusters
        .iter()
        .map(|cluster| {
            let label_refs: Vec<&str> =
                cluster.members.iter().map(|m| m.label.as_str()).collect();
            let synthesis_id =
                sulcus_core::consolidation::synthesise_node_id(&label_refs);
            let summary =
                sulcus_core::consolidation::extractive_cluster_summary(&cluster.members, 280);
            let member_ids: Vec<&str> = cluster.members.iter().map(|m| m.id.as_str()).collect();
            json!({
                "synthesis_id": synthesis_id,
                "namespace": cluster.namespace,
                "summary": summary,
                "member_count": cluster.members.len(),
                "member_ids": member_ids,
            })
        })
        .collect();

    Ok(json!({ "clusters": result_clusters }))
}

// ── export_markdown ──────────────────────────────────────────────────────────

/// Export all nodes and edges from the DB as SULCUS Markdown format.
/// Uses `sulcus_core::folds::render_nodes_to_markdown` for pure rendering.
pub async fn export_markdown(db: &DbBridge) -> Result<Value> {
    // 1. Fetch all nodes.
    let node_rows = db
        .query(
            "SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned,
                    memory_type, modality, source_mime, namespace
             FROM nodes
             ORDER BY current_heat DESC",
            &[],
        )
        .await?;

    // 2. Fetch all active edges.
    let edge_rows = db
        .query(
            "SELECT source_id, target_id, relationship_type, edge_weight
             FROM edges
             WHERE valid_to IS NULL",
            &[],
        )
        .await
        .unwrap_or_default();

    // 3. Map to ExportNode / ExportEdge.
    let nodes: Vec<sulcus_types::folds::ExportNode> = node_rows
        .iter()
        .map(|r| sulcus_types::folds::ExportNode {
            id: r["id"].as_str().unwrap_or("").to_string(),
            label: r["label"].as_str().unwrap_or("").to_string(),
            pointer_summary: r["pointer_summary"].as_str().unwrap_or("").to_string(),
            base_utility: r["base_utility"].as_f64().unwrap_or(0.0) as f32,
            current_heat: r["current_heat"].as_f64().unwrap_or(0.0) as f32,
            is_pinned: r["is_pinned"].as_bool().unwrap_or(false),
            memory_type: r["memory_type"]
                .as_str()
                .unwrap_or("episodic")
                .to_string(),
            modality: r["modality"].as_str().unwrap_or("text").to_string(),
            source_mime: r["source_mime"].as_str().map(|s| s.to_string()),
            namespace: r["namespace"].as_str().unwrap_or("default").to_string(),
            raw_content: None,
            vector_b64: None,
        })
        .collect();

    let edges: Vec<sulcus_types::folds::ExportEdge> = edge_rows
        .iter()
        .map(|r| sulcus_types::folds::ExportEdge {
            source_id: r["source_id"].as_str().unwrap_or("").to_string(),
            target_id: r["target_id"].as_str().unwrap_or("").to_string(),
            relationship_type: r["relationship_type"]
                .as_str()
                .unwrap_or("related")
                .to_string(),
            edge_weight: r["edge_weight"].as_f64().unwrap_or(0.5) as f32,
        })
        .collect();

    // 4. Render to markdown using the pure sulcus-core function.
    // Use a static timestamp string (WASM has no std::time::SystemTime in browser).
    let exported_at = "unknown";
    let markdown =
        sulcus_core::folds::render_nodes_to_markdown(&nodes, &edges, exported_at, None);

    Ok(json!({
        "markdown": markdown,
        "node_count": nodes.len(),
        "edge_count": edges.len(),
    }))
}

// ── import_markdown ──────────────────────────────────────────────────────────

/// Parse a SULCUS Markdown export and insert all nodes into the DB.
/// Skips nodes whose ID already exists. Re-embeds text using the provided
/// EmbedBridge.
pub async fn import_markdown(db: &DbBridge, embed: &EmbedBridge, text: String) -> Result<Value> {
    // 1. Parse using the pure sulcus-core function.
    let parsed = sulcus_core::folds::parse_markdown_export(&text);

    let mut inserted = 0usize;
    let mut skipped = 0usize;

    for node in &parsed {
        if node.label.is_empty() {
            skipped += 1;
            continue;
        }

        // Use the parsed ID or generate a new one.
        let id_str = node
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let summary = node.pointer_summary();
        let content = node.raw_content();

        // Insert — skip on conflict (do not overwrite existing data).
        let affected = db
            .query(
                "INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat,
                         is_pinned, memory_type, modality, namespace)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT(id) DO NOTHING
                 RETURNING id",
                &[
                    json!(id_str),
                    json!(node.label),
                    json!(summary),
                    json!(node.base_utility as f64),
                    json!(node.current_heat as f64),
                    json!(node.is_pinned),
                    json!(node.memory_type),
                    json!(node.modality),
                    json!(node.namespace),
                ],
            )
            .await
            .unwrap_or_default();

        if affected.is_empty() {
            // ON CONFLICT DO NOTHING → nothing was returned → node already existed.
            skipped += 1;
            continue;
        }

        // Embed the label + summary for search.
        let embed_text = content
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(&node.label);
        let vec = embed.embed(embed_text).await.unwrap_or_default();
        if !vec.is_empty() {
            let vec_sql = format!(
                "[{}]",
                vec.iter()
                    .map(|v| v.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            );
            db.execute(
                "INSERT INTO embeddings (node_id, vector) VALUES ($1, $2::vector)
                 ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector",
                &[json!(id_str), json!(vec_sql)],
            )
            .await
            .ok();
        }

        inserted += 1;
    }

    Ok(json!({
        "status": "import_complete",
        "inserted": inserted,
        "skipped": skipped,
        "total_parsed": parsed.len(),
    }))
}

// ── evaluate_triggers ────────────────────────────────────────────────────────

/// Evaluate triggers for an event using pure sulcus-core filter logic.
///
/// Fetches trigger rows from the DB, runs the pure filter, fires Notify actions
/// (pure string interpolation), and executes DB-backed actions (boost/pin/tag/deprecate)
/// directly via DbBridge.
pub async fn evaluate_triggers(
    db: &DbBridge,
    event_str: String,
    context_json: String,
) -> Result<Value> {
    use std::str::FromStr;

    // 1. Parse event string.
    let event = sulcus_types::triggers::TriggerEvent::from_str(&event_str)
        .map_err(|e| anyhow::anyhow!("invalid trigger event: {}", e))?;

    // 2. Parse context JSON.
    let ctx_val: Value = serde_json::from_str(&context_json)
        .unwrap_or(json!({}));
    let ctx = sulcus_types::triggers::TriggerContext {
        node_id: ctx_val["node_id"].as_str().map(|s| s.to_string()),
        node_label: ctx_val["node_label"].as_str().map(|s| s.to_string()),
        node_namespace: ctx_val["node_namespace"].as_str().map(|s| s.to_string()),
        node_memory_type: ctx_val["node_memory_type"].as_str().map(|s| s.to_string()),
        node_heat: ctx_val["node_heat"].as_f64().map(|f| f as f32),
        old_heat: ctx_val["old_heat"].as_f64().map(|f| f as f32),
    };

    // 3. Query trigger rows for this event.
    let rows = db
        .query(
            "SELECT id, event, action, config, enabled, fire_count,
                    last_fired, cooldown_secs, heat_floor, heat_ceiling, label_pattern
             FROM triggers
             WHERE event = $1 AND enabled = true",
            &[json!(event.as_str())],
        )
        .await
        .unwrap_or_default();

    // 4. Map to TriggerRow.
    let trigger_rows: Vec<sulcus_core::triggers::TriggerRow> = rows
        .iter()
        .filter_map(|r| {
            let id = r["id"].as_str()?.to_string();
            let event_s = r["event"].as_str().unwrap_or("").to_string();
            let action = r["action"].as_str().unwrap_or("").to_string();
            let config = r["config"].clone();
            let enabled = r["enabled"].as_bool().unwrap_or(true);
            let fire_count = r["fire_count"].as_i64().unwrap_or(0);
            // last_fired: stored as ISO8601 string or null
            let last_fired: Option<chrono::DateTime<chrono::Utc>> = r["last_fired"]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&chrono::Utc) as chrono::DateTime<chrono::Utc>);
            let cooldown_secs = r["cooldown_secs"].as_i64();
            let heat_floor = r["heat_floor"].as_f64().map(|f| f as f32);
            let heat_ceiling = r["heat_ceiling"].as_f64().map(|f| f as f32);
            let label_pattern = r["label_pattern"].as_str().map(|s| s.to_string());
            Some(sulcus_core::triggers::TriggerRow {
                id,
                event: event_s,
                action,
                config,
                enabled,
                fire_count,
                last_fired,
                cooldown_secs,
                heat_floor,
                heat_ceiling,
                label_pattern,
            })
        })
        .collect();

    // 5. Pure filter via sulcus-core.
    let now = chrono::Utc::now();
    let matched = sulcus_core::triggers::filter_trigger_rows(&trigger_rows, &ctx, now);

    // 6. Fire each matched trigger.
    let mut results: Vec<sulcus_types::triggers::TriggerResult> = Vec::new();

    for trigger in &matched {
        use std::str::FromStr as _;
        let action =
            sulcus_types::triggers::TriggerAction::from_str(&trigger.action).ok();

        let result = match action {
            Some(sulcus_types::triggers::TriggerAction::Notify) => {
                // Pure: string interpolation only.
                sulcus_core::triggers::fire_notify(trigger, &ctx)
            }

            Some(sulcus_types::triggers::TriggerAction::Boost) => {
                let strength = trigger
                    .action_config
                    .get("strength")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.3) as f32;
                let target_id = trigger
                    .action_config
                    .get("target")
                    .and_then(|v| v.as_str())
                    .and_then(|t| {
                        if t == "self" {
                            ctx.node_id.as_deref()
                        } else {
                            Some(t)
                        }
                    })
                    .or(ctx.node_id.as_deref());

                match target_id {
                    Some(node_id) => {
                        let ok = db
                            .execute(
                                "UPDATE nodes SET current_heat = LEAST(current_heat + $1, 1.0) WHERE id = $2",
                                &[json!(strength as f64), json!(node_id)],
                            )
                            .await
                            .is_ok();
                        sulcus_types::triggers::TriggerResult {
                            trigger_id: trigger.id.clone(),
                            trigger_name: trigger.name.clone(),
                            action: "boost".into(),
                            success: ok,
                            message: Some(format!("Boosted {} by {}", node_id, strength)),
                            data: json!({"target": node_id, "strength": strength}),
                        }
                    }
                    None => sulcus_types::triggers::TriggerResult {
                        trigger_id: trigger.id.clone(),
                        trigger_name: trigger.name.clone(),
                        action: "boost".into(),
                        success: false,
                        message: Some("No target node for boost".into()),
                        data: json!({}),
                    },
                }
            }

            Some(sulcus_types::triggers::TriggerAction::Pin) => {
                match ctx.node_id.as_deref() {
                    Some(node_id) => {
                        let ok = db
                            .execute(
                                "UPDATE nodes SET is_pinned = true WHERE id = $1",
                                &[json!(node_id)],
                            )
                            .await
                            .is_ok();
                        sulcus_types::triggers::TriggerResult {
                            trigger_id: trigger.id.clone(),
                            trigger_name: trigger.name.clone(),
                            action: "pin".into(),
                            success: ok,
                            message: Some(format!("Pinned {}", node_id)),
                            data: json!({"node_id": node_id}),
                        }
                    }
                    None => sulcus_types::triggers::TriggerResult {
                        trigger_id: trigger.id.clone(),
                        trigger_name: trigger.name.clone(),
                        action: "pin".into(),
                        success: false,
                        message: Some("No node to pin".into()),
                        data: json!({}),
                    },
                }
            }

            Some(sulcus_types::triggers::TriggerAction::Tag) => {
                let label_suffix = trigger
                    .action_config
                    .get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or("triggered");
                match ctx.node_id.as_deref() {
                    Some(node_id) => {
                        let ok = db
                            .execute(
                                "UPDATE nodes SET label = label || $1 WHERE id = $2",
                                &[json!(format!(" [{}]", label_suffix)), json!(node_id)],
                            )
                            .await
                            .is_ok();
                        sulcus_types::triggers::TriggerResult {
                            trigger_id: trigger.id.clone(),
                            trigger_name: trigger.name.clone(),
                            action: "tag".into(),
                            success: ok,
                            message: Some(format!(
                                "Tagged {} with [{}]",
                                node_id, label_suffix
                            )),
                            data: json!({"node_id": node_id, "tag": label_suffix}),
                        }
                    }
                    None => sulcus_types::triggers::TriggerResult {
                        trigger_id: trigger.id.clone(),
                        trigger_name: trigger.name.clone(),
                        action: "tag".into(),
                        success: false,
                        message: Some("No node to tag".into()),
                        data: json!({}),
                    },
                }
            }

            Some(sulcus_types::triggers::TriggerAction::Deprecate) => {
                let reason = trigger
                    .action_config
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("auto-deprecated by trigger");
                match ctx.node_id.as_deref() {
                    Some(node_id) => {
                        let ok = db
                            .execute(
                                "UPDATE nodes SET current_heat = 0.01 WHERE id = $1",
                                &[json!(node_id)],
                            )
                            .await
                            .is_ok();
                        sulcus_types::triggers::TriggerResult {
                            trigger_id: trigger.id.clone(),
                            trigger_name: trigger.name.clone(),
                            action: "deprecate".into(),
                            success: ok,
                            message: Some(format!("Deprecated {}: {}", node_id, reason)),
                            data: json!({"node_id": node_id, "reason": reason}),
                        }
                    }
                    None => sulcus_types::triggers::TriggerResult {
                        trigger_id: trigger.id.clone(),
                        trigger_name: trigger.name.clone(),
                        action: "deprecate".into(),
                        success: false,
                        message: Some("No node to deprecate".into()),
                        data: json!({}),
                    },
                }
            }

            // Webhook and Chain are not supported in WASM (no reqwest, no chain eval).
            _ => sulcus_types::triggers::TriggerResult {
                trigger_id: trigger.id.clone(),
                trigger_name: trigger.name.clone(),
                action: trigger.action.clone(),
                success: false,
                message: Some(format!(
                    "Action '{}' not supported in WASM runtime",
                    trigger.action
                )),
                data: json!({}),
            },
        };

        results.push(result);
    }

    // 7. Collect notifications from results.
    let notifications = sulcus_core::triggers::collect_notifications(&results);

    let results_json: Vec<Value> = results
        .iter()
        .map(|r| json!({
            "trigger_id": r.trigger_id,
            "trigger_name": r.trigger_name,
            "action": r.action,
            "success": r.success,
            "message": r.message,
            "data": r.data,
        }))
        .collect();

    Ok(json!({
        "event": event_str,
        "matched": matched.len(),
        "results": results_json,
        "notifications": notifications,
    }))
}
