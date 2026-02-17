use std::time::Duration;

use sqlx::Row;
use tokio::task::JoinHandle;

use crate::SqliteStorage;

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
        "SELECT id, current_heat FROM nodes WHERE current_heat >= ? ORDER BY (current_heat + (base_utility * 0.5)) DESC LIMIT ?",
    )
    .bind(prune_threshold)
    .bind(active_limit as i64)
    .fetch_all(&mut **tx)
    .await?;

    // Rebuild active_index
    sqlx::query("DELETE FROM active_index")
        .execute(&mut **tx)
        .await?;

    for row in rows.iter() {
        let id_str: String = row.try_get("id")?;
        let heat: f32 = row.try_get("current_heat")?;
        sqlx::query(
            "INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) \
             ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP",
        )
        .bind(id_str.clone())
        .bind(heat)
        .execute(&mut **tx)
        .await?;
    }

    // Also render the minified JSON page-table and store in storage cache
    let json_rows = sqlx::query(
        "SELECT id, label, pointer_summary FROM nodes ORDER BY (current_heat + (base_utility * 0.5)) DESC LIMIT ?",
    )
    .bind(active_limit as i64)
    .fetch_all(&mut **tx)
    .await?;

    let mut arr: Vec<serde_json::Value> = Vec::with_capacity(json_rows.len());
    for r in json_rows.iter() {
        let id_str: String = r.try_get("id")?;
        let label: String = r.try_get("label")?;
        let pointer_summary: String = r.try_get("pointer_summary")?;
        arr.push(
            serde_json::json!({ "id": id_str, "label": label, "pointer_summary": pointer_summary }),
        );
    }
    let minified = serde_json::to_string(&arr)?;
    storage.set_active_index_json(minified);

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

/// Start a background worker that runs `tick` every `interval`.
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

    // convert to little-endian bytes (sqlite-vec expects native f32 byte layout)
    let mut blob: Vec<u8> = Vec::with_capacity(emb.len() * 4);
    for v in emb.iter() {
        blob.extend(&v.to_le_bytes());
    }

    // find top-3 matches using vec_distance_cosine (best-effort)
    let rows = sqlx::query(
        "SELECT node_id FROM vec_nodes ORDER BY vec_distance_cosine(embedding, ?) ASC LIMIT 3",
    )
    .bind(blob)
    .fetch_all(&mut **tx)
    .await
    .unwrap_or_default();

    let mut ids: Vec<String> = Vec::new();
    for r in rows.into_iter() {
        if let Ok(s) = r.try_get::<String, _>("node_id") {
            ids.push(s);
        }
    }

    if !ids.is_empty() {
        // build parameterized IN() clause
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
        let mut q = format!(
            "UPDATE nodes SET current_heat = MIN(1.0, current_heat + 0.8) WHERE id IN ({})",
            placeholders
        );
        let mut qb = sqlx::query(&q);
        for id in ids.iter() {
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

    // bytes in little-endian f32
    let mut blob: Vec<u8> = Vec::with_capacity(query_embedding.len() * 4);
    for v in query_embedding.iter() {
        blob.extend(&v.to_le_bytes());
    }

    // KNN query against sqlite-vec virtual table — gracefully handle failures.
    let rows = match sqlx::query(
        "SELECT node_id, distance FROM vec_nodes WHERE embedding MATCH ? AND k = ?",
    )
    .bind(blob)
    .bind(limit as i64)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!(error = %e, "vec_nodes KNN failed — skipping ignite");
            return Ok(());
        }
    };

    for r in rows.into_iter() {
        let id_str: String = match r.try_get("node_id") {
            Ok(s) => s,
            Err(_) => continue,
        };
        // distance may be returned as f64 or f32; try both
        let distance: f32 = match r.try_get::<f64, _>("distance") {
            Ok(d) => d as f32,
            Err(_) => r.try_get::<f32, _>("distance").unwrap_or(0.0f32),
        };

        // bump heat by (1.0 - distance) clamped at >= 0.0, then cap node heat at 1.0
        sqlx::query("UPDATE nodes SET current_heat = MIN(1.0, current_heat + MAX(0.0, 1.0 - ?)) WHERE id = ?")
            .bind(distance)
            .bind(id_str)
            .execute(pool)
            .await?;
    }

    Ok(())
}
