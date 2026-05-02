# Sulcus Architecture Refactor Plan

**Decided:** 2026-03-29 (Dooley + Icarus + Ariadne)
**Status:** In progress

## Target Architecture

```
sulcus-types      — base types, serialization, shared traits
sulcus-core       — THE engine (thermo, triggers, folds, consolidation, search, context)
sulcus-vectors    — text→vector embeddings (fastembed/ONNX cdylib) [NEW, replaces sulcus-embed]
sulcus-store      — embedded PostgreSQL (pg-embed cdylib) [absorbs sulcus-embed's PG parts]
sulcus-siu        — memory type classifier (ONNX cdylib)
sulcus-sync       — CRDT cloud sync (cdylib)
sulcus-wasm       — thin bridge: sulcus-core + wasm_bindgen
sulcus            — thin shell: MCP server + dylib loader + config [was sulcus]
sulcus-server     — cloud API (axum)
```

## Phase 1: Done ✅

- [x] Remove REST client from OpenClaw plugin (v2.0.0)
- [x] WASM + FFI architecture for plugin (v3.0.0)
- [x] Create sulcus-vectors crate (renamed from sulcus-embed)
- [x] Remove decompose.py (SIU replaces it)
- [x] Core extraction audit complete (blueprint below)

## Phase 2: Core Extraction (~3,763 lines → sulcus-core)

### New Traits Needed in sulcus-types

```rust
// Database abstraction — all SQL goes through this
#[async_trait]
pub trait DbBackend: Send + Sync {
    async fn query_rows(&self, sql: &str, params: &[Value]) -> Result<Vec<Row>>;
    async fn execute(&self, sql: &str, params: &[Value]) -> Result<u64>;
    async fn begin_tx(&self) -> Result<Box<dyn Transaction>>;
}

// Thermodynamics operations
#[async_trait]
pub trait ThermoBackend: Send + Sync {
    async fn diffuse_heat(&self) -> Result<()>;
    async fn apply_decay(&self, config: &ThermoConfig) -> Result<()>;
    async fn rebuild_active_index(&self, threshold: f32, limit: usize) -> Result<Vec<ActiveRow>>;
    async fn get_thermo_config(&self) -> Result<ThermoConfig>;
}

// Trigger operations
#[async_trait]
pub trait TriggerBackend: Send + Sync {
    async fn fetch_triggers_for_event(&self, event: &str) -> Result<Vec<TriggerRow>>;
    async fn record_trigger_fire(&self, id: &str, now: DateTime<Utc>) -> Result<()>;
    async fn insert_trigger_log(&self, trigger_id: &str, event: &str, result: &str) -> Result<()>;
    async fn boost_node(&self, id: &str, strength: f32) -> Result<()>;
    async fn pin_node(&self, id: &str) -> Result<()>;
    async fn tag_node(&self, id: &str, suffix: &str) -> Result<()>;
    async fn deprecate_node(&self, id: &str) -> Result<()>;
}

// Fold operations
#[async_trait]
pub trait FoldBackend: Send + Sync {
    async fn fetch_unfold_candidates(&self, threshold: f32, limit: i64) -> Result<Vec<FoldCandidate>>;
    async fn write_cold_storage(&self, node_id: &str, raw: &str, summary: &str) -> Result<()>;
    async fn update_fold_summary(&self, node_id: &str, summary: &str) -> Result<()>;
    async fn delete_warm_payload(&self, node_id: &str) -> Result<()>;
}

// Consolidation operations
#[async_trait]
pub trait ConsolidationBackend: Send + Sync {
    async fn fetch_hot_nodes_with_embeddings(&self, threshold: f32, limit: i64) -> Result<Vec<ClusterMember>>;
    async fn upsert_synthesis_node(&self, id: &str, label: &str, insight: &str, heat: f32, ns: &str) -> Result<()>;
    async fn store_embedding(&self, node_id: &str, bytes: &[u8]) -> Result<()>;
    async fn upsert_insight_edge(&self, src: &str, dst: &str, weight: f32) -> Result<()>;
    async fn boost_cluster_heat(&self, ids: &[String], boost: f32) -> Result<()>;
    async fn apply_isolation_penalty(&self, threshold: f32, penalty: f32) -> Result<u64>;
}
```

### File-by-File Migration

#### thermodynamics.rs (530 lines)
**Move to sulcus-core:**
- Constants: `DEFAULT_DECAY`, `DEFAULT_PRUNE_FLOOR`, `FOLD_THRESHOLD`
- `tick_in_tx` — core thermodynamic algorithm (behind ThermoBackend trait)
- `tick` — thin wrapper
- `tick_configured` — full cycle with triggers (behind ThermoBackend + TriggerBackend)
- `load_local_thermo_config` — behind ThermoBackend
- `ignite_context` / `ignite` — embedding-based heat injection (behind ThermoBackend)

**Stays in sulcus:
- `spawn_worker` — tokio::spawn, JoinHandle, runtime orchestration
- Prometheus metrics calls

#### triggers.rs (646 lines)
**Move to sulcus-types:**
- `TriggerEvent` enum + FromStr
- `TriggerAction` enum + FromStr
- `TriggerContext` struct
- `TriggerResult` struct
- `MatchedTrigger` struct

**Move to sulcus-core:**
- `evaluate_triggers` — orchestrator (behind TriggerBackend)
- `find_matching_triggers` — filter logic is pure, DB fetch behind trait
- `fire_trigger` — dispatch logic is pure, DB writes behind trait
- `fire_notify` — pure string interpolation
- `fire_boost` / `fire_pin` / `fire_tag` / `fire_deprecate` — behind TriggerBackend
- `collect_notifications` — pure iteration

**Stays in sulcus:
- `fire_webhook` — reqwest HTTP, network I/O

#### folds.rs (1,020 lines)
**Move to sulcus-types:**
- `ExportNode` / `ExportEdge` / `FoldPayload` structs
- `FoldStorage` trait (already a trait!)
- `FOLD_BATCH` / `FOLD_SUMMARY_MAX` constants

**Move to sulcus-core:**
- `fold_cold_nodes` algorithm (behind FoldBackend)
- `extractive_summarize_fallback` — pure string truncation
- `summarize_prompt` — pure string formatting
- `parse_link_line` — pure string parser
- Markdown render/parse (export/import pure logic)

**Stays in sulcus:
- `abstractive_summarize` — reqwest HTTP to Ollama
- `abstractive_describe_image` — file I/O + HTTP
- File I/O entry points (std::fs::write/read)

#### consolidation.rs (546 lines)
**Move to sulcus-types:**
- All constants (MIN_CLUSTER_SIZE, SIMILARITY_THRESHOLD, etc.)
- `ClusterMember` / `SemanticCluster` structs

**Move to sulcus-core:**
- `cosine_similarity` — pure math (DEDUPLICATE from storage.rs!)
- `cluster_prompt` / `extractive_cluster_summary` — pure string
- `synthesise_node_id` — deterministic UUID-v5
- Greedy clustering loop — pure in-memory algorithm
- `consolidate_hot_clusters` orchestration (behind ConsolidationBackend)
- All unit tests

**Stays in sulcus:
- `synthesise_cluster` — reqwest HTTP to Ollama
- Lock/cooldown machinery (tokio::sync::Mutex, Instant)
- HNSW operations

#### storage.rs (1,021 lines)
**Move to sulcus-core:**
- `cosine_similarity` — DUPLICATE, use shared version
- `parse_vector_row` — pure bytes→Vec<f32>
- `get/set_active_index_json` — pure rkyv↔JSON transform

**Stays in sulcus (mostly):
- All SQL methods are impl blocks on `LocalStorage` with `PgPool` — these become the *implementation* of the trait methods defined above. The SQL stays here but implements `ThermoBackend`, `TriggerBackend`, `FoldBackend`, `ConsolidationBackend`.

## Phase 3: Deduplication

- [ ] sulcus-server/siu.rs → wrap sulcus-siu crate (delete reimplementation)
- [ ] sulcus-server thermodynamics → use sulcus-core (implement traits with server's PgPool)
- [ ] sulcus-server triggers → use sulcus-core
- [ ] cosine_similarity → single implementation in sulcus-types

## Phase 4: Rename

- [x] sulcus → sulcus (rename crate, binary, all references)
- [ ] sulcus-embed → deprecated (replaced by sulcus-vectors + sulcus-store)
- [ ] Update all dylib filenames in progressive loader, manifest, etc.

## Phase 5: WASM Feature Parity

After core extraction, sulcus-wasm automatically gets:
- Triggers (via TriggerBackend implemented by WASM bridge)
- Folds/consolidation (via FoldBackend/ConsolidationBackend)
- Full thermodynamics cycle
- All the pure math/string utilities

The WASM bridge just needs to implement the new traits using its JS callback pattern.
