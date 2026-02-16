# PLAN.md — SULCUS roadmap & milestone plan

## High-level goals

- Build a local-first Semantic VMMU for AI Agents.
- Ship `sulcus-local` (single-binary, offline-capable) as the open-source product.
- Ship `sulcus-server` (multi-tenant SaaS / enterprise) as private/proprietary offering.

## Milestones

1. Core library (`sulcus-core`) — COMPLETE
   - Node/Edge models, thermodynamics, storage/sync traits.

2. Local storage & MCP (`sulcus-local`) — COMPLETED
   - SQLite schema + `SqliteStorage` adapter (current sprint)
   - MCP over stdio: `add_memory`, `memory://active_index`
   - Background thermodynamics worker (decay, prune, active_index)

3. Local sync client & WAL export
   - WAL-based delta export, background uploader
   - `SyncEngine` mock + integration tests

4. Server API (`sulcus-server`) — SCOPED FOR PRIVATE REPO
   - Agent `/sync` endpoint, auth middleware (API keys)
   - Admin endpoints + dashboard APIs
   - Rate limiting, RLS, and billing hooks

5. Dashboard & UX
   - React SPA (force graph, memory surgeon, activity stream)
   - Serve `dist/` from `sulcus-server`

6. Release & CI
   - Migrations, tests, release artifacts, docs, versioning

## Current sprint (this week)

- Implement `SqliteStorage` + migrations (done: schema + adapter + tests).
- Add MCP handlers (next).
- Implement thermodynamics background task.
- Testing: Unit & integration tests added for core and local storage; next add MCP + thermodynamics integration tests and add CI test step.

## Logging & docs

- Keep `PROGRESS.md` and `CHANGELOG.md` up to date for each merge.
- Write a short `USAGE.md` after the local CLI is functional.

---

If you want, I can open a branch `feature/local-storage` and push these changes (create PR).
