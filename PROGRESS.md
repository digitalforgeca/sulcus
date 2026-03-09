# Progress

- [x] Initialize Cargo workspace and members (`sulcus-core`, `sulcus-local`, `sulcus-server`).
- [x] Scaffold `crates/sulcus-core` with:
  - `Node`, `Edge`, `EdgeType` models
  - `spread_activation` + `apply_decay` thermodynamics functions
  - `SyncEngine` and `StorageBackend` traits + `MemoryOp`/`OpType`
  - Unit test for spreading + decay
- [x] Add minimal placeholder crates for `sulcus-local` and `sulcus-server`.
- [x] Implement `StorageBackend` adapter for PostgreSQL-compatible local storage in `sulcus-local`.
- [x] Add MCP (stdio) glue and `add_memory` / `active_index` resource handlers.
- [x] Thermodynamics background worker & active_index maintenance.
- [x] Local sync client (WAL → push/pull + SyncEngine mock + tests).
- [x] Harden CRDT Layer (Fix Bug 17 monotonicity, Bug 18 tick_after, Bug 19 fold/ps race).
- [x] Harden Storage Layer (Atomic SQL UPDATE for utility, transactional Patch apply).
- [x] Deploy Enterprise Server (`sulcus-server`) to Azure VM.

Next:

1. [x] Finalize SaaS Auth Middleware (API Keys) and multi-tenancy.
2. [x] Launch Marketing Site (React/Next.js).
3. [x] Browser Extension Proof-of-Concept (WASM + IndexedDB).
4. [x] WASM Distribution (`@sulcus/mem` NPM package).
5. [x] Validate Multi-Agent Sharing (OpenClaw Sync)
6. Enterprise SSO Integration (Azure AD / Okta).

(Updated: 2026-03-08)

## 2026-03-09 Updates

### Memory Consolidation (V2 Evolution)
- [x] **Semantic Clustering for Consolidation**: Replaced coarse namespace-based grouping with greedy semantic clustering (cosine similarity >= 0.82) using hot node embeddings.
- [x] **Improved Consolidation Loop**: Now joins `nodes` and `embeddings` in a single pass; synthesises insights for semantically related clusters even within the same namespace.
- [x] **Integrity Fix**: Resolved `LocalSyncClient` regression where pushed ops were not marked as `synced` in the local DB, causing duplicate pushes on restart.

### Quality & Stability
- [x] All integration tests passing, including new `test_semantic_consolidation_clustering`.
- [x] Fixed `local_sync_client_retries_are_idempotent_and_resume_without_duplication` failure.

### CTO Focused Improvement (2026-03-09)
- [x] **Consolidation Coordination**: Implemented `consolidation_lock` and `CONSOLIDATION_COOLDOWN` (60s) to prevent overlapping synthesis passes and redundant LLM token usage.
- [x] **Index Optimization**: Added `idx_edges_target_id` to `edges` table for bi-directional traversal performance.
- [x] **Test Reliability**: Resolved port conflicts in parallel OpenClaw example integration tests (Node/Python).
- [x] **New Test Suite**: Added `consolidation_coordination.rs` to verify the new locking and cooldown logic.
- [x] **Prompt Caching Stability**: Refactored `BuildContext` to use `created_at ASC` sorting within semantic buckets. This ensures new memories are appended to the end of blocks, preserving the prefix for LLM prompt caching.
