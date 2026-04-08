# ◆ Sulcus

**Persistent, intelligent memory for AI agents.** Sulcus gives your agents a real memory layer — vector + graph search, reactive triggers, cross-agent access control, and automatic classification via SIU.

- ⚡ **Reactive triggers** — `on_store`, `on_recall`, `on_decay`, `on_threshold` → auto-pin, boost, notify, webhook
- 🔍 **Vector + graph search** — HNSW index with FastEmbed (local) or pgvector (cloud); graph edges for related memories
- 🏠 **Local-first** — embedded PostgreSQL (pg-embed), runs entirely on your machine
- 🔒 **Cross-agent ACL** — namespace isolation and tenant-scoped keys; memories stay in the right hands
- 🤖 **SIU classification** — automatic memory type detection (episodic, semantic, preference, procedural, fact)
- 🔥 **Heat-based decay** — memories cool naturally over time; important ones stay hot (thermodynamic model, one of many mechanisms)
- 🔌 **MCP native** — works with Claude Code, OpenClaw, Cursor, and any MCP client
- ☁️ **Cloud sync** — optional CRDT sync to sulcus.ca (paid tier)

## Quick Start

### Install sulcus

```bash
# Homebrew (macOS/Linux)
brew install digitalforgeca/tap/sulcus

# npm (downloads pre-built binary)
npm install -g @digitalforgestudios/sulcus

# Or build from source (requires Rust)
cargo install sulcus
```

### Connect to Claude Code

**Recommended: Full plugin** (hooks + MCP + auto-context):

```bash
# Add Sulcus as a plugin marketplace
claude plugin marketplace add https://github.com/digitalforgeca/sulcus --sparse plugins/claude-code-sulcus

# Install the plugin
claude plugin install sulcus-memory
```

This gives you 7 lifecycle hooks (session start context injection, semantic search on every prompt, file change tracking, compaction awareness, task capture, memory file protection, session end tracking) plus 36 MCP tools.

See [`plugins/claude-code-sulcus/`](./plugins/claude-code-sulcus/) for full docs.

**Alternative: Raw MCP-only** (tools without hooks):

```bash
claude mcp add sulcus -- sulcus stdio
```

### Connect to OpenClaw

Install the [OpenClaw Sulcus plugin](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus):

```bash
npm install @digitalforgestudios/openclaw-sulcus
```

Or via ClawHub skill:

```bash
clawhub install digitalforgeca/openclaw-sulcus-skill
```

## SDKs

| Language | Package | Install |
|---|---|---|
| Python | [sulcus](https://pypi.org/project/sulcus/) | `pip install sulcus` |
| Node.js | [sulcus](https://www.npmjs.com/package/sulcus) | `npm install sulcus` |

### Python

```python
from sulcus import Sulcus

client = Sulcus(api_key="your-key", base_url="https://api.sulcus.ca")

# Store a memory
client.remember("User prefers dark mode", memory_type="preference", decay_class="stable")

# Search memories
results = client.recall("user preferences", limit=5)

# Boost a memory
client.boost(node_id="uuid", amount=0.3)
```

### Node.js

```javascript
import { Sulcus } from 'sulcus';

const client = new Sulcus({ apiKey: 'your-key', baseUrl: 'https://api.sulcus.ca' });

// Store a memory
await client.remember('User prefers dark mode', { memoryType: 'preference', decayClass: 'stable' });

// Search memories
const results = await client.recall('user preferences', { limit: 5 });

// Boost a memory
await client.boost(nodeId, 0.3);
```

## Integrations

| Framework | Package | Description |
|---|---|---|
| [LangChain](./integrations/langchain/) | `sulcus-langchain` | Memory backend for LangChain agents |
| [LlamaIndex](./integrations/llamaindex/) | `sulcus-llamaindex` | Vector store + document store |
| [CrewAI](./integrations/crewai/) | `sulcus-crewai` | Crew-level shared memory + tools |
| [Deep Agents](./integrations/deepagents/) | `sulcus-deepagents` | Replaces flat AGENTS.md with persistent memory |
| [Vercel AI](./integrations/vercel-ai/) | `sulcus-vercel-ai` | LanguageModelV3Middleware |
| [OpenClaw](./packages/openclaw-sulcus/) | `@digitalforgestudios/openclaw-sulcus` | Memory plugin for OpenClaw |
| CLI | [integrations/cli](./integrations/cli/) | Command-line memory management |

## Memory Types

| Type | Description | Decay |
|---|---|---|
| `episodic` | Events, conversations | Fast |
| `semantic` | Knowledge, concepts | Slow |
| `preference` | User preferences, opinions | Slower |
| `procedural` | How-to, processes | Slowest |
| `fact` | Stable data, ground truth | Slow |

## Triggers

Sulcus triggers let memory react to its own lifecycle — no competitor has this.

```python
# Pin any preference that gets recalled
client.create_trigger(
    name="pin-recalled-preferences",
    event="on_recall",
    action="pin",
    filter={"memory_type": "preference"}
)

# Webhook when memories decay below threshold
client.create_trigger(
    name="cold-memory-alert",
    event="on_threshold",
    action="webhook",
    config={"heat_below": 0.1, "url": "https://your-app.com/webhook"}
)
```

## Claude Code Plugin

The [`plugins/claude-code-sulcus/`](./plugins/claude-code-sulcus/) directory contains the full Claude Code integration (v2.0.0).

**7 lifecycle hooks:**

| Hook | What it does |
|------|-------------|
| `SessionStart` | Injects your hottest memories as context on every session start |
| `UserPromptSubmit` | Semantic search on every prompt — top 5 relevant memories injected automatically |
| `PreToolUse` | Blocks direct writes to memory files — enforces MCP tool usage |
| `PostToolUse` | Tracks file changes (Write/Edit/Bash) as episodic memories |
| `PreCompact` | Marks compaction events so future sessions know context was truncated |
| `TaskCompleted` | Records completed tasks as procedural memories |
| `Stop` | Session end marker for timeline tracking |

**Plus 36 MCP tools** for full programmatic control (search, store, triggers, graph, thermodynamics, sync).

See the [plugin README](./plugins/claude-code-sulcus/README.md) for installation and environment setup.

## Architecture

```
sulcus (binary)
├── Embedded PostgreSQL / pg-embed (port 4201)
├── HNSW vector index (FastEmbed)
├── MCP server (stdio protocol)
├── Heat-based decay engine (thermodynamic model)
├── SIU classifier (automatic memory type detection)
└── Trigger engine (reactive memory governance)

sulcus-sync (paid, subscription)
├── CRDT cloud sync to api.sulcus.ca
├── P2P discovery
└── Cross-agent namespace sync
```

## Links

- **Website:** [sulcus.ca](https://sulcus.ca)
- **Dashboard:** [sulcus.ca/dashboard](https://sulcus.ca/dashboard)
- **Status:** [sulcus.ca/status](https://sulcus.ca/status)
- **Docs:** [sulcus.ca/docs](https://sulcus.ca/docs)
- **OpenClaw Plugin:** [@digitalforgestudios/openclaw-sulcus](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus)
- **ClawHub Skill:** [digitalforgeca/openclaw-sulcus-skill](https://clawhub.ai/digitalforgeca/openclaw-sulcus-skill)
- **Claude Code Plugin:** [`plugins/claude-code-sulcus/`](./plugins/claude-code-sulcus/)

## License

- **sulcus binary:** Proprietary — Digital Forge Studios. Free to use, not open source.
- **SDKs (Python, Node.js):** MIT — API clients only.
- **Integrations:** MIT — glue code only.
- **OpenClaw plugin:** MIT — API client only.

© 2026 Digital Forge Studios. All rights reserved.
