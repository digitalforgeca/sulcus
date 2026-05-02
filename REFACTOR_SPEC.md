# Sulcus v2.2.0 — Interaction-Based Decay + SIU Curation Cycle

## Overview

Refactor the thermodynamic engine from wall-clock decay to interaction-based decay,
and add an SIU curation cycle ("sleep") that reviews/reclassifies/consolidates memories.

## Phase A: Database Migration

Add columns to `golden_index`:

```sql
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS recall_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS last_recalled_at TIMESTAMPTZ;
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS interaction_epoch BIGINT NOT NULL DEFAULT 0;
```

Add a namespace-level interaction counter table:

```sql
CREATE TABLE IF NOT EXISTS namespace_counters (
  tenant_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  interaction_epoch BIGINT NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, namespace)
);
```

**File:** `crates/sulcus-server/src/db.rs` — add migration in `ensure_schema()` or wherever migrations run.

## Phase B: Interaction Epoch Tracking

On every store/recall/patch/boost, increment the namespace's `interaction_epoch`:

```sql
INSERT INTO namespace_counters (tenant_id, namespace, interaction_epoch, last_active_at)
VALUES ($1, $2, 1, now())
ON CONFLICT (tenant_id, namespace) DO UPDATE SET
  interaction_epoch = namespace_counters.interaction_epoch + 1,
  last_active_at = now();
```

And stamp the touched node:

```sql
UPDATE golden_index SET 
  interaction_epoch = (SELECT interaction_epoch FROM namespace_counters WHERE tenant_id = $1 AND namespace = $2),
  last_recalled_at = now(),
  recall_count = recall_count + 1
WHERE tenant_id = $1 AND id = $3;
```

**Files:** `crates/sulcus-server/src/agent.rs` — in store, search/recall, boost, patch handlers.

## Phase C: Refactor Decay (worker.rs)

Replace the wall-clock decay formula:

**Old:** `current_heat * power(0.5, EXTRACT(EPOCH FROM (now() - updated_at)) / half_life_secs)`

**New:** 
```sql
current_heat * power(0.5, 
  (ns.interaction_epoch - gi.interaction_epoch)::float / half_life_interactions
)
```

Where `half_life_interactions` is a new field on DecayProfile (alongside `half_life_secs`).

The decay profiles in `ThermoConfig` need a new field:

```rust
pub struct DecayProfile {
    pub half_life_secs: f64,          // kept for backward compat / hybrid mode
    pub half_life_interactions: f64,  // NEW: decay in interaction units
    pub floor: f32,
    pub reinforce_on_recall: f32,
    pub stability_gain: f32,
}
```

Default `half_life_interactions`:
- episodic: 50 interactions (fast fade)
- semantic: 500
- procedural: 2000
- preference: 1000
- fact: 5000
- synthesis: 800

**Add `decay_mode` to ThermoConfig:**

```rust
pub enum DecayMode {
    Time,         // original wall-clock (backward compat)
    Interaction,  // new: interaction-epoch based
    Hybrid,       // both: min(time_decay, interaction_decay)
}
```

Default: `Interaction` for new tenants, `Time` for existing (non-breaking).

**File:** `crates/sulcus-types/src/thermo.rs` + `crates/sulcus-server/src/worker.rs`

## Phase D: SIU Curation Cycle (curator.rs)

New module: `crates/sulcus-server/src/curator.rs`

Runs as a background task on a longer interval (every 30 minutes, or configurable).

Steps per tenant/namespace:

1. **Re-classify** — For nodes where `recall_count = 0` and `interaction_epoch < ns_epoch - 100`:
   Run SIU v2 classify on `pointer_summary`. If `predicted_type != memory_type` with high confidence (>0.8), update the type. Log the reclassification.

2. **Consolidate duplicates** — Find nodes with high vector similarity (cosine > 0.92) within the same namespace+type. Merge them: keep the higher-utility one, append unique content from the other, archive the duplicate.

3. **Summarize verbose nodes** — Nodes with `pointer_summary` > 500 chars and `recall_count < 3`: generate a shorter summary. Keep full content in a `content` field but trim the pointer_summary for efficient context injection.

4. **Re-vectorize** — Nodes where `vector IS NULL` or `embedding IS NULL`: embed and backfill.

5. **Sync AGE graph** — For any modified nodes, call `ensure_memory_vertex()`.

6. **Log activity** — Record curation results for the dashboard.

**Trigger:** Background timer + also triggered by namespace going idle (no interactions for 10 minutes).

## Phase E: Relevance-Weighted Recall

In `search_golden_index_ns()` (`db.rs`), modify the scoring:

**Old:** Pure cosine similarity from pgvector.
**New:** `final_score = (similarity * 0.7) + (current_heat * 0.3)`

This ensures that cold-but-perfectly-relevant memories still surface, while hot memories get a boost. The 0.7/0.3 ratio is configurable via ThermoConfig.

Add to ThermoConfig:
```rust
pub struct RecallConfig {
    pub similarity_weight: f32,  // default 0.7
    pub heat_weight: f32,        // default 0.3
}
```

## Phase F: Version Bump

Bump `crates/sulcus-server/Cargo.toml` version to `2.2.0`.

## Files to modify:
1. `crates/sulcus-types/src/thermo.rs` — DecayProfile, DecayMode, RecallConfig
2. `crates/sulcus-server/src/db.rs` — migration, recall scoring
3. `crates/sulcus-server/src/worker.rs` — decay formula refactor
4. `crates/sulcus-server/src/agent.rs` — interaction epoch tracking
5. `crates/sulcus-server/src/curator.rs` — NEW: curation cycle
6. `crates/sulcus-server/src/lib.rs` — register curator module + spawn
7. `crates/sulcus-server/src/thermo_api.rs` — expose new config fields
8. `crates/sulcus-server/Cargo.toml` — version bump

## Constraints:
- All changes must be backward compatible — existing tenants keep `Time` mode until they switch.
- Migrations must be idempotent (IF NOT EXISTS everywhere).
- The curator must be non-destructive — archive, never delete.
- Compile with `cargo check -p sulcus-server` before committing.
- Do NOT touch `graph.rs` — that was just fixed separately.
