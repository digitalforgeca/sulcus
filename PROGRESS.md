# Progress

- [x] Initialize Cargo workspace and members (`sulcus-core`, `sulcus-local`, `sulcus-server`).
- [x] Scaffold `crates/sulcus-core` with:
  - `Node`, `Edge`, `EdgeType` models
  - `spread_activation` + `apply_decay` thermodynamics functions
  - `SyncEngine` and `StorageBackend` traits + `MemoryOp`/`OpType`
  - Unit test for spreading + decay
- [x] Add minimal placeholder crates for `sulcus-local` and `sulcus-server`.

Next:

1. Implement `StorageBackend` adapter for PostgreSQL-compatible local storage in `sulcus-local` (migrations + vector cache). — COMPLETED
2. Add MCP (stdio) glue and `add_memory` / `active_index` resource handlers. — COMPLETED
3. Thermodynamics background worker & active_index maintenance. — COMPLETED (background worker wired into runtime)
4. Local sync client (WAL → push/pull + SyncEngine mock + tests). — COMPLETED
5. Scaffold `sulcus-server` routes and agent auth middleware. — IN PROGRESS (API-key middleware implemented)
6. Server: DB-backed Golden Index + server WAL (Postgres) — IN PROGRESS (migrations + persistence + tests added)
7. Harden sync semantics — IN PROGRESS (op_hash dedupe + idempotency + cursor_seq returned)

Unit tests:

- [x] `sulcus-core` thermodynamics tests (spread + decay)
- [x] `sulcus-local` storage unit/integration tests
- [x] `sulcus-local` MCP + runtime + thermodynamics tests
- [x] `sulcus-local` sync client tests
- [x] `sulcus-server` DB-backed persistence integration test (requires `SULCUS_DATABASE_URL`)

(Updated: 2026-02-16)
