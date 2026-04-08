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

### Connect to Claude Code (Recommended: Plugin)

The Claude Code plugin gives you hooks + MCP in one step. See [`plugins/claude-code-sulcus/`](./plugins/claude-code-sulcus/) for setup.

For raw MCP-only:

```bash
claude mcp add sulcus -- sulcus stdio
```

### Connect to OpenClaw

Install the [Sulcus memory plugin](https://clawhub.ai/digitalforgeca/sulcus-memory):

```bash
clawhub install digitalforgeca/sulcus-memory
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

The [`plugins/claude-code-sulcus/`](./plugins/claude-code-sulcus/) directory contains the recommended Claude Code integration. It combines:

- **MCP server** — exposes all Sulcus tools to Claude Code
- **Hooks** — `on-user-prompt`, `on-stop`, `on-pre-compact`, `post-tool-use`, and more
- Automatic context injection and memory consolidation on session end

See the plugin README for installation instructions.

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
- **ClawHub Skill:** [digitalforgeca/sulcus-memory](https://clawhub.ai/digitalforgeca/sulcus-memory)

## License

- **sulcus binary:** Proprietary — Digital Forge Studios. Free to use, not open source.
- **SDKs (Python, Node.js):** MIT — API clients only.
- **Integrations:** MIT — glue code only.
- **OpenClaw plugin:** MIT — API client only.

© 2026 Digital Forge Studios. All rights reserved.
