//! Background worker for the cloud server.
//!
//! Runs a periodic tick loop that:
//! 1. Applies thermodynamic decay to all tenants' golden_index
//! 2. Populates the active_index with the hottest nodes
//! 3. Generates golden_edges based on co-occurrence within the same tenant
//!
//! Also provides `apply_resonance()` — BFS heat diffusion called on recall.
//!
//! Runs every 5 minutes (300s). Loads ThermoConfig per-tenant from the database.

use sqlx::PgPool;
use std::sync::Arc;
use crate::siu_v2::SiuV2Classifier;

/// Spawn the background worker as a tokio task.
pub fn spawn(pool: PgPool, situ: Option<Arc<SiuV2Classifier>>) {
    tokio::spawn(async move {
        tracing::info!("background worker started (tick interval: 300s)");
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        // Don't run immediately on startup — let the server warm up first
        interval.tick().await;

        loop {
            interval.tick().await;
            if let Err(e) = run_tick(&pool, situ.as_ref()).await {
                tracing::warn!(error = %e, "background tick failed");
            }
        }
    });
}

/// Run one tick cycle for all tenants.
async fn run_tick(pool: &PgPool, situ: Option<&Arc<SiuV2Classifier>>) -> anyhow::Result<()> {
    // Get all active tenants
    let tenants: Vec<String> = sqlx::query_scalar("SELECT DISTINCT tenant_id FROM golden_index")
        .fetch_all(pool)
        .await?;

    for tenant_id in &tenants {
        if let Err(e) = tick_tenant(pool, tenant_id, situ).await {
            tracing::warn!(tenant_id = %tenant_id, error = %e, "tick failed for tenant");
        }
    }

    Ok(())
}

/// Apply decay + populate active_index + generate edges for a single tenant.
async fn tick_tenant(pool: &PgPool, tenant_id: &str, situ: Option<&Arc<SiuV2Classifier>>) -> anyhow::Result<()> {
    // Load thermo config for this tenant (or use defaults)
    let config = crate::thermo_api::load_tenant_config(pool, tenant_id).await;

    // 1. Apply thermodynamic decay to golden_index.
    //    Formula depends on decay_mode:
    //    - Time:        power(0.5, elapsed_secs / half_life_secs)
    //    - Interaction: power(0.5, (ns_epoch - node_epoch) / half_life_interactions)
    //    - Hybrid:      min(time_decay, interaction_decay)
    use sulcus_types::thermo::DecayMode;
    let decayed = match config.decay_mode {
        DecayMode::Time => apply_time_decay(pool, tenant_id, &config).await?,
        DecayMode::Interaction => apply_interaction_decay(pool, tenant_id, &config).await?,
        DecayMode::Hybrid => {
            // Apply both; the SQL uses the minimum (fastest decay)
            apply_hybrid_decay(pool, tenant_id, &config).await?
        }
    };

    tracing::debug!(tenant_id = %tenant_id, rows = decayed, "decay applied");

    // Evaluate on_decay and on_threshold triggers for nodes that crossed thresholds
    // Only check nodes below 0.2 heat (likely threshold candidates) to avoid scanning all nodes
    if let Ok(threshold_rows) = sqlx::query_as::<_, (String, String, String, Option<String>, f32)>(
        "SELECT id::text, pointer_summary, memory_type, namespace, current_heat \
         FROM golden_index WHERE tenant_id = $1 AND current_heat < 0.2 AND current_heat > 0.01 AND is_pinned = false \
         LIMIT 50"
    ).bind(tenant_id).fetch_all(pool).await {
        for (nid, label, mt, ns, heat) in threshold_rows {
            let ctx = crate::trigger_engine::TriggerContext {
                tenant_id: tenant_id.to_string(),
                node_id: Some(nid),
                node_label: Some(label),
                node_namespace: ns,
                node_memory_type: Some(mt),
                node_heat: Some(heat),
                old_heat: None,
            };
            let _ = crate::trigger_engine::evaluate_triggers_with_situ(
                pool, crate::trigger_engine::TriggerEvent::OnDecay, &ctx, situ,
            ).await;
            let _ = crate::trigger_engine::evaluate_triggers_with_situ(
                pool, crate::trigger_engine::TriggerEvent::OnThreshold, &ctx, situ,
            ).await;
        }
    }

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
    //    Connect nodes of the same type updated within 10 minutes of each other.
    //    Weight decays with temporal distance: 1.0 at 0s → ~0.37 at 5min.
    //    Cap: each node gets at most 5 edges per tick (closest neighbors win).
    //    PK is (tenant_id, source_id, target_id) — ON CONFLICT skips duplicates.
    //    This is a heuristic — real semantic similarity needs embeddings (future).
    //
    //    OPTIMIZATION: Only consider node pairs where at least one node was updated
    //    since the last tick (900s = 300s tick + 600s proximity window). This avoids
    //    a full self-join of the entire golden_index every 5 minutes. With 1300+ nodes
    //    the unfiltered self-join was taking 2.8-3.0 seconds per run for 0 new edges.
    let edges_inserted = sqlx::query(
        "INSERT INTO golden_edges (tenant_id, source_id, target_id, edge_type, weight, updated_at)
         SELECT $1, source_id, target_id, 'temporal_proximity', weight, now()
         FROM (
           SELECT
             LEAST(a.id, b.id) AS source_id,
             GREATEST(a.id, b.id) AS target_id,
             EXP(-ABS(EXTRACT(EPOCH FROM (a.updated_at - b.updated_at))) / 300.0)::REAL AS weight,
             ROW_NUMBER() OVER (PARTITION BY a.id ORDER BY ABS(EXTRACT(EPOCH FROM (a.updated_at - b.updated_at)))) AS rn
           FROM golden_index a
           JOIN golden_index b ON a.tenant_id = b.tenant_id
             AND a.id < b.id
             AND a.memory_type = b.memory_type
             AND ABS(EXTRACT(EPOCH FROM (a.updated_at - b.updated_at))) < 600
             AND ABS(EXTRACT(EPOCH FROM (a.updated_at - b.updated_at))) > 0.001
           WHERE a.tenant_id = $1
             AND (a.updated_at > now() - INTERVAL '900 seconds'
                  OR b.updated_at > now() - INTERVAL '900 seconds')
         ) ranked
         WHERE rn <= 5
         ON CONFLICT (tenant_id, source_id, target_id) DO NOTHING",
    )
    .bind(tenant_id)
    .execute(pool)
    .await?;

    tracing::debug!(tenant_id = %tenant_id, edges = edges_inserted.rows_affected(), "edges generated");

    // 4. Resonance — DISABLED in background worker.
    //    The decay step sets `updated_at = now()` on every node, which made the
    //    resonance query (`updated_at > now() - 300s`) match ALL nodes — warming
    //    them right back up after decay. This completely neutralized decay.
    //    
    //    Resonance now runs ONLY inline on explicit recall (in agent.rs search
    //    handlers), where it correctly targets only the actually-recalled nodes.
    //    A future `last_recalled_at` column could re-enable background resonance
    //    without the updated_at collision.

    Ok(())
}

// ---------------------------------------------------------------------------
// Decay helpers
// ---------------------------------------------------------------------------

/// Time-based decay (original wall-clock formula). Returns rows affected.
async fn apply_time_decay(
    pool: &PgPool,
    tenant_id: &str,
    config: &sulcus_types::thermo::ThermoConfig,
) -> anyhow::Result<u64> {
    let result = sqlx::query(
        "UPDATE golden_index SET
           current_heat = GREATEST(
             CASE memory_type
               WHEN 'episodic'   THEN $2
               WHEN 'semantic'   THEN $3
               WHEN 'procedural' THEN $4
               WHEN 'preference' THEN $5
               WHEN 'synthesis'  THEN $6
               WHEN 'fact'       THEN $7
               ELSE $2
             END,
             current_heat * power(0.5, EXTRACT(EPOCH FROM (now() - updated_at)) /
               CASE memory_type
                 WHEN 'episodic'   THEN $8
                 WHEN 'semantic'   THEN $9
                 WHEN 'procedural' THEN $10
                 WHEN 'preference' THEN $11
                 WHEN 'synthesis'  THEN $12
                 WHEN 'fact'       THEN $13
                 ELSE $8
               END
             )
           ),
           updated_at = now()
         WHERE tenant_id = $1
           AND current_heat > 0.01
           AND is_pinned = false",
    )
    .bind(tenant_id)
    .bind(config.decay_profiles.get("episodic").map(|p| p.floor).unwrap_or(0.01))
    .bind(config.decay_profiles.get("semantic").map(|p| p.floor).unwrap_or(0.05))
    .bind(config.decay_profiles.get("procedural").map(|p| p.floor).unwrap_or(0.08))
    .bind(config.decay_profiles.get("preference").map(|p| p.floor).unwrap_or(0.10))
    .bind(config.decay_profiles.get("synthesis").map(|p| p.floor).unwrap_or(0.05))
    .bind(config.decay_profiles.get("fact").map(|p| p.floor).unwrap_or(0.15))
    .bind(config.decay_profiles.get("episodic").map(|p| p.half_life_secs).unwrap_or(86400.0))
    .bind(config.decay_profiles.get("semantic").map(|p| p.half_life_secs).unwrap_or(2592000.0))
    .bind(config.decay_profiles.get("procedural").map(|p| p.half_life_secs).unwrap_or(15552000.0))
    .bind(config.decay_profiles.get("preference").map(|p| p.half_life_secs).unwrap_or(7776000.0))
    .bind(config.decay_profiles.get("synthesis").map(|p| p.half_life_secs).unwrap_or(5184000.0))
    .bind(config.decay_profiles.get("fact").map(|p| p.half_life_secs).unwrap_or(31536000.0))
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Interaction-epoch based decay. Returns rows affected.
async fn apply_interaction_decay(
    pool: &PgPool,
    tenant_id: &str,
    config: &sulcus_types::thermo::ThermoConfig,
) -> anyhow::Result<u64> {
    let result = sqlx::query(
        "UPDATE golden_index gi SET
           current_heat = GREATEST(
             CASE gi.memory_type
               WHEN 'episodic'   THEN $2
               WHEN 'semantic'   THEN $3
               WHEN 'procedural' THEN $4
               WHEN 'preference' THEN $5
               WHEN 'synthesis'  THEN $6
               WHEN 'fact'       THEN $7
               ELSE $2
             END,
             gi.current_heat * power(0.5,
               (COALESCE(ns.interaction_epoch, 0) - gi.interaction_epoch)::float /
               CASE gi.memory_type
                 WHEN 'episodic'   THEN $8
                 WHEN 'semantic'   THEN $9
                 WHEN 'procedural' THEN $10
                 WHEN 'preference' THEN $11
                 WHEN 'synthesis'  THEN $12
                 WHEN 'fact'       THEN $13
                 ELSE $8
               END
             )
           ),
           updated_at = now()
         FROM (
           SELECT namespace, interaction_epoch
           FROM namespace_counters
           WHERE tenant_id = $1
         ) ns
         WHERE gi.tenant_id = $1
           AND gi.namespace = ns.namespace
           AND gi.current_heat > 0.01
           AND gi.is_pinned = false",
    )
    .bind(tenant_id)
    .bind(config.decay_profiles.get("episodic").map(|p| p.floor).unwrap_or(0.01))
    .bind(config.decay_profiles.get("semantic").map(|p| p.floor).unwrap_or(0.05))
    .bind(config.decay_profiles.get("procedural").map(|p| p.floor).unwrap_or(0.08))
    .bind(config.decay_profiles.get("preference").map(|p| p.floor).unwrap_or(0.10))
    .bind(config.decay_profiles.get("synthesis").map(|p| p.floor).unwrap_or(0.05))
    .bind(config.decay_profiles.get("fact").map(|p| p.floor).unwrap_or(0.15))
    .bind(config.decay_profiles.get("episodic").map(|p| p.half_life_interactions).unwrap_or(50.0))
    .bind(config.decay_profiles.get("semantic").map(|p| p.half_life_interactions).unwrap_or(500.0))
    .bind(config.decay_profiles.get("procedural").map(|p| p.half_life_interactions).unwrap_or(2000.0))
    .bind(config.decay_profiles.get("preference").map(|p| p.half_life_interactions).unwrap_or(1000.0))
    .bind(config.decay_profiles.get("synthesis").map(|p| p.half_life_interactions).unwrap_or(800.0))
    .bind(config.decay_profiles.get("fact").map(|p| p.half_life_interactions).unwrap_or(5000.0))
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Hybrid decay: min(time_decay, interaction_decay) per node. Returns rows affected.
async fn apply_hybrid_decay(
    pool: &PgPool,
    tenant_id: &str,
    config: &sulcus_types::thermo::ThermoConfig,
) -> anyhow::Result<u64> {
    let result = sqlx::query(
        "UPDATE golden_index gi SET
           current_heat = GREATEST(
             CASE gi.memory_type
               WHEN 'episodic'   THEN $2
               WHEN 'semantic'   THEN $3
               WHEN 'procedural' THEN $4
               WHEN 'preference' THEN $5
               WHEN 'synthesis'  THEN $6
               WHEN 'fact'       THEN $7
               ELSE $2
             END,
             gi.current_heat * LEAST(
               power(0.5, EXTRACT(EPOCH FROM (now() - gi.updated_at)) /
                 CASE gi.memory_type
                   WHEN 'episodic'   THEN $8
                   WHEN 'semantic'   THEN $9
                   WHEN 'procedural' THEN $10
                   WHEN 'preference' THEN $11
                   WHEN 'synthesis'  THEN $12
                   WHEN 'fact'       THEN $13
                   ELSE $8
                 END),
               power(0.5,
                 (COALESCE(ns.interaction_epoch, 0) - gi.interaction_epoch)::float /
                 CASE gi.memory_type
                   WHEN 'episodic'   THEN $14
                   WHEN 'semantic'   THEN $15
                   WHEN 'procedural' THEN $16
                   WHEN 'preference' THEN $17
                   WHEN 'synthesis'  THEN $18
                   WHEN 'fact'       THEN $19
                   ELSE $14
                 END)
             )
           ),
           updated_at = now()
         FROM (
           SELECT namespace, interaction_epoch
           FROM namespace_counters
           WHERE tenant_id = $1
         ) ns
         WHERE gi.tenant_id = $1
           AND gi.namespace = ns.namespace
           AND gi.current_heat > 0.01
           AND gi.is_pinned = false",
    )
    .bind(tenant_id)
    .bind(config.decay_profiles.get("episodic").map(|p| p.floor).unwrap_or(0.01))
    .bind(config.decay_profiles.get("semantic").map(|p| p.floor).unwrap_or(0.05))
    .bind(config.decay_profiles.get("procedural").map(|p| p.floor).unwrap_or(0.08))
    .bind(config.decay_profiles.get("preference").map(|p| p.floor).unwrap_or(0.10))
    .bind(config.decay_profiles.get("synthesis").map(|p| p.floor).unwrap_or(0.05))
    .bind(config.decay_profiles.get("fact").map(|p| p.floor).unwrap_or(0.15))
    // Time half-lives
    .bind(config.decay_profiles.get("episodic").map(|p| p.half_life_secs).unwrap_or(86400.0))
    .bind(config.decay_profiles.get("semantic").map(|p| p.half_life_secs).unwrap_or(2592000.0))
    .bind(config.decay_profiles.get("procedural").map(|p| p.half_life_secs).unwrap_or(15552000.0))
    .bind(config.decay_profiles.get("preference").map(|p| p.half_life_secs).unwrap_or(7776000.0))
    .bind(config.decay_profiles.get("synthesis").map(|p| p.half_life_secs).unwrap_or(5184000.0))
    .bind(config.decay_profiles.get("fact").map(|p| p.half_life_secs).unwrap_or(31536000.0))
    // Interaction half-lives
    .bind(config.decay_profiles.get("episodic").map(|p| p.half_life_interactions).unwrap_or(50.0))
    .bind(config.decay_profiles.get("semantic").map(|p| p.half_life_interactions).unwrap_or(500.0))
    .bind(config.decay_profiles.get("procedural").map(|p| p.half_life_interactions).unwrap_or(2000.0))
    .bind(config.decay_profiles.get("preference").map(|p| p.half_life_interactions).unwrap_or(1000.0))
    .bind(config.decay_profiles.get("synthesis").map(|p| p.half_life_interactions).unwrap_or(800.0))
    .bind(config.decay_profiles.get("fact").map(|p| p.half_life_interactions).unwrap_or(5000.0))
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

// ---------------------------------------------------------------------------
// Resonance — BFS heat diffusion through golden_edges
// ---------------------------------------------------------------------------

/// Apply heat resonance from a set of source nodes outward through the graph.
///
/// For each hop:
///   neighbor_boost = source_heat * spread_factor * damping^hop
///
/// Only boosts nodes above `thermal_gate`. Caps at heat 1.0.
/// Updates are done in a single batch per hop for efficiency.
pub async fn apply_resonance(
    pool: &PgPool,
    tenant_id: &str,
    source_ids: &[&str],
    spread_factor: f32,
    damping: f32,
    thermal_gate: f32,
    max_depth: u32,
) -> anyhow::Result<u64> {
    if source_ids.is_empty() || spread_factor <= 0.0 {
        return Ok(0);
    }

    let mut total_updated = 0u64;
    let mut current_frontier: Vec<String> = source_ids.iter().map(|s| s.to_string()).collect();
    let mut visited: std::collections::HashSet<String> = current_frontier.iter().cloned().collect();

    for hop in 0..max_depth {
        if current_frontier.is_empty() {
            break;
        }

        let hop_factor = spread_factor * damping.powi(hop as i32);
        if hop_factor < 0.001 {
            break; // negligible contribution
        }

        // Find neighbors of the current frontier via golden_edges
        // This uses a parameterized ANY($2) for the frontier IDs
        let frontier_uuids: Vec<String> = current_frontier.clone();

        let neighbors: Vec<(String, f32)> = sqlx::query_as(
            "SELECT DISTINCT
               CASE WHEN source_id::text = ANY($2) THEN target_id::text ELSE source_id::text END AS neighbor_id,
               gi.current_heat
             FROM golden_edges ge
             JOIN golden_index gi ON gi.tenant_id = $1
               AND gi.id = CASE WHEN ge.source_id::text = ANY($2) THEN ge.target_id ELSE ge.source_id END
             WHERE ge.tenant_id = $1
               AND (ge.source_id::text = ANY($2) OR ge.target_id::text = ANY($2))
               AND gi.current_heat > $3
               AND gi.is_pinned = false
             LIMIT 200"
        )
        .bind(tenant_id)
        .bind(&frontier_uuids)
        .bind(thermal_gate)
        .fetch_all(pool)
        .await?;

        let mut next_frontier = Vec::new();
        for (nid, current_heat) in &neighbors {
            if visited.contains(nid) {
                continue;
            }
            visited.insert(nid.clone());

            let boost = hop_factor * (1.0 - current_heat).max(0.0); // diminishing returns near 1.0
            if boost < 0.001 {
                continue;
            }

            let new_heat = (current_heat + boost).min(1.0);
            let result = sqlx::query(
                "UPDATE golden_index SET current_heat = $1, updated_at = now() \
                 WHERE tenant_id = $2 AND id = $3::uuid AND is_pinned = false AND current_heat < $1"
            )
            .bind(new_heat)
            .bind(tenant_id)
            .bind(nid)
            .execute(pool)
            .await?;

            if result.rows_affected() > 0 {
                total_updated += 1;
                next_frontier.push(nid.clone());
            }
        }

        current_frontier = next_frontier;
    }

    if total_updated > 0 {
        tracing::debug!(tenant_id = %tenant_id, nodes_warmed = total_updated, "resonance applied");
    }

    Ok(total_updated)
}
