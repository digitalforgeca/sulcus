use std::time::Duration;

use sqlx::Row;
use tokio::task::JoinHandle;

use sulcus_core::zero_copy::NodePointer;

use crate::LocalStorage;

/// Default heat decay multiplier applied each tick (0.0–1.0).
/// Episodic memories decay at this rate; other types use type-specific exponents.
/// Exposed so MCP handler defaults and the background worker share one constant.
pub const DEFAULT_DECAY: f32 = 0.85;

/// Nodes with `current_heat` below this floor are evicted from `active_index`
/// on the next tick.  Must be > 0 to avoid keeping permanently-zero nodes alive.
pub const DEFAULT_PRUNE_FLOOR: f32 = 0.05;

/// Heat below which a node is eligible for async folding (condensing its raw
/// episodic content into a dense semantic summary backed by cold storage).
const FOLD_THRESHOLD: f32 = 0.15;

/// Internal helper: perform one thermodynamics tick inside an existing transaction.
/// PostgreSQL dialect: $N placeholders, GREATEST/LEAST scalar functions, strpos for CTE cycle detection.
async fn tick_in_tx(
    storage: &LocalStorage,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    decay: f32,
    prune_threshold: f32,
    active_limit: usize,
) -> anyhow::Result<()> {
    // Phase 2: Topological diffusion (recursive CTE, max depth = 2)
    // Only traverse currently-active edges (valid_to IS NULL).
    // strpos detects cycles in the path string (standard PostgreSQL semantics).
    sqlx::query(
        r#"
        WITH RECURSIVE
          frontier(src, dst, depth, path, transfer) AS (
            SELECT n.id AS src, e.target_id AS dst, 1 AS depth,
                   n.id || ',' || e.target_id AS path,
                   n.current_heat * e.edge_weight * 0.5 AS transfer
            FROM nodes n JOIN edges e ON e.source_id = n.id
            WHERE n.current_heat > 0.2 AND e.valid_to IS NULL

            UNION ALL

            SELECT f.src, e.target_id, f.depth + 1,
                   f.path || ',' || e.target_id,
                   f.transfer * e.edge_weight * 0.5
            FROM frontier f JOIN edges e ON e.source_id = f.dst
            WHERE f.depth < 2
              AND strpos(f.path, e.target_id) = 0
              AND e.valid_to IS NULL
              -- Thermal cutoff: skip diffusion if the transferred heat is trivial.
              -- Prevents hub-nodes with thousands of edges from touching the whole
              -- graph on every tick (turns O(E^depth) into a bounded traversal).
              AND (f.transfer * e.edge_weight * 0.5) > 0.05
          )
        UPDATE nodes
        SET current_heat = LEAST(1.0, current_heat + COALESCE(
            (SELECT SUM(transfer) FROM frontier WHERE dst = nodes.id), 0.0))
        WHERE id IN (SELECT dst FROM frontier);
    "#,
    )
    .execute(&mut **tx)
    .await?;

    // Phase 3: Temporal decay — H(t) = H_0 * exp(-lambda * dt_seconds / stability).
    //
    // lambda is derived from the caller-supplied `decay` multiplier via:
    //   lambda = -ln(decay)   (positive since 0 < decay < 1)
    // Type-specific exponents preserve the old ordering (procedural slowest, episodic fastest):
    //   $1 semantic   = 0.4 * lambda
    //   $2 preference = 0.2 * lambda
    //   $3 procedural = 0.1 * lambda
    //   $4 episodic   = 1.0 * lambda
    // dt_seconds is computed from the stored `last_accessed_at` TIMESTAMPTZ column,
    // giving true elapsed time rather than a fixed per-tick estimate.
    // stability (floor 0.001) stretches the time axis — higher stability = slower decay.
    // Pinned nodes are always exempt; result is clamped to [0, 1].
    let lam_base = -(decay as f64).ln(); // rate constant from multiplier
    sqlx::query(
        "UPDATE nodes SET current_heat = CASE
            WHEN is_pinned = TRUE THEN current_heat
            WHEN memory_type = 'semantic'   THEN GREATEST(0.0,
                (current_heat::FLOAT8 * EXP(GREATEST(-80.0, -$1 * EXTRACT(EPOCH FROM (NOW() - last_accessed_at))
                 / GREATEST(stability::FLOAT8, 0.001)))))::REAL
            WHEN memory_type = 'preference' THEN GREATEST(0.0,
                (current_heat::FLOAT8 * EXP(GREATEST(-80.0, -$2 * EXTRACT(EPOCH FROM (NOW() - last_accessed_at))
                 / GREATEST(stability::FLOAT8, 0.001)))))::REAL
            WHEN memory_type = 'procedural' THEN GREATEST(0.0,
                (current_heat::FLOAT8 * EXP(GREATEST(-80.0, -$3 * EXTRACT(EPOCH FROM (NOW() - last_accessed_at))
                 / GREATEST(stability::FLOAT8, 0.001)))))::REAL
            ELSE GREATEST(0.0,
                (current_heat::FLOAT8 * EXP(GREATEST(-80.0, -$4 * EXTRACT(EPOCH FROM (NOW() - last_accessed_at))
                 / GREATEST(stability::FLOAT8, 0.001)))))::REAL
        END
        WHERE current_heat > 0",
    )
    .bind(0.4 * lam_base) // $1 semantic   — slowest  (old: decay^0.4)
    .bind(0.2 * lam_base) // $2 preference           (old: decay^0.2)
    .bind(0.1 * lam_base) // $3 procedural — very slow (old: decay^0.1)
    .bind(lam_base)        // $4 episodic   — full rate (old: decay^1.0)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        "UPDATE nodes SET current_heat = 0.0 WHERE is_pinned = FALSE AND current_heat < 0.05",
    )
    .execute(&mut **tx)
    .await?;

    sqlx::query("UPDATE nodes SET current_heat = 1.0 WHERE current_heat > 1.0")
        .execute(&mut **tx)
        .await?;

    // Phase 4: active_index from score = current_heat + (base_utility * 0.5)
    // with inhibition-of-return penalty (floor 60%).
    // GREATEST clamps the inhibition-of-return score (standard PostgreSQL).
    let rows = sqlx::query(
        "SELECT id, label, pointer_summary, current_heat, \
         COALESCE((SELECT consecutive_active_ticks FROM active_index WHERE node_id = nodes.id), 0) AS cat \
         FROM nodes WHERE current_heat >= $1 \
         ORDER BY ((current_heat + (base_utility * 0.5)) * GREATEST(0.6, 1.0 - \
           (COALESCE((SELECT consecutive_active_ticks FROM active_index WHERE node_id = nodes.id), 0) * 0.03))) DESC \
         LIMIT $2",
    )
    .bind(prune_threshold)
    .bind(active_limit as i64)
    .fetch_all(&mut **tx)
    .await?;

    // Rebuild active_index table: reset ticks for nodes that dropped out.
    sqlx::query(
        "UPDATE active_index SET consecutive_active_ticks = 0 \
         WHERE node_id NOT IN (SELECT id FROM nodes WHERE current_heat >= $1)",
    )
    .bind(prune_threshold)
    .execute(&mut **tx)
    .await
    .ok();
    sqlx::query("DELETE FROM active_index")
        .execute(&mut **tx)
        .await?;

    let mut pointers: Vec<NodePointer> = Vec::with_capacity(rows.len());
    for row in rows.iter() {
        let id_str: String = row.try_get("id")?;
        let heat: f32 = row.try_get("current_heat")?;
        let label: String = row.try_get("label")?;
        let summary: String = row.try_get("pointer_summary")?;
        let cat: i64 = row.try_get("cat").unwrap_or(0);
        if let Ok(id) = uuid::Uuid::parse_str(&id_str) {
            pointers.push(NodePointer::from_node(id, heat, &label, &summary));
        }
        sqlx::query(
            "INSERT INTO active_index (node_id, heat, consecutive_active_ticks, updated_at) \
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP) \
             ON CONFLICT(node_id) DO UPDATE SET heat = EXCLUDED.heat, \
               consecutive_active_ticks = EXCLUDED.consecutive_active_ticks, \
               updated_at = CURRENT_TIMESTAMP",
        )
        .bind(id_str.clone())
        .bind(heat)
        .bind(cat + 1)
        .execute(&mut **tx)
        .await?;
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
    storage: &LocalStorage,
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

/// Start a background worker that runs `tick` every `base_interval` (adjusted by
/// adaptive backoff), then asynchronously folds cold nodes to condense episodic memory.
///
/// # Adaptive Backoff
///
/// To ensure SULCUS remains performant as the knowledge graph grows, the worker
/// dynamically adjusts its sleep duration based on the number of nodes and edges.
/// The `base_interval` is multiplied by the log10 of the total item count (min 10).
/// This prevents expensive recursive CTEs from starving the CPU on massive graphs.
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
    storage: LocalStorage,
    decay: f32,
    prune_threshold: f32,
    active_limit: usize,
    base_interval: Duration,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            // Adaptive Backoff: frequency = base_interval * log10(max(10, nodes + edges))
            let node_count = storage.count_nodes().await.unwrap_or(0);
            let edge_count = storage.count_edges().await.unwrap_or(0);
            let total_items = (node_count + edge_count).max(10) as f64;
            let multiplier = total_items.log10();
            let adaptive_interval = base_interval.mul_f64(multiplier);

            if let Err(e) = tick(&storage, decay, prune_threshold, active_limit).await {
                tracing::error!(error = %e, "thermodynamics tick failed");
            }

            // Async fold: detect cold nodes and condense their episodic content.
            // Run in a separate task so it never blocks the tick cadence.
            let storage_fold = storage.clone();
            tokio::spawn(async move {
                if let Err(e) = crate::folds::fold_cold_nodes(&storage_fold, FOLD_THRESHOLD).await
                {
                    tracing::debug!(error = %e, "async fold pass completed with errors");
                }
            });

            // Memory Consolidation Loop: synthesise hot-cluster insight edges.
            // Runs asynchronously so it never delays the tick cadence.
            // Skipped on very small graphs (< 3 nodes) to avoid pointless synthesis.
            if node_count >= 3 {
                let storage_cons = storage.clone();
                tokio::spawn(async move {
                    if let Err(e) =
                        crate::consolidation::consolidate_hot_clusters(&storage_cons).await
                    {
                        tracing::debug!(error = %e, "consolidation pass completed with errors");
                    }
                });
            }

            tokio::time::sleep(adaptive_interval).await;
        }
    })
}

/// Ignite the semantic graph from a user prompt using PostgreSQL transaction.
pub async fn ignite_context(
    user_prompt: &str,
    provider: &dyn crate::embeddings::EmbeddingProvider,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    storage: &LocalStorage,
) -> anyhow::Result<()> {
    // embed the prompt
    let emb = provider.embed(user_prompt)?;
    if emb.is_empty() {
        return Ok(());
    }

    // Cosine top-3 search via in-memory cache — math under read lock, no clone.
    let topk: Vec<String> = storage
        .search_vectors(&emb, 3)
        .await
        .into_iter()
        .map(|(id, _)| id.to_string())
        .collect();

    if !topk.is_empty() {
        // Use ANY($1) for idiomatic PostgreSQL IN-list without dynamic SQL.
        sqlx::query(
            "UPDATE nodes \
             SET current_heat    = LEAST(1.0, current_heat + 0.8), \
                 last_accessed_at = NOW(), \
                 stability        = stability * 1.5 \
             WHERE id = ANY($1)",
        )
        .bind(&topk)
        .execute(&mut **tx)
        .await?;
    }

    // immediately run the tick logic inside the same transaction so heat diffuses
    tick_in_tx(storage, tx, 0.85, 1.0, 100).await?;

    Ok(())
}

/// Phase 1 API: perform a vector KNN against `vec_nodes` and inject heat based on distance.
/// This function is resilient: if `vec_nodes` is missing or the query fails, it returns Ok(())
/// so test/CI environments without the PGLite vec cache populated remain functional.
pub async fn ignite(
    storage: &LocalStorage,
    query_embedding: &[f32],
    limit: usize,
) -> anyhow::Result<()> {
    let pool = storage.pool();

    if query_embedding.is_empty() {
        return Ok(());
    }

    // Cosine top-k via in-memory cache — math under read lock, no deep clone.
    let candidates = storage.search_vectors(query_embedding, limit).await;
    for (id, sim) in candidates.into_iter() {
        let id_str = id.to_string();
        let bump = sim.max(0.0); // only positive similarity bumps heat
        sqlx::query(
            "UPDATE nodes \
             SET current_heat    = LEAST(1.0, current_heat + $1), \
                 last_accessed_at = NOW(), \
                 stability        = stability * 1.5 \
             WHERE id = $2",
        )
            .bind(bump)
            .bind(id_str)
            .execute(pool)
            .await?;
    }

    Ok(())
}
