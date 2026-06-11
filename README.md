# Sulcus — Thermodynamic Memory for AI Agents

[![Status](https://img.shields.io/badge/api-operational-green)](https://api.sulcus.ca/api/v1/status)
[![npm](https://img.shields.io/npm/v/@digitalforgestudios/openclaw-sulcus)](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus)
[![Web](https://img.shields.io/badge/portal-sulcus.ca-blue)](https://sulcus.ca)

AI agents forget. Context windows fill up, old facts disappear, and naive RAG pulls irrelevant noise. Sulcus fixes this with a **Virtual Memory Management Unit (vMMU)** — treating the prompt window as registers and long-term storage as RAM.

**Live:** [sulcus.ca](https://sulcus.ca) · **API:** [api.sulcus.ca](https://api.sulcus.ca) · **npm:** [@digitalforgestudios/openclaw-sulcus](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus)

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

### MCP Sidecar (Claude Desktop / Claude Code)

```bash
cargo install sulcus
sulcus stdio
```

Uses embedded PGlite — no external database needed. Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "sulcus",
      "args": ["stdio"]
    }
  }
}
```

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
│   ├── sulcus-core/          # Shared: thermodynamics, CRDT, graph models
│   ├── sulcus/               # CLI + MCP sidecar (open-source binary)
│   ├── sulcus-server/        # Multi-tenant API server
│   ├── sulcus-store/         # Storage abstraction layer
│   ├── sulcus-types/         # Shared type definitions
│   ├── sulcus-vectors/       # Vector/embedding utilities
│   └── sulcus-wasm/          # Browser WASM target
├── packages/
│   ├── openclaw-sulcus/      # OpenClaw plugin (TypeScript)
│   ├── sulcus-web/           # Dashboard + marketing site
│   └── sulcus-local/         # NPX-runnable local sidecar
├── sdks/
│   ├── node/                 # @sulcus/sdk (npm)
│   └── python/               # sulcus (PyPI)
├── integrations/             # LangChain, LlamaIndex, CrewAI, etc.
├── plugins/
│   └── claude-code-sulcus/   # Claude Code / Claude Desktop MCP plugin
├── models/
│   └── siu-v2/               # ONNX models (SIVU + SICU)
└── skills/
    └── openclaw-sulcus-skill/ # OpenClaw AgentSkill
```

---

## Local Development

### Prerequisites

- **Rust** (stable, latest)
- **Node.js** 20+
- **Docker** (for local Postgres)

### Quick Start

```bash
# 1. Clone
git clone https://github.com/digitalforgeca/sulcus.git
cd sulcus

# 2. Start local PostgreSQL with AGE
docker run -d --name sulcus-pg \
  -e POSTGRES_USER=sulcus \
  -e POSTGRES_PASSWORD=sulcus \
  -e POSTGRES_DB=sulcus \
  -p 5432:5432 \
  apache/age:PG16_latest

# 3. Run the server
export SULCUS_DATABASE_URL="postgres://sulcus:sulcus@localhost:5432/sulcus"
export SULCUS_BIND_ADDR="0.0.0.0:8080"
cargo run --features server-bin -p sulcus-server

# 4. Test
curl http://localhost:8080/api/v1/status
```

Migrations run automatically on startup.

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
┌─────────────────────────────────────────────────────┐
│                    Clients                           │
│  OpenClaw Plugin │ SDK (Py/Node) │ MCP Sidecar │ Web│
└────────────┬────────────┬──────────────┬────────────┘
             │            │              │
             ▼            ▼              ▼
┌─────────────────────────────────────────────────────┐
│              sulcus-server (Rust/Axum)               │
│                                                      │
│  ┌─────────┐ ┌──────────┐ ┌────────────┐           │
│  │ Auth    │→│ Agent API │→│ SIU v2     │           │
│  │         │ │ (CRUD,   │ │ Pipeline   │           │
│  │         │ │  Recall) │ │            │           │
│  └─────────┘ └────┬─────┘ └─────┬──────┘           │
│                   │             │                    │
│  ┌────────────────┴─────────────┴──────────────┐    │
│  │       PostgreSQL + pgvector + Apache AGE     │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────┐ ┌───────────┐ ┌──────────────┐       │
│  │ Triggers │ │ Entity    │ │ Embeddings   │       │
│  │ Engine   │ │ Extraction│ │ (fastembed)  │       │
│  └──────────┘ └───────────┘ └──────────────┘       │
└─────────────────────────────────────────────────────┘
```

**Stack:** Rust (Axum) · PostgreSQL · pgvector · Apache AGE · fastembed (BGE-small-en-v1.5) · ONNX Runtime

---

## Self-Hosting

Sulcus can be self-hosted. You need:

- PostgreSQL 16+ with `pgvector` and `apache_age` extensions
- The `sulcus-server` binary (build from source or use the Docker image)
- ONNX Runtime library (bundled in Docker image)

```bash
# Build the server
cargo build --release --features server-bin -p sulcus-server

# Run with your database
SULCUS_DATABASE_URL="postgres://user:pass@host:5432/sulcus" \
SULCUS_BIND_ADDR="0.0.0.0:8080" \
./target/release/sulcus-server
```

Or use Docker:

```bash
docker build -f docker/server/Dockerfile -t sulcus-server .
docker run -e SULCUS_DATABASE_URL="..." -p 8080:8080 sulcus-server
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SULCUS_DATABASE_URL` | Yes | PostgreSQL connection string |
| `SULCUS_BIND_ADDR` | No | Listen address (default: `0.0.0.0:8080`) |
| `SULCUS_EXTRACTION_ENABLED` | No | Enable LLM entity extraction (SILU) |
| `SULCUS_EXTRACTION_ENDPOINT` | No | LLM API endpoint for entity extraction |
| `SULCUS_EXTRACTION_API_KEY` | No | LLM API key |
| `SULCUS_EXTRACTION_MODEL` | No | Model for extraction (default: `gpt-4o-mini`) |
| `ORT_DYLIB_PATH` | No | ONNX Runtime library path |
| `SIU_V2_MODEL_DIR` | No | SIVU/SICU ONNX model directory |

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Who Built This

**Sulcus** is built by [Digital Forge Studios](https://dforge.ca).

The project embodies the conviction that AI agents deserve real memory — not bolted-on retrieval, but a first-principles system that understands what matters, what's fading, and what should be remembered.

---

## License

SDKs, integrations, and plugins: [MIT](sdks/python/LICENSE) · Core engine and server: [Proprietary](LICENSE)

---

*The sulci of the brain — those folded grooves that give the cortex its surface area — are where memory lives. The deeper the fold, the more surface area, the more capacity.*
