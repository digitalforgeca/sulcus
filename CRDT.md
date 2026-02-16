CRDT / Merge strategy — proposal

Goal

- Provide deterministic, testable merge behavior for concurrent memory ops across clients and server.
- Be incremental: start with operation-based idempotent merges, add conflict-resolution strategies later.

Principles

- Operation-based (op-based) CRDTs: every change is an immutable `MemoryOp` with an `op_id` and `causal_metadata`.
- Idempotent by design: server dedupe via `op_hash` prevents duplicates.
- Convergence: all replicas that apply the same set of operations (regardless of order) should converge to the same state.
- Simplicity-first: implement LWW (last-writer-wins) for scalar fields; apply semantic merges for structured payloads later.

Op model (short-term)

- Extend `MemoryOp` with:
  - `op_id: UUID` — globally unique op identifier
  - `actor: AgentId` — originator
  - `clock: Lamport` or `timestamp` — causal ordering hint
- Keep existing `timestamp` for audit but rely on `clock` for ordering when available.

Merge rules (v1)

- Add/Update:
  - If op_id already seen -> ignore (idempotency).
  - Otherwise, apply node upsert; for fields with concurrent writes use `clock` then `timestamp` then `op_id` tie-breaker.
- Delete:
  - Tombstone by id with a causal `delete_clock` so later adds with older clocks are ignored.

Server-side responsibilities

- Persist full op metadata (op_id, actor, clock, op_hash). Maintain `seen_ops` index for fast dedupe.
- Provide incremental pull by cursor that returns ops in `server_ops` order; include `cursor_seq`.
- Offer an optional `merge_policy` header for advanced clients (future).

Client-side responsibilities

- Continue to record ops in WAL (`memory_ops`) with `op_id` and metadata.
- When retrying pushes, resend the same op (server will dedupe via op_hash/op_id).
- Persist `last_seq` + `server_cursor_seq` (already implemented) so resume is safe.

Testing plan

- Unit tests for op application order independence (commutativity).
- Property tests: random op sequences (add/update/delete) should converge.
- Integration tests: concurrent clients push conflicting updates; server resolves deterministically and clients converge after sync.

Next steps (implementation roadmap)

1. Extend `MemoryOp` schema and WAL to include `op_id` + `clock` (small, high priority).
2. Server: persist op metadata in `server_ops` + unique index on `op_id` (migrations + tests).
3. Client: ensure ops include `op_id` on record and propagate through SyncEngine.
4. Add deterministic merge unit tests + e2e conflict tests.

Notes / Tradeoffs

- Using vector clocks gives stronger causality but higher complexity; start with Lamport clocks + tie-breakers.
- CRDT design will be operation-based rather than state-based to fit WAL architecture.

References

- Shapiro et al., "A comprehensive study of CRDTs"
- Operation-based CRDT patterns (LWW, OR-Set)
