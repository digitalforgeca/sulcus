# Sulcus Architecture — Public Overview

> **Classification:** This document describes the public architecture visible to users and contributors. The server backend is a proprietary managed service. See [CLASSIFICATION.md](../CLASSIFICATION.md).

---

## How Sulcus Works

Sulcus has two sides:

1. **The `sulcus` CLI** — A single binary that runs on your machine. Handles local memory, MCP protocol (stdio + Streamable HTTP), embedded database, local embeddings, and sync with the Sulcus API. This is what you install.

2. **The Sulcus API** (`api.sulcus.ca`) — A managed service that provides multi-tenant memory storage, the SIU v2 pipeline, knowledge graph, triggers engine, and cross-agent sync. You connect to it with an API key.

```
┌───────────────────────────────────────────────────────┐
│                  sulcus CLI (one binary)               │
│                                                       │
│  ┌─────────┐  ┌────────┐  ┌────────┐  ┌───────────┐  │
│  │ MCP     │  │ CLI    │  │ Import │  │ Status    │  │
│  │ stdio/  │  │ search │  │ Export │  │ & Doctor  │  │
│  │ http    │  │ recall │  │        │  │           │  │
│  └────┬────┘  └───┬────┘  └───┬────┘  └─────┬─────┘  │
│       │           │           │              │        │
│  ┌────▼───────────▼───────────▼──────────────▼─────┐  │
│  │              StorageBackend trait                │  │
│  │  ┌──────────────┐  ┌──────────┐  ┌───────────┐  │  │
│  │  │ Cloud Client │  │  Local   │  │  Hybrid   │  │  │
│  │  │ (reqwest →   │  │ (SQLite  │  │ (local +  │  │  │
│  │  │  REST API)   │  │ +fastem) │  │  sync)    │  │  │
│  │  └──────────────┘  └──────────┘  └───────────┘  │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────┬───────────────────────────────┘
                        │ HTTPS (when cloud/hybrid)
                        ▼
┌───────────────────────────────────────────────────────┐
│              Sulcus API (api.sulcus.ca)                │
│                                                       │
│  Memory Storage · SIU v2 Pipeline · Knowledge Graph  │
│  Triggers · Entity Extraction · Multi-tenant Sync    │
│                                                       │
│         Managed service by Digital Forge Studios      │
└───────────────────────────────────────────────────────┘
```

## Backend Modes

The `sulcus` binary supports three storage backends. Mode is selected automatically based on configuration:

### Cloud Mode (default)

When `SULCUS_API_KEY` is set, the CLI communicates with `api.sulcus.ca` via REST API. All memory operations go through the cloud service, which provides the full SIU v2 pipeline, knowledge graph, triggers, and multi-tenant isolation.

### Local Mode

When `--local` is passed (or no API key is set and `--local` is compiled in), the CLI uses an embedded SQLite database at `~/.sulcus/data/`. Local embeddings via fastembed (BGE-small-en-v1.5). No network required — works fully offline.

### Hybrid Mode

When both `SULCUS_API_KEY` and `SULCUS_SYNC=1` are set, the CLI writes to local storage first (fast, offline-safe), then replicates to the cloud API in the background.

- **Write path:** Local SQLite → async push to cloud
- **Read path:** Local first, merge with cloud results if available
- **Conflict resolution:** Higher thermodynamic heat wins
- **Offline resilience:** Degrades gracefully to local-only when cloud is unreachable
- **Sync:** Background timer + `sulcus sync` manual trigger

## The Thermodynamic Model

Memory nodes follow a biological decay curve derived from ACT-R cognitive architecture:

$$H(t) = H_0 \cdot e^{-\lambda \cdot \Delta t / S}$$

- **H(t):** Current heat (activation)
- **S:** Stability — successful retrievals multiply S by 1.5×, simulating spaced repetition
- **λ:** Decay constant (default 0.85)

Heat spreads through the knowledge graph via **topological diffusion**. Mentioning a topic warms its neighbors.

## MCP Protocol

The `sulcus` binary includes a built-in MCP (Model Context Protocol) server. MCP is always local — the binary runs as a subprocess or HTTP server on your machine. It never proxies raw MCP protocol to the cloud.

**Two transports:**

- **stdio** — `sulcus mcp stdio` — Standard subprocess model. Used by Claude Desktop, Cursor, VS Code, Hermes Agent, OpenClaw, and any framework that spawns MCP servers.
- **Streamable HTTP** — `sulcus mcp http --port 3100` — Multi-client HTTP server. Used for remote access, shared team servers, or web-based agents.

**18 tools** exposed via MCP, covering: store, search, recall, context building, graph operations, triggers, metrics, and administration. See `README.md` for the full tool list.

**Key design decision:** MCP stays local. If an agent needs remote access to Sulcus, it uses the REST API directly — not MCP over the network. This avoids the schema mismatch problem (local `nodes` table vs cloud `golden_index` table) and keeps MCP fast and simple.

## SIU v2 Pipeline

Every `memory_store` fires a classification pipeline:

1. **SIVU** — Quality gate. Rejects noise before storage. ONNX inference, <1ms.
2. **SICU** — Type classifier. Auto-classifies into episodic, semantic, fact, preference, procedural, or synthesis. ONNX, <1ms.
3. **SILU** — Entity extraction + graph relationships. LLM-powered (GPT-5.4 nano via Azure Foundry), async.
4. **Graph update** — Apache AGE knowledge graph updated with entities and edges.
5. **Triggers** — Reactive rules evaluated against the event.

The SIU models are free for all users (local + cloud). Not paywalled.

## Multi-Signal Recall

Recall combines multiple signals — not just vector similarity:

- Semantic similarity (pgvector cosine search)
- Full-text search with phrase proximity
- Thermodynamic heat (interaction-based decay)
- Knowledge graph neighbors (entity context)
- Temporal recency with type-aware half-lives
- Keyword overlap, proper noun boosts, confidence weighting

## Distributed Consistency (HLC-CRDT)

Sulcus ensures causal consistency across distributed agents using **Hybrid Logical Clocks (HLC)**.

- **LWW-Element-Graph:** All mutations are idempotent patches
- **Anti-Entropy:** The `sulcus` client pushes/pulls WAL segments to the Sulcus API
- **Conflict Resolution:** The API resolves conflicts via HLC timestamps

## Crate Structure

```
crates/
├── sulcus/              # CLI binary — clap subcommands, backend resolver
├── sulcus-core/         # StorageBackend trait, shared types, param structs
├── sulcus-cloud/        # Cloud backend — reqwest client → REST API
├── sulcus-local/        # Local backend — SQLite + fastembed embeddings
└── sulcus-mcp-impl/     # MCP server — rmcp, 18 tool handlers
```

All crates share `sulcus-core` types. The `sulcus` binary selects a backend at startup:
- API key present → `sulcus-cloud::SulcusClient`
- `--local` flag → `sulcus-local::LocalStore`
- Both + sync → `HybridBackend` (wraps both)

MCP tools call `&dyn StorageBackend` — they don't care which backend is active.

## Client SDKs & Integrations

SDKs and integrations are thin API clients. They connect to `api.sulcus.ca` — no local server required.

- **Python:** `pip install sulcus`
- **Node.js:** `npm install @digitalforgestudios/sulcus`
- **OpenClaw:** `openclaw skill install @digitalforgestudios/openclaw-sulcus`
- **Framework integrations:** LangChain, LlamaIndex, CrewAI, Vercel AI SDK

## Security

- **API key authentication:** All requests require a Bearer token
- **Tenant isolation:** Cryptographically scoped — agents for one tenant cannot access another's memories
- **Namespace isolation:** Agents within a tenant get separate namespaces by default; cross-namespace requires explicit ACL
- **Transport:** HTTPS only
- **Data residency:** All infrastructure in Canada (Azure canadacentral)

---

© 2026 Digital Forge Studios Inc.

*Last Updated: 2026-07-06*
