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

(Updated: 2026-03-04)
