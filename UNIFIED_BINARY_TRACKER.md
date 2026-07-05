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
- [ ] Task 1.1: Create root `Cargo.toml` workspace with `crates/sulcus-core`, `crates/sulcus-cloud`, `crates/sulcus-mcp-impl`, `crates/sulcus` members
- [ ] Task 1.2: Create `crates/sulcus-core/` — shared types extracted from `types.rs` (Memory, SearchResult, all param structs, defaults)
- [ ] Task 1.3: Create `crates/sulcus-cloud/` — extract `client.rs` into a standalone crate depending on `sulcus-core`
- [ ] Task 1.4: Create `crates/sulcus-mcp-impl/` — extract `server.rs` MCP handler depending on `sulcus-core` + `sulcus-cloud`

### Phase 2: Unified CLI Binary (`crates/sulcus/`)
- [ ] Task 2.1: Create `crates/sulcus/` with clap CLI scaffolding — top-level subcommands (mcp, status, search, remember, import, export), arg parsing only, no logic
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

## Cycle 1 — PLANNING [2026-07-05T16:10:00-07:00]
- Task: Generate concrete, sequenced work plan from UNIFIED_BINARY_PLAN.md
- Result: 20 tasks across 5 phases. Phase 1-3 (13 tasks) deliver the unified CLI binary. Phase 4-5 (7 tasks) are future local mode work.
- Strategy: Extract existing code into workspace crates rather than rewriting. ~1,100 lines of working Rust to reorganize, not recreate.
- Next: Task 1.1 — Create root Cargo.toml workspace scaffold
