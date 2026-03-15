//! Background worker for the cloud server.
//!
//! Runs a periodic tick loop that:
//! 1. Applies thermodynamic decay to all tenants' golden_index
//! 2. Populates the active_index with the hottest nodes
//! 3. Generates golden_edges based on co-occurrence within the same tenant
//!
//! Runs every 5 minutes (300s). Loads ThermoConfig per-tenant from the database.

use sqlx::PgPool;

/// Spawn the background worker as a tokio task.
pub fn spawn(pool: PgPool) {
    tokio::spawn(async move {
        tracing::info!("background worker started (tick interval: 300s)");
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        // Don't run immediately on startup — let the server warm up first
        interval.tick().await;

        loop {
            interval.tick().await;
            if let Err(e) = run_tick(&pool).await {
                tracing::warn!(error = %e, "background tick failed");
            }
        }
    });
}

/// Run one tick cycle for all tenants.
async fn run_tick(pool: &PgPool) -> anyhow::Result<()> {
    // Get all active tenants
    let tenants: Vec<String> = sqlx::query_scalar("SELECT DISTINCT tenant_id FROM golden_index")
        .fetch_all(pool)
        .await?;

    for tenant_id in &tenants {
        if let Err(e) = tick_tenant(pool, tenant_id).await {
            tracing::warn!(tenant_id = %tenant_id, error = %e, "tick failed for tenant");
        }
    }

    Ok(())
}

/// Apply decay + populate active_index + generate edges for a single tenant.
async fn tick_tenant(pool: &PgPool, tenant_id: &str) -> anyhow::Result<()> {
    // Load thermo config for this tenant (or use defaults)
    let config = crate::thermo_api::load_tenant_config(pool, tenant_id).await;

    // 1. Apply thermodynamic decay to golden_index
    //    Uses elapsed time since last update and per-type half-lives.
    let decayed = sqlx::query(
        "UPDATE golden_index SET
           current_heat = GREATEST(
             CASE memory_type
               WHEN 'episodic'   THEN $2
               WHEN 'semantic'   THEN $3
               WHEN 'procedural' THEN $4
               WHEN 'preference' THEN $5
               WHEN 'synthesis'  THEN $6
               ELSE $2
             END,
             current_heat * power(0.5, EXTRACT(EPOCH FROM (now() - updated_at)) /
               CASE memory_type
                 WHEN 'episodic'   THEN $7
                 WHEN 'semantic'   THEN $8
                 WHEN 'procedural' THEN $9
                 WHEN 'preference' THEN $10
                 WHEN 'synthesis'  THEN $11
                 ELSE $7
               END
             )
           ),
           updated_at = now()
         WHERE tenant_id = $1
           AND current_heat > 0.01
           AND is_pinned = false",
    )
    .bind(tenant_id)
    // Floors
    .bind(
        config
            .decay_profiles
            .get("episodic")
            .map(|p| p.floor)
            .unwrap_or(0.01),
    )
    .bind(
        config
            .decay_profiles
            .get("semantic")
            .map(|p| p.floor)
            .unwrap_or(0.05),
    )
    .bind(
        config
            .decay_profiles
            .get("procedural")
            .map(|p| p.floor)
            .unwrap_or(0.08),
    )
    .bind(
        config
            .decay_profiles
            .get("preference")
            .map(|p| p.floor)
            .unwrap_or(0.10),
    )
    .bind(
        config
            .decay_profiles
            .get("synthesis")
            .map(|p| p.floor)
            .unwrap_or(0.05),
    )
    // Half-lives in seconds
    .bind(
        config
            .decay_profiles
            .get("episodic")
            .map(|p| p.half_life_secs)
            .unwrap_or(86400.0),
    )
    .bind(
        config
            .decay_profiles
            .get("semantic")
            .map(|p| p.half_life_secs)
            .unwrap_or(2592000.0),
    )
    .bind(
        config
            .decay_profiles
            .get("procedural")
            .map(|p| p.half_life_secs)
            .unwrap_or(15552000.0),
    )
    .bind(
        config
            .decay_profiles
            .get("preference")
            .map(|p| p.half_life_secs)
            .unwrap_or(7776000.0),
    )
    .bind(
        config
            .decay_profiles
            .get("synthesis")
            .map(|p| p.half_life_secs)
            .unwrap_or(5184000.0),
    )
    .execute(pool)
    .await?;

    tracing::debug!(tenant_id = %tenant_id, rows = decayed.rows_affected(), "decay applied");

    // 2. Rebuild active_index — top N hottest nodes for this tenant
    //    Note: active_index has FK to `nodes` (WASM/local table), not `golden_index`.
    //    On cloud server, we skip active_index population since the FK would fail.
    //    Instead, hot_nodes queries go directly against golden_index (which they already do).
    //    The active_index is a local-only optimization.
    let hot_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM golden_index WHERE tenant_id = $1 AND current_heat > $2",
    )
    .bind(tenant_id)
    .bind(config.active_index.hot_threshold)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    tracing::debug!(tenant_id = %tenant_id, hot_nodes = hot_count, "hot node count after decay");

    // 3. Generate golden_edges based on memory_type co-occurrence.
    //    Connect nodes of the same type that were created within 1 hour of each other.
    //    PK is (tenant_id, source_id, target_id) — ON CONFLICT skips duplicates.
    //    This is a heuristic — real semantic similarity needs embeddings (future).
    let edges_inserted = sqlx::query(
        "INSERT INTO golden_edges (tenant_id, source_id, target_id, edge_type, weight, updated_at)
         SELECT DISTINCT ON (LEAST(a.id, b.id), GREATEST(a.id, b.id))
           $1, LEAST(a.id, b.id), GREATEST(a.id, b.id), 'temporal_proximity', 0.5, now()
         FROM golden_index a
         JOIN golden_index b ON a.tenant_id = b.tenant_id
           AND a.id < b.id
           AND a.memory_type = b.memory_type
           AND ABS(EXTRACT(EPOCH FROM (a.updated_at - b.updated_at))) < 3600
         WHERE a.tenant_id = $1
         ON CONFLICT (tenant_id, source_id, target_id) DO NOTHING",
    )
    .bind(tenant_id)
    .execute(pool)
    .await?;

    tracing::debug!(tenant_id = %tenant_id, edges = edges_inserted.rows_affected(), "edges generated");

    Ok(())
}
