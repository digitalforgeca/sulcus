use std::time::Duration;

use sqlx::Row;
use tokio::task::JoinHandle;

use crate::SqliteStorage;

/// Perform one thermodynamics tick:
/// - decay all node heats by `decay`
/// - build the `active_index` from the top `active_limit` nodes (only nodes with heat >= prune_threshold)
pub async fn tick(
    storage: &SqliteStorage,
    decay: f32,
    prune_threshold: f32,
    active_limit: usize,
) -> anyhow::Result<()> {
    let pool = storage.pool();
    let mut tx = pool.begin().await?;

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
    .execute(&mut *tx)
    .await?;

    // Phase 3: Temporal decay (skip pinned nodes). Apply decay, then floor-clamp < 0.05 -> 0.0, and cap at 1.0.
    sqlx::query("UPDATE nodes SET current_heat = CASE WHEN is_pinned = 1 THEN current_heat ELSE current_heat * ? END WHERE current_heat > 0")
        .bind(decay)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE nodes SET current_heat = 0.0 WHERE is_pinned = 0 AND current_heat < 0.05")
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE nodes SET current_heat = 1.0 WHERE current_heat > 1.0")
        .execute(&mut *tx)
        .await?;

    // Phase 4: Page table rendering — build active_index from score = current_heat + (base_utility * 0.5)
    let rows = sqlx::query(
        "SELECT id, current_heat FROM nodes WHERE current_heat >= ? ORDER BY (current_heat + (base_utility * 0.5)) DESC LIMIT ?",
    )
    .bind(prune_threshold)
    .bind(active_limit as i64)
    .fetch_all(&mut *tx)
    .await?;

    // Rebuild active_index
    sqlx::query("DELETE FROM active_index")
        .execute(&mut *tx)
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
        .execute(&mut *tx)
        .await?;
    }

    // Also render the minified JSON page-table and store in storage cache
    let json_rows = sqlx::query(
        "SELECT id, label, pointer_summary FROM nodes ORDER BY (current_heat + (base_utility * 0.5)) DESC LIMIT ?",
    )
    .bind(active_limit as i64)
    .fetch_all(&mut *tx)
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

    tx.commit().await?;

    // update prometheus gauge for active_index size if initialized
    if let Some(m) = crate::metrics::try_get() {
        m.active_index_size.set(rows.len() as f64);
    }

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
