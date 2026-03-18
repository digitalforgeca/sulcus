# Sulcus — vMMU for AI Agents

[![GitHub Stars](https://img.shields.io/github/stars/mcdoolz/sulcus?style=social)](https://github.com/digitalforgeca/sulcus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Give your agents a mind that pages memory in and out of context based on thermodynamic importance.

**Dashboard:** [sulcus.ca](https://sulcus.ca) · **Server:** [api.sulcus.ca](https://api.sulcus.ca) · **Docs:** [API Reference](API_REFERENCE.md) · **Integrations:** [Guide](INTEGRATIONS.md)

---

## What is Sulcus?

AI agents forget. Context windows fill up, old facts disappear, and naive RAG pulls irrelevant noise. Sulcus fixes this with a **Virtual Memory Management Unit (vMMU)** — treating the prompt window as registers and local storage as RAM.

### How it works

- **Thermodynamic Decay** — Every memory has heat. New facts start hot (1.0); unused facts cool over time.
- **Topological Diffusion** — Heat diffuses through the knowledge graph. Mentioning a topic warms up related concepts.
- **Automatic Page-In/Out** — Builds a `<sulcus_context>` block each prompt, paging in hot memories and paging out cold ones.
- **Memory Consolidation** — Folds cold episodic memories into dense semantic summaries. Meaning preserved, tokens saved.

---

## Quick Start

### SDKs

```bash
pip install sulcus          # Python
npm install sulcus          # Node.js
```

```python
from sulcus import SulcusClient

client = SulcusClient(api_key="your-key")
client.remember("User prefers dark mode")
results = client.search("UI preferences")
```

```typescript
import { SulcusClient } from 'sulcus';

const client = new SulcusClient({ apiKey: 'your-key' });
await client.remember('User prefers dark mode');
const results = await client.search('UI preferences');
```

### Local (MCP Sidecar)

```bash
git clone https://github.com/digitalforgeca/sulcus
cd sulcus
cargo build -p sulcus-local --release
./target/release/sulcus-local stdio
```

Configure Claude Desktop:
```json
{
  "mcpServers": {
    "sulcus": {
      "command": "/path/to/sulcus-local",
      "args": ["stdio"]
    }
  }
}
```

---

## Integrations

| Platform | Package | Install |
|---|---|---|
| **Python SDK** | `sulcus` | `pip install sulcus` |
| **Node.js SDK** | `sulcus` | `npm install sulcus` |
| **LangChain** | `sulcus-langchain` | `pip install sulcus-langchain` |
| **LlamaIndex** | `sulcus-llamaindex` | `pip install sulcus-llamaindex` |
| **Vercel AI SDK** | `sulcus-vercel-ai` | `npm install sulcus-vercel-ai` |
| **CLI** | `sulcus-cli` | `npm install -g sulcus-cli` |
| **OpenAI tools** | Copy [`tools.json`](integrations/openai-tools/tools.json) | — |
| **Anthropic tools** | Copy [`tools.json`](integrations/anthropic-tools/tools.json) | — |
| **Claude Desktop** | Native MCP | [Config guide](INTEGRATIONS.md#1-claude-desktop-1-click) |
| **OpenClaw** | [`openclaw-sulcus`](packages/openclaw-sulcus) | Plugin |
| **MCP SSE/HTTP** | Built-in | [Server mode](INTEGRATIONS.md#10-mcp-over-httpsse-server-mode) |

---

## Performance

Built in **Rust** with embedded **PostgreSQL 17** (via pg-embed).

- **Sub-50ms latency** for context building and injection
- **384-dim embeddings** via ONNX Runtime (all-MiniLM-L6-v2)
- **Local-first** — your data never leaves your machine
- **Cloud sync** (Cortex tier) — multi-agent, multi-machine memory mesh

---

## Dashboard

The web dashboard at [sulcus.ca](https://sulcus.ca) provides:

- **Memory Graph** — Force-directed visualization of your knowledge graph
- **Memory Table** — Paginated, filterable, searchable memory browser
- **Activity Log** — Timestamped audit trail of all memory operations
- **Gamification** — XP engine, levels (Absolute Zero → Supernova), badges
- **Settings** — API key management, sync preferences
- **Billing** — Stripe Elements checkout for Cortex/Enterprise tiers
- **Agent Management** — Multi-agent configuration and monitoring

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Your LLM / Agent Framework                          │
│  (Claude, GPT, LangChain, LlamaIndex, Vercel AI...) │
└──────────────┬───────────────────────────────────────┘
               │ MCP / SDK / REST
┌──────────────▼───────────────────────────────────────┐
│  sulcus-local (Rust binary)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Heat Engine   │  │ Graph Index  │  │ Embeddings │ │
│  │ (decay/boost) │  │ (golden_idx) │  │ (ONNX)     │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Embedded PostgreSQL 17 (pg-embed, port 4201)     │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────────────┘
               │ Cloud Sync (Cortex/Enterprise)
┌──────────────▼───────────────────────────────────────┐
│  sulcus-server (Azure Container Apps)                 │
│  Multi-tenant · CRDT sync · Stripe billing            │
│  Activity log · Gamification · Team management        │
│  api.sulcus.ca                              │
└──────────────────────────────────────────────────────┘
```

---

## Plans

| | Open (Free) | Cortex ($29/mo) | Enterprise ($149/mo) |
|---|---|---|---|
| Local memory | ✅ Unlimited | ✅ Unlimited | ✅ Unlimited |
| Cloud sync | ❌ | ✅ 10,000 req/mo | ✅ Unlimited |
| Agents | 1 | 5 | Unlimited |
| Nodes | 1,000 | 10,000 | Unlimited |
| Teams | ❌ | ✅ 3 seats | ✅ Unlimited |
| MCP Server | ❌ | ✅ | ✅ |
| Priority support | ❌ | ❌ | ✅ |

---

## Project Structure

```
sulcus/
├── crates/
│   ├── sulcus-core/        # Core library (heat engine, graph, CRDT, sync)
│   ├── sulcus-local/        # Local MCP sidecar binary
│   └── sulcus-server/       # Cloud server (Axum + SQLx)
├── packages/
│   ├── sulcus-web/          # Next.js dashboard (sulcus.ca)
│   ├── openclaw-sulcus/     # OpenClaw memory plugin
│   ├── sulcus-extension/    # VS Code extension
│   └── sulcus-pglite/       # PGlite adapter
├── sdks/
│   ├── python/              # Python SDK (pip install sulcus)
│   └── node/                # Node.js SDK (npm install sulcus)
├── integrations/
│   ├── langchain/           # LangChain memory + retriever
│   ├── llamaindex/          # LlamaIndex vector store + reader
│   ├── openai-tools/        # OpenAI function calling schemas
│   ├── anthropic-tools/     # Anthropic tool_use schemas
│   ├── vercel-ai/           # Vercel AI SDK middleware + tools
│   └── cli/                 # CLI tool (sulcus-cli)
└── docs/
    └── COLLECTIVE_BRAIN.md
```

---

## License

| Component | License |
|---|---|
| `sulcus-core`, `sulcus-local`, SDKs, integrations | MIT |
| `sulcus-server` (Cloud) | Commercial |

---

Built with 🦀 by [Digital Forge Studios](https://dforge.ca)
