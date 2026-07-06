# Sulcus Unified Binary — Work Tracker

## Plan
Generated: 2026-07-05T16:10:00-07:00

### Context
- Source codebase: `integrations/mcp-server/src/` (~1,100 lines across 4 files)
- Existing binary: `sulcus-mcp` (stdio + HTTP MCP server, cloud-only)
- Target: unified `sulcus` binary with subcommands, installable via `cargo install sulcus`
- No root Cargo.toml workspace exists yet — need to scaffold one
- Rust 1.94.1, cargo 1.94.1

### Phase 1: Workspace & Crate Structure (Foundation)
- [x] Task 1.1: Create root `Cargo.toml` workspace with `crates/sulcus-core`, `crates/sulcus-cloud`, `crates/sulcus-mcp-impl`, `crates/sulcus` members — done in cycle 2, commit 68114b5
- [x] Task 1.2: Create `crates/sulcus-core/` — shared types extracted from `types.rs` (Memory, SearchResult, all param structs, defaults) — done in cycle 2 (bundled with 1.1), commit 68114b5
- [x] Task 1.3: Create `crates/sulcus-cloud/` — extract `client.rs` into a standalone crate depending on `sulcus-core` — done in cycle 3, commit 24163da
- [x] Task 1.4: Create `crates/sulcus-mcp-impl/` — extract `server.rs` MCP handler depending on `sulcus-core` + `sulcus-cloud` — done in cycle 5, commit 5b9454a

### Phase 2: Unified CLI Binary (`crates/sulcus/`)
- [x] Task 2.1: Create `crates/sulcus/` with clap CLI scaffolding — top-level subcommands (mcp, status, search, remember, import, export), arg parsing only, no logic — done in cycle 6, commit 708ab4b
- [ ] Task 2.2: Wire `sulcus mcp stdio` and `sulcus mcp http` — port existing main.rs logic into `cmd/mcp.rs`, verify builds
- [ ] Task 2.3: Implement `sulcus status` — call cloud client status + memory_status, format output for terminal
- [ ] Task 2.4: Implement `sulcus search <query>` — call cloud search, pretty-print results with heat/type/snippet
- [ ] Task 2.5: Implement `sulcus remember <text>` — call cloud remember, confirm with ID + heat
- [ ] Task 2.6: Implement `sulcus import <file>` — read markdown file, parse into memories, call remember for each
- [ ] Task 2.7: Implement `sulcus export` — call list (paginated), format all memories as markdown, write to stdout

### Phase 3: Integration & Polish
- [ ] Task 3.1: Verify full build — `cargo build --release`, check binary size, test each subcommand against cloud
- [ ] Task 3.2: Update repo README.md install instructions to reference `cargo install sulcus`
- [ ] Task 3.3: Add `[package.metadata.binstall]` and GitHub Actions release workflow for cross-platform binaries
- [ ] Task 3.4: Deprecate old `integrations/mcp-server/` with forwarding note, update npm `sulcus-local` to download unified binary
- [ ] Task 3.5: Feature gate — add `cloud` (default) and `local` (placeholder) feature flags in workspace

### Phase 4: Local Mode — Embedded Database (Future)
- [ ] Task 4.1: Add `crates/sulcus-local/` with SQLite + pgvector-compatible layer using `rusqlite` + `sqlite-vss`
- [ ] Task 4.2: Implement local storage backend with same trait interface as cloud client
- [ ] Task 4.3: Embed BGE-small-en-v1.5 via `fastembed` for local embeddings
- [ ] Task 4.4: `sulcus serve` subcommand — local REST API compatible with cloud protocol
- [ ] Task 4.5: Config resolution — auto-detect local vs cloud mode based on env vars

### Phase 5: SIU & Sync (Future)
- [ ] Task 5.1: Bundle SIU ONNX model, add `sulcus classify` subcommand
- [ ] Task 5.2: Bidirectional sync protocol (`sulcus sync`)
- [ ] Task 5.3: `sulcus doctor` — check installed components, models, connectivity

## Work Log

## Cycle 6 — BUILD [2026-07-05T17:24:00-07:00]
- Task: 2.1 — Create crates/sulcus/ with clap CLI scaffolding
- Result: Full clap derive CLI with cmd/ module structure. 7 subcommands (mcp stdio, mcp http, status, search, remember, import, export) with proper arg parsing, help text, and defaults. All stubs compile clean. Phase 2 started.
- Commit: 708ab4b
- Next: Task 2.2 — Wire sulcus mcp stdio and sulcus mcp http with actual MCP server logic

## Cycle 5 — BUILD [2026-07-05T17:09:00-07:00]
- Task: 1.4 — Extract server.rs into sulcus-mcp-impl crate
- Result: Full MCP server handler (264 lines, 18 tools) ported to crates/sulcus-mcp-impl/src/server.rs. Imports sulcus_core for types, sulcus_cloud for SulcusClient. Module exported via lib.rs. Clean compile across entire workspace. Phase 1 foundation complete — all 4 extraction tasks done.
- Commit: 5b9454a
- Next: Task 2.1 — Create crates/sulcus/ with clap CLI scaffolding (Phase 2 begins)

## Cycle 4 — AUDIT [2026-07-05T16:43:00-07:00]
- Progress: 3/20 tasks complete (all Phase 1 extraction)
- On target: yes — Phase 1 is 75% done (3/4 tasks) after 2 build cycles, which is good pace
- Verified:
  - `cargo check` passes clean across all workspace members (only legacy dead_code warnings, expected)
  - `sulcus-core` (323 lines) — all param/response types extracted, compiles
  - `sulcus-cloud` (410 lines) — full REST client extracted, compiles, uses sulcus-core types
  - `sulcus-mcp-impl` — still placeholder (5 lines), Task 1.4 is next
  - `sulcus` CLI binary — still scaffold (14 lines), Phase 2 work
  - Legacy `integrations/mcp-server/` — still functional, 1,096 lines, not yet deprecated
  - Git: 2 commits pushed (68114b5, 24163da), clean working tree except tracker edits
- Issues found: none — extraction is clean, no broken tasks
- Corrections: none needed — plan sequence is solid
- Notes:
  - Task 1.4 (extract server.rs → sulcus-mcp-impl) is the last foundation piece
  - After 1.4, Phase 2 is all CLI wiring — should move faster since the library crates will be done
  - Legacy mcp-server still has its own copies of types.rs/client.rs — will need cleanup in Phase 3 (Task 3.4)
  - Two unrelated benchmark adapter files modified in working tree (not project-related)

## Cycle 3 — BUILD [2026-07-05T16:28:00-07:00]
- Task: 1.3 — Extract client.rs into sulcus-cloud crate
- Result: Full cloud API client ported to crates/sulcus-cloud/src/client.rs. Uses sulcus-core types via `use sulcus_core::*`. Added namespace()/base_url() accessors. Module structure: lib.rs re-exports client mod. Clean compile. Also marked 1.2 complete (types were already extracted in cycle 2).
- Commit: 24163da
- Next: Task 1.4 — Extract server.rs into sulcus-mcp-impl crate

## Cycle 2 — BUILD [2026-07-05T16:13:00-07:00]
- Task: 1.1 — Create root Cargo.toml workspace with crate structure
- Result: Root workspace with 5 members (4 new crates + legacy mcp-server). All workspace deps centralized. sulcus-core has types.rs extracted. Cloud/MCP-impl/CLI are scaffolded with placeholders. Legacy binary updated to use workspace deps. Everything compiles clean.
- Commit: 68114b5
- Next: Task 1.2 — Populate sulcus-core with fully extracted shared types

## Cycle 1 — PLANNING [2026-07-05T16:10:00-07:00]
- Task: Generate concrete, sequenced work plan from UNIFIED_BINARY_PLAN.md
- Result: 20 tasks across 5 phases. Phase 1-3 (13 tasks) deliver the unified CLI binary. Phase 4-5 (7 tasks) are future local mode work.
- Strategy: Extract existing code into workspace crates rather than rewriting. ~1,100 lines of working Rust to reorganize, not recreate.
- Next: Task 1.1 — Create root Cargo.toml workspace scaffold
