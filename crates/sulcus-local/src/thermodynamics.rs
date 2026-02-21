use std::time::Duration;

use sqlx::Row;
use tokio::task::JoinHandle;

use sulcus_core::zero_copy::NodePointer;

use crate::SqliteStorage;

/// Heat below which a node is eligible for async folding (condensing its raw
/// episodic content into a dense semantic summary backed by cold storage).
const FOLD_THRESHOLD: f32 = 0.15;

/// Perform one thermodynamics tick:
/// - decay all node heats by `decay`
/// - build the `active_index` from the top `active_limit` nodes (only nodes with heat >= prune_threshold)
// Internal helper: perform the tick logic inside an existing transaction.
async fn tick_in_tx(
    storage: &SqliteStorage,
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    decay: f32,
    prune_threshold: f32,
    active_limit: usize,
) -> anyhow::Result<()> {
    // Phase 2: Topological diffusion (recursive CTE, max depth = 2)
    // Start from nodes where current_heat > 0.2 and propagate along `edges`.
    sqlx::query(r#"
        WITH RECURSIVE
          frontier(src, dst, depth, path, transfer) AS (
            SELECT n.id AS src, e.target_id AS dst, 1 AS depth,
                   n.id || ',' || e.target_id AS path,
                   n.current_heat * e.edge_weight * 0.5 AS transfer
            FROM nodes n JOIN edges e ON e.source_id = n.id
            WHERE n.current_heat > 0.2

            UNION ALL

            -- propagate transfer forward using the transfer value from the previous frontier row
            SELECT f.src, e.target_id, f.depth + 1,
                   f.path || ',' || e.target_id,
                   f.transfer * e.edge_weight * 0.5
            FROM frontier f JOIN edges e ON e.source_id = f.dst
            WHERE f.depth < 2 AND instr(f.path, e.target_id) = 0
          )
        -- apply all collected transfers in one update (clamped to 1.0)
        UPDATE nodes
        SET current_heat = MIN(1.0, current_heat + COALESCE((SELECT SUM(transfer) FROM frontier WHERE dst = nodes.id), 0.0))
        WHERE id IN (SELECT dst FROM frontier);
    "#)
    .execute(&mut **tx)
    .await?;

    // Phase 3: Temporal decay (skip pinned nodes). Apply decay, then floor-clamp < 0.05 -> 0.0, and cap at 1.0.
    sqlx::query("UPDATE nodes SET current_heat = CASE WHEN is_pinned = 1 THEN current_heat ELSE current_heat * ? END WHERE current_heat > 0")
        .bind(decay)
        .execute(&mut **tx)
        .await?;

    sqlx::query("UPDATE nodes SET current_heat = 0.0 WHERE is_pinned = 0 AND current_heat < 0.05")
        .execute(&mut **tx)
        .await?;

    sqlx::query("UPDATE nodes SET current_heat = 1.0 WHERE current_heat > 1.0")
        .execute(&mut **tx)
        .await?;

    // Phase 4: Page table rendering — build active_index from score = current_heat + (base_utility * 0.5)
    let rows = sqlx::query(
        "SELECT id, label, pointer_summary, current_heat FROM nodes WHERE current_heat >= ? ORDER BY (current_heat + (base_utility * 0.5)) DESC LIMIT ?",
    )
    .bind(prune_threshold)
    .bind(active_limit as i64)
    .fetch_all(&mut **tx)
    .await?;

    // Rebuild active_index table
    sqlx::query("DELETE FROM active_index")
        .execute(&mut **tx)
        .await?;

    let mut pointers: Vec<NodePointer> = Vec::with_capacity(rows.len());
    for row in rows.iter() {
        let id_str: String = row.try_get("id")?;
        let heat: f32 = row.try_get("current_heat")?;
        let label: String = row.try_get("label")?;
        let summary: String = row.try_get("pointer_summary")?;
        sqlx::query(
            "INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) \
             ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP",
        )
        .bind(id_str.clone())
        .bind(heat)
        .execute(&mut **tx)
        .await?;
        if let Ok(id) = uuid::Uuid::parse_str(&id_str) {
            pointers.push(NodePointer::from_node(id, heat, &label, &summary));
        }
    }

    // Write zero-copy shared index buffer (rkyv-encoded NodePointers + optional mmap file).
    // This is the authoritative hot-path for LLM runtime reads — no deserialization needed.
    storage.write_shared_index(&pointers);

    // update prometheus gauge for active_index size if initialized
    if let Some(m) = crate::metrics::try_get() {
        m.active_index_size.set(rows.len() as f64);
    }

    Ok(())
}

pub async fn tick(
    storage: &SqliteStorage,
    decay: f32,
    prune_threshold: f32,
    active_limit: usize,
) -> anyhow::Result<()> {
    let pool = storage.pool();
    let mut tx = pool.begin().await?;
    tick_in_tx(storage, &mut tx, decay, prune_threshold, active_limit).await?;
    tx.commit().await?;
    Ok(())
}

/// Start a background worker that runs `tick` every `interval`,
/// then asynchronously folds cold nodes to condense episodic memory.
///
/// # Async Folding
///
/// After each tick, nodes with `current_heat < FOLD_THRESHOLD` that still carry
/// warm raw payload are eligible for folding. A cheap local extractive model
/// (deterministic — no network required) condenses their content into a dense
/// semantic summary. The verbose raw log moves to `cold_storage`; the dense fold
/// stays in `nodes.pointer_summary` in the warm cache.
/// Returns a JoinHandle that can be aborted by the caller.
pub fn spawn_worker(
    storage: SqliteStorage,
    decay: f32,
    prune_threshold: f32,
    active_limit: usize,
    interval: Duration,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        loop {
            ticker.tick().await;
            if let Err(e) = tick(&storage, decay, prune_threshold, active_limit).await {
                tracing::error!(error = %e, "thermodynamics tick failed");
            }

            // Async fold: detect cold nodes and condense their episodic content.
            // Run in a separate task so it never blocks the tick cadence.
            let storage_clone = storage.clone();
            tokio::spawn(async move {
                if let Err(e) = crate::folds::fold_cold_nodes(&storage_clone, FOLD_THRESHOLD).await {
                    tracing::debug!(error = %e, "async fold pass completed with errors");
                }
            });
        }
    })
}

/// Ignite the semantic graph from a user prompt by:
/// 1. embedding the prompt with the provided embedding `provider`
/// 2. vector-searching `vec_nodes` (top-3 via `vec_distance_cosine`)
/// 3. bumping `current_heat` for the matched nodes
/// 4. running the thermodynamics tick _inside the same transaction_ so diffusion is atomic
pub async fn ignite_context(
    user_prompt: &str,
    provider: &dyn crate::embeddings::EmbeddingProvider,
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    storage: &SqliteStorage,
) -> anyhow::Result<()> {
    // embed the prompt
    let emb = provider.embed(user_prompt)?;
    if emb.is_empty() {
        return Ok(());
    }

    // brute-force cosine search against `embeddings` BLOB table (no native extension).
    let rows = sqlx::query("SELECT node_id, vector FROM embeddings")
        .fetch_all(&mut **tx)
        .await?;

    // compute cosine similarity and keep top `3`
    let mut candidates: Vec<(String, f32)> = Vec::new();
    for r in rows.into_iter() {
        let id: String = r.try_get("node_id")?;
        let blob: Vec<u8> = r.try_get("vector")?;
        if blob.len() % 4 != 0 {
            continue;
        }
        let vec_f: &[f32] = bytemuck::cast_slice(&blob);
        if vec_f.len() != emb.len() {
            continue;
        }
        // cosine similarity
        let dot: f32 = emb.iter().zip(vec_f.iter()).map(|(a, b)| a * b).sum();
        let na: f32 = emb.iter().map(|v| v * v).sum::<f32>().sqrt();
        let nb: f32 = vec_f.iter().map(|v| v * v).sum::<f32>().sqrt();
        if na == 0.0 || nb == 0.0 {
            continue;
        }
        let sim = (dot / (na * nb)).clamp(-1.0, 1.0);
        candidates.push((id, sim));
    }

    // sort by similarity descending and take top 3
    candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let topk: Vec<String> = candidates.iter().take(3).map(|c| c.0.clone()).collect();

    if !topk.is_empty() {
        // bump matched nodes by a fixed amount (preserve previous behavior)
        let placeholders = topk.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
        let ignite_sql = format!(
            "UPDATE nodes SET current_heat = MIN(1.0, current_heat + 0.8) WHERE id IN ({})",
            placeholders
        );
        let mut qb = sqlx::query(&ignite_sql);
        for id in topk.iter() {
            qb = qb.bind(id);
        }
        qb.execute(&mut **tx).await?;
    }

    // immediately run the tick logic inside the same transaction so heat diffuses
    tick_in_tx(storage, tx, 0.85, 1.0, 20).await?;

    Ok(())
}

/// Phase 1 API: perform a vector KNN against `vec_nodes` and inject heat based on distance.
/// This function is resilient: if `vec_nodes` is missing or the query fails, it returns Ok(())
/// so test/CI environments without the sqlite-vec extension remain functional.
pub async fn ignite(
    storage: &SqliteStorage,
    query_embedding: &[f32],
    limit: usize,
) -> anyhow::Result<()> {
    let pool = storage.pool();

    if query_embedding.is_empty() {
        return Ok(());
    }

    // Brute-force cosine KNN against `embeddings` BLOB table.
    let rows = sqlx::query("SELECT node_id, vector FROM embeddings")
        .fetch_all(pool)
        .await?;

    let mut candidates: Vec<(String, f32)> = Vec::new();
    for r in rows.into_iter() {
        let id_str: String = match r.try_get("node_id") {
            Ok(s) => s,
            Err(_) => continue,
        };
        let blob: Vec<u8> = match r.try_get("vector") {
            Ok(b) => b,
            Err(_) => continue,
        };
        if blob.len() % 4 != 0 {
            continue;
        }
        let vec_f: &[f32] = bytemuck::cast_slice(&blob);
        if vec_f.len() != query_embedding.len() {
            continue;
        }
        let dot: f32 = query_embedding.iter().zip(vec_f.iter()).map(|(a, b)| a * b).sum();
        let na: f32 = query_embedding.iter().map(|v| v * v).sum::<f32>().sqrt();
        let nb: f32 = vec_f.iter().map(|v| v * v).sum::<f32>().sqrt();
        if na == 0.0 || nb == 0.0 {
            continue;
        }
        let sim = (dot / (na * nb)).clamp(-1.0, 1.0);
        candidates.push((id_str, sim));
    }

    // sort by similarity descending and take top `limit`
    candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    for (id_str, sim) in candidates.into_iter().take(limit) {
        let bump = sim.max(0.0); // only positive similarity bumps heat
        sqlx::query("UPDATE nodes SET current_heat = MIN(1.0, current_heat + ?) WHERE id = ?")
            .bind(bump)
            .bind(id_str)
            .execute(pool)
            .await?;
    }

    Ok(())
}
