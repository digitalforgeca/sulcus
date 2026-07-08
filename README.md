# Sulcus — Thermodynamic Memory for AI Agents

[![Status](https://img.shields.io/badge/api-operational-green)](https://api.sulcus.ca/api/v1/status)
[![npm](https://img.shields.io/npm/v/@digitalforgestudios/openclaw-sulcus)](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus)
[![Web](https://img.shields.io/badge/portal-sulcus.ca-blue)](https://sulcus.ca)

AI agents forget. Context windows fill up, old facts disappear, and naive RAG pulls irrelevant noise. Sulcus fixes this with a **Virtual Memory Management Unit (vMMU)** — treating the prompt window as registers and long-term storage as RAM.

**Live:** [sulcus.ca](https://sulcus.ca) · **API:** [api.sulcus.ca](https://api.sulcus.ca) · **npm:** [@digitalforgestudios/openclaw-sulcus](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus)

---

> **Repository Classification:** This is the **open-source client distribution** repo. It contains SDKs, integrations, plugins, and the `sulcus` CLI — everything users need to connect to the Sulcus API. The server backend (`sulcus-server`) is proprietary and is **not distributed, self-hostable, or available in this repository**. See [CLASSIFICATION.md](CLASSIFICATION.md) for details.

---

## How It Works

### Thermodynamic Decay

Every memory has **heat** (0.0–1.0). New facts start hot; unused ones cool over time via configurable decay curves. Frequently accessed memories stay warm. Ignored ones fade — just like real memory.

Three modes: **time-only**, **interaction-only**, or **hybrid** (default).

### Knowledge Graph

Apache AGE-backed entity graph with automatic relationship extraction. Mentioning a topic warms related concepts via **topological diffusion** — heat spreads through the graph.

### SIU v2 Pipeline

Every `memory_store` fires a classification pipeline:

1. **SIVU** — Quality gate. Rejects noise before storage. ONNX inference, <1ms.
2. **SICU** — Type classifier. Auto-classifies into episodic, semantic, fact, preference, procedural, or synthesis. ONNX, <1ms.
3. **SILU** — Entity extraction + graph relationships. LLM-powered, async.
4. **Graph update** — Apache AGE knowledge graph updated with entities and edges.
5. **Triggers** — Reactive rules evaluated against the event.

### Multi-Signal Recall

Recall combines multiple signals — not just vector similarity:

- Semantic similarity (pgvector cosine search)
- Full-text search with phrase proximity
- Thermodynamic heat (interaction-based decay)
- Knowledge graph neighbors (entity context)
- Temporal recency with type-aware half-lives
- Keyword overlap, proper noun boosts, confidence weighting

### Context Engine (v7.0+)

The Context Engine manages your agent's entire context window:

- **Constructive assembly** — Builds context as a constructed view, not a patched transcript. Recent turns at full fidelity; older turns use SILU-generated pointer summaries.
- **Overflow prevention** — Emergency brake at 90% budget, cumulative pressure tracking, adaptive compaction intervals.
- **Working memory cache** — Per-session tool result cache with automatic memory ingestion.
- **Session knowledge extraction** — Identifies and captures decisions, file paths, commands, and intents.
- **26 configurable thresholds** — Every ratio, char limit, and interval is tunable.

### Reactive Triggers

Rules that fire on memory events. **This is the differentiator.**

- **Events:** `on_store`, `on_recall`, `on_boost`, `on_decay`
- **Actions:** notify, boost, pin, tag, deprecate, webhook, chain
- **SITU training** — Feedback loop improves trigger accuracy over time

Your agent can react to its own memory changes — proactively, not just on query.

---

## Quick Start

### OpenClaw Plugin

```bash
openclaw skill install @digitalforgestudios/openclaw-sulcus
```

```json
{
  "plugins": {
    "slots": { "memory": "openclaw-sulcus" },
    "entries": {
      "openclaw-sulcus": {
        "enabled": true,
        "config": {
          "serverUrl": "https://api.sulcus.ca",
          "apiKey": "sk-YOUR_KEY",
          "namespace": "my-agent",
          "autoRecall": true,
          "autoCapture": true
        }
      }
    }
  }
}
```

Get an API key at [sulcus.ca](https://sulcus.ca) → Dashboard → API Keys.

### Python SDK

```bash
pip install sulcus
```

```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...", server_url="https://api.sulcus.ca")
client.remember("User prefers dark mode", memory_type="preference")
results = client.search("UI preferences", limit=5)
```

### Node.js SDK

```bash
npm install @digitalforgestudios/sulcus
```

```typescript
import { Sulcus } from '@digitalforgestudios/sulcus';

const client = new Sulcus({ apiKey: 'sk-...' });
await client.remember('User prefers dark mode', { type: 'preference' });
const results = await client.search('UI preferences');
```

### Sulcus CLI

One binary with everything built-in — MCP server, search, storage, import/export, and local embedded database.

```bash
cargo install sulcus
```

Configure your connection:

```bash
# Cloud mode (default when API key is set)
export SULCUS_API_KEY="sk-your-key"
export SULCUS_NAMESPACE="my-agent"       # optional, defaults to "default"
export SULCUS_SERVER_URL="https://api.sulcus.ca"  # optional, this is the default

# Local mode (no API key required — works offline)
sulcus --local remember "User prefers dark mode"

# Hybrid mode (local-first, syncs to cloud)
# Set API key AND use --local, or set SULCUS_SYNC=1
export SULCUS_SYNC=1
sulcus remember "fact"  # writes to local SQLite, syncs to cloud in background
```

#### Backend Modes

| Mode | Config | Storage | Requires API Key | Offline |
|------|--------|---------|------------------|---------|
| **Cloud** | `SULCUS_API_KEY` set | `api.sulcus.ca` | Yes | No |
| **Local** | `--local` flag | `~/.sulcus/data/` (SQLite) | No | Yes |
| **Hybrid** | API key + `SULCUS_SYNC=1` | Local-first, cloud sync | Yes | Degrades gracefully |

Hybrid mode writes to local storage first (fast, offline-safe), then replicates to the cloud API in the background. Conflict resolution uses thermodynamic heat — higher heat wins.

#### Commands

```bash
# Store a memory
sulcus remember "User prefers dark mode" --type preference
sulcus remember "Deploy script is at /opt/deploy.sh" --type procedural --source cli

# Search memories
sulcus search "UI preferences"
sulcus search "deploy" -n 10 --type procedural
sulcus search "project status" --min-heat 0.3

# Check connection and memory stats
sulcus status

# Import/export (markdown format, round-trip compatible)
sulcus export > memories.md
sulcus export --output backup.md
sulcus import memories.md

# MCP server for Claude Desktop, Cursor, VS Code, etc.
sulcus mcp stdio
sulcus mcp http --port 3100

# Manual sync (hybrid mode)
sulcus sync
```

#### MCP Integration (Claude Desktop / Cursor / Any MCP Client)

The CLI includes a built-in MCP server with 18 tools — no separate sidecar needed.

**Claude Desktop / Cursor:**

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "sulcus",
      "args": ["mcp", "stdio"],
      "env": {
        "SULCUS_API_KEY": "sk-your-key",
        "SULCUS_NAMESPACE": "my-agent"
      }
    }
  }
}
```

**Hermes Agent / OpenClaw / Any stdio MCP host:**

```yaml
mcp_servers:
  sulcus:
    command: sulcus
    args: [mcp, stdio]
    env:
      SULCUS_API_KEY: sk-your-key
      SULCUS_NAMESPACE: my-agent
      SULCUS_SERVER_URL: https://api.sulcus.ca
```

**Streamable HTTP (multi-client, remote access):**

```bash
sulcus mcp http --port 3100 --host 0.0.0.0
```

#### MCP Tools (18)

The MCP server exposes all memory operations as tools:

| Tool | Description |
|------|-------------|
| `record_memory` | Store a memory (SIU pipeline fires automatically) |
| `search_memory` | Multi-signal semantic search |
| `build_context` | Auto-recall: query-aware context block from search + graph + hot nodes |
| `list_hot_nodes` | Most active memories by heat |
| `get_node` | Get a specific memory by ID |
| `forget_memory` | Delete a memory |
| `update_memory` | Update content or type |
| `memory_boost` | Increase heat on a memory |
| `memory_deprecate` | Accelerate decay |
| `memory_relate` | Create graph edges between memories |
| `memory_reclassify` | Change memory type |
| `create_trigger` | Create a reactive trigger rule |
| `list_triggers` | List active triggers |
| `delete_trigger` | Remove a trigger |
| `evaluate_output` | Evaluate agent output for memory capture |
| `compact_memory` | Consolidate cold memories |
| `metrics` | Memory stats and type breakdown |
| `storage_info` | Backend connection and namespace info |

### Framework Integrations

| Platform | Package |
|---|---|
| LangChain | `sulcus-langchain` |
| LlamaIndex | `sulcus-llamaindex` |
| CrewAI | `sulcus-crewai` |
| Vercel AI SDK | `sulcus-vercel-ai` |
| OpenAI Function Calling | `integrations/openai-tools/` |
| Anthropic Tools | `integrations/anthropic-tools/` |

---

## Memory Types

| Type | Decay Rate | Use For |
|---|---|---|
| `episodic` | Fast | Events, sessions, one-off observations |
| `semantic` | Slow | Concepts, relationships, domain knowledge |
| `fact` | Slow | Stable factual knowledge |
| `preference` | Slower | User preferences, opinions, style choices |
| `procedural` | Slowest | How-tos, processes, workflows |
| `synthesis` | Slowest | Consolidated insights, derived summaries |

Choose the right type — decay rates differ significantly. The SICU classifier will auto-classify if you don't specify.

---

## Tools (OpenClaw Plugin)

| Tool | Description |
|---|---|
| `memory_store` | Store a memory. SIU pipeline fires automatically. |
| `memory_recall` | Multi-signal semantic search with relevance scoring. |
| `memory_status` | Backend status, namespace info, hot nodes, decay mode. |
| `memory_delete` | Delete a memory by ID. |
| `consolidate` | Merge and prune cold memories below a heat threshold. |
| `export_markdown` | Export all memories as Markdown. |
| `import_markdown` | Import memories from Markdown. |
| `evaluate_triggers` | Evaluate reactive triggers against an event. |
| `trigger_feedback` | Submit feedback to improve trigger accuracy. |

---

## Repository Structure

```
sulcus/
├── crates/
│   ├── sulcus/               # Unified CLI binary (cargo install sulcus)
│   ├── sulcus-core/          # Shared types, StorageBackend trait, defaults
│   ├── sulcus-cloud/         # Cloud API client (reqwest → api.sulcus.ca)
│   ├── sulcus-local/         # Embedded SQLite + fastembed (local mode)
│   └── sulcus-mcp-impl/     # MCP server handler (18 tools, rmcp)
├── packages/
│   ├── openclaw-sulcus/      # OpenClaw plugin (TypeScript, npm)
│   └── membench/             # MemBench benchmark suite
├── sdks/
│   ├── node/                 # @sulcus/sdk (npm)
│   └── python/               # sulcus (PyPI)
├── integrations/             # LangChain, LlamaIndex, CrewAI, etc.
├── plugins/
│   └── claude-code-sulcus/   # Claude Code / Claude Desktop MCP plugin
├── skills/
│   └── openclaw-sulcus-skill/ # OpenClaw AgentSkill
├── docs/                     # Architecture, API reference, setup guides
└── tools/                    # Hooks, manifests, examples
```

---

## API Overview

### Core Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/agent/remember` | Store a memory |
| `POST` | `/api/v1/agent/search` | Search memories (semantic + FTS) |
| `POST` | `/api/v1/agent/recall` | Recall with full scoring pipeline |
| `GET` | `/api/v1/agent/memory/:id` | Get a specific memory |
| `PATCH` | `/api/v1/agent/memory/:id` | Update a memory |
| `DELETE` | `/api/v1/agent/memory/:id` | Delete a memory |
| `POST` | `/api/v1/agent/boost` | Heat-boost a memory |
| `GET` | `/api/v1/status` | Server status + version |

### Authentication

All API requests require an API key in the `Authorization` header:

```
Authorization: Bearer sk-your-api-key
```

Get your key at [sulcus.ca](https://sulcus.ca) → Dashboard → API Keys.

Full API documentation: [API_REFERENCE.md](docs/API_REFERENCE.md)

---

## Architecture

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

The `sulcus` binary adapts automatically:
- **API key set** → cloud mode (REST API client)
- **`--local` flag** → local mode (embedded SQLite + fastembed, no network)
- **API key + `SULCUS_SYNC=1`** → hybrid mode (local-first, cloud sync)

MCP is always local — the `sulcus` binary runs as a stdio or HTTP server on your machine. It never proxies raw MCP to the cloud. Cloud communication uses the REST API.

## Autonomous Memory Curation

Sulcus doesn't just store memories — it actively maintains them. A background **curation cycle** runs every 30 minutes (configurable via `CURATOR_INTERVAL_SECS`) and performs six autonomous maintenance passes:

1. **Re-classify stale nodes** — Flags unrecalled nodes for SIU reclassification
2. **Consolidate near-duplicates** — Merges nodes with >0.92 cosine similarity (archives the weaker node, never deletes)
3. **Summarize verbose nodes** — LLM-powered condensation of long, low-recall nodes
4. **Re-vectorize** — Generates fresh embeddings for nodes missing them
5. **Mark stale confidence** — Flags nodes unrecalled for 30+ days
6. **Sync to knowledge graph** — Pushes modified nodes to the Apache AGE graph index

The curator also feeds a **self-improving training pipeline**: interactions like `store`, `delete`, `pin`, `boost`, and `reclassify` generate training signals that retrain the SIVU (quality gate) and SICU (type classifier) models offline. Retrained models deploy as ONNX and hot-swap into the running instance — no restart required.

→ [Curation Cycle details](docs/CURATION.md) · [Offline Training Pipeline](docs/OFFLINE_TRAINING.md)

---

## Contributing

Issues and PRs welcome for SDKs, integrations, plugins, and documentation. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

The core engine and server are proprietary and not open to contributions. See [CLASSIFICATION.md](CLASSIFICATION.md).

---

## Who Built This

**Sulcus** is built by [Digital Forge Studios](https://dforge.ca).

The project embodies the conviction that AI agents deserve real memory — not bolted-on retrieval, but a first-principles system that understands what matters, what's fading, and what should be remembered.

---

## License

SDKs, integrations, and plugins: [MIT](sdks/python/LICENSE) · Core engine and server: [Proprietary](LICENSE)

---

*The sulci of the brain — those folded grooves that give the cortex its surface area — are where memory lives. The deeper the fold, the more surface area, the more capacity.*
