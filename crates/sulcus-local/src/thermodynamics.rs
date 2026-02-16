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

    // 1) Decay
    sqlx::query("UPDATE nodes SET heat = heat * ? WHERE heat > 0")
        .bind(decay)
        .execute(&mut *tx)
        .await?;

    // 2) Select top N nodes above prune threshold
    let rows = sqlx::query("SELECT id, heat FROM nodes WHERE heat >= ? ORDER BY heat DESC LIMIT ?")
        .bind(prune_threshold)
        .bind(active_limit as i64)
        .fetch_all(&mut *tx)
        .await?;

    // 3) Rebuild active_index: simple approach -> clear + insert top N
    sqlx::query("DELETE FROM active_index")
        .execute(&mut *tx)
        .await?;

    for row in rows.iter() {
        let id_str: String = row.try_get("id")?;
        let heat: f32 = row.try_get("heat")?;
        sqlx::query(
            "INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) \
             ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP",
        )
        .bind(id_str)
        .bind(heat)
        .execute(&mut *tx)
        .await?;
    }

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
