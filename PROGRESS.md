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

## 2026-03-08 Updates

### pg-embed Upgrade (0.7.1 → 1.0.0)
- [x] **Embedded PG upgraded to PostgreSQL 17.8.0** (was 15.1.0 via pg-embed 0.7.1).
  - `pg-embed 1.0.0` supports PG 10–18; we target PG_V17.
  - Fixes `FATAL: database files are incompatible with server` when stale PG16 data dir existed.
  - Commit: `62e70f4`
- [x] **Pglite JS path verified working** — connects to inbuilt pglite service with pgvector support.
- [x] **pg-embed fallback path verified** — downloads and starts PG17 binary when pglite JS is unavailable.
- [x] **Pre-existing sqlx bug**: `prepared statement "sqlx_s_1" already exists` — resolved by adding `statement_cache_capacity(0)` to all connection pools (including test pools) that may interface with PGlite.

### OpenClaw Integration Fixes
- [x] **INI config support** — `sulcus.ini` at project root configures `database_url`, `active_limit`, etc.
- [x] **`SULCUS_DATABASE_URL` env var** — wired through gateway LaunchAgent plist for external PG override.
- [x] **OpenClaw plugin (`memory-sulcus`)** — confirmed working with pglite JS backend.
- [x] **`OPENCLAW_SETUP.md`** — canonical config reference for all Sulcus × OpenClaw integration gotchas.

### Test Suite
- [x] 53/53 tests green (using external PG17 via `SULCUS_DATABASE_URL`).
- [ ] Some integration tests have pre-existing failures unrelated to pg-embed upgrade (openclaw_examples, paging, sync_worker, thermodynamics, e2e_server).

## V2 Mandate Progress
- [x] **Cross-Modal Embeddings**: Added `modality` and `source_mime` fields to core `Node` and `NodePatch` models. 
- [x] **P2P Namespace Sharing**: Implemented logical `namespace` isolation in `LocalStorage` and `sulcus-server` golden index.
- [x] **Performance Indexing**: Integrated HNSW-ready schema migrations and deterministic context sorting.
- [x] **Keycloak Admin Sync**: Implemented background role synchronization between Stripe billing and Keycloak user profiles.
- [x] **Localized Differential Sync**: Completed `p2p_sync` endpoint allowing agents to swap CRDT patches without a central server.

