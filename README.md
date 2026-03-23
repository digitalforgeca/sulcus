# Sulcus

**Thermodynamic memory for AI agents.** Memories have heat, decay over time, and can be boosted, pinned, or deprecated. Reactive triggers let memory govern itself.

- 🔥 **Thermodynamic decay** — memories cool naturally; important ones stay hot
- ⚡ **Reactive triggers** — `on_store`, `on_recall`, `on_decay`, `on_threshold` → auto-pin, boost, notify, webhook
- 🔍 **Vector + keyword search** — HNSW index with FastEmbed (local) or pgvector (cloud)
- 🧠 **MCP native** — works with Claude Code, OpenClaw, Cursor, and any MCP client
- 🏠 **Local-first** — embedded PostgreSQL, runs entirely on your machine
- ☁️ **Cloud sync** — optional CRDT sync to sulcus.ca (paid tier)

## Quick Start

### Install sulcus-local

```bash
# Homebrew (macOS/Linux)
brew install digitalforgeca/tap/sulcus-local

# npm (downloads pre-built binary)
npm install -g @digitalforgestudios/sulcus-local

# Or build from source (requires Rust)
cargo install sulcus-local
```

### Connect to Claude Code

```bash
claude mcp add sulcus -- sulcus-local stdio
```

### Connect to OpenClaw

Install the [Sulcus memory plugin](https://clawhub.com/devuser/sulcus-memory):

```bash
clawhub install devuser/sulcus-memory
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
| [Deep Agents](./integrations/deepagents/) | `sulcus-deepagents` | Replaces flat AGENTS.md with thermodynamic memory |
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

## Architecture

```
sulcus-local (free, open source)
├── Embedded PostgreSQL (port 4201)
├── HNSW vector index (FastEmbed)
├── MCP server (stdio protocol)
├── Thermodynamic engine (decay, consolidation)
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
- **ClawHub Skill:** [devuser/sulcus-memory](https://clawhub.com/devuser/sulcus-memory)

## License

- **sulcus-local binary:** Proprietary — Digital Forge Studios. Free to use, not open source.
- **SDKs (Python, Node.js):** MIT — API clients only.
- **Integrations:** MIT — glue code only.
- **OpenClaw plugin:** MIT — API client only.

© 2026 Digital Forge Studios. All rights reserved.
