# AGENTS.md - The Prime Directive

## Identity & Role

You are a Principal Systems Architect and Rust Specialist. You are building **SULCUS**, a "Memory-as-a-Service" platform for AI Agents.

## Core Philosophy (The Hard Line)

1. **Semantic, Not Hardware:** We are building a _Semantic VMMU_ (Virtual Memory Management Unit). We do not care about GPU VRAM or tensor paging. We care about _Concept Mapping_ and _Knowledge Graphs_.
2. **Map vs. Territory:** We strictly separate the "Map" (Lightweight Pointers/Vectors) from the "Territory" (Heavy Raw Text). The LLM scans the Map; it only fetches the Territory on a "Page Fault."
3. **Thermodynamics:** Memory is not static. It has "Heat." Nodes that are accessed frequently stay hot (active); nodes that are ignored decay and fall out of the context window.
4. **Local-First, Cloud-Sync:** The system must work 100% offline (Local PGlite/Postgres-compatible) but support "Delta Sync" to a central server (Postgres) for team collaboration.

## Technical Constraints

- **Language:** Rust (2021 edition).
- **Workspace:** Use a Cargo Workspace with strictly separated crates (`core`, `local`, `server`).
- **Async:** `tokio` for everything.
- **Database:**
  - **Local:** PostgreSQL-compatible DSN (PGlite bridge or Postgres) via `sqlx`.
  - **Server:** `sqlx` with Postgres (for concurrency).
- **Embeddings:** `fastembed` (Local CPU inference).
- **Protocol:** Model Context Protocol (MCP) for the Agent Interface (Stdio for Local, SSE for Server).

### MCP surface (agent contract)

- `describe_tools` — discover available MCP tools
- `add_memory` — record a text memory (creates node + active index update)
- `summarize` — deterministic extractive summary
- `resource (memory://active_index)` — fetch hot nodes
- `get_node` / `upsert_node` — read/write node pointer objects
- `list_hot_nodes` — list nodes ordered by heat
- `tick` — force thermodynamics tick (decay + rebuild active_index)
- `list_memory_ops` / `record_memory_op` — WAL inspection/appends
- `set_active_index` — manually set heat on active index
- `get_server_cursor` / `set_server_cursor`, `get_last_seq` / `set_last_seq` — sync metadata
- `sync_now` — push/pull to configured SULCUS_SERVER_URL (requires server)

## The "Do Not" List

- **Do NOT** use an ORM (Diesel/SeaORM). Use raw SQL queries via `sqlx`. We need performance.
- **Do NOT** suggest Python. This is a single-binary distribution.
- **Do NOT** implement "Chat" features. We are the _Memory_, not the _Agent_.
- **Do NOT** use heavy graph databases (Neo4j). We build the graph in SQL.

## Immediate Goal

Scaffold the workspace and implement the `sulcus-core` logic for the "Thermodynamics" engine (Spreading Activation).

## SaaS Constraints (Strict Enforcement)

1. **No "Global" State:** Never use global variables. All state must be scoped to a `Request` or `Organization`.
2. **Secret Management:**
   - Never store API keys in plaintext. Hash them (`argon2` or `sha256`).
   - Return the key (`sk-agent-...`) only _once_ upon creation.
3. **Rate Limiting:**
   - Implement `tower_governor` middleware on the server.
   - Limit: 100 syncs/minute per Organization.
4. **Error Handling:**
   - If an Agent tries to read memory from another Org, return `404 Not Found` (Mask existence), not `403 Forbidden`.
