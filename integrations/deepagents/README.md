# Sulcus × Deep Agents

Autonomous memory middleware for [LangChain Deep Agents](https://github.com/langchain-ai/deepagents). Replace flat AGENTS.md files with a real semantic VMMU memory engine.

## The Problem

Deep Agents' built-in memory is a Markdown file (`AGENTS.md`) that the LLM manually edits with `edit_file`. This means:
- **No search** — the entire file is loaded every time, regardless of relevance
- **No decay** — everything stays forever until the LLM decides to delete it
- **No cross-agent sharing** — sub-agents get isolated filesystems; their memories die when they terminate
- **No cross-session persistence** — sandbox restarts lose everything
- **No prioritization** — a three-month-old preference and a five-minute-old finding have equal weight

## The Fix

`sulcus-deepagents` replaces this with the Sulcus semantic memory engine:
- **Semantic search** — only relevant memories are injected, ranked by similarity and utility
- **Automatic decay** — episodic memories fade gracefully; semantic knowledge persists for months
- **Cross-agent sharing** — sub-agents write to the same Sulcus graph; findings survive termination
- **Persistent across sessions** — memories live in the database, not the sandbox
- **Dynamic recency & utility** — recently recalled, frequently accessed memories rank higher

## Installation

> **Note:** Sulcus companion packages are published directly to GitHub and consumed via Git URLs. No third-party package registry (PyPI) is required.

```bash
# Install directly from GitHub
pip install "git+https://github.com/digitalforgeca/sulcus.git#subdirectory=integrations/deepagents"
```

## Quick Start

### Middleware (automatic context injection)

```python
from sulcus import Sulcus
from sulcus_deepagents import SulcusMemoryMiddleware
from deepagents import create_deep_agent

client = Sulcus(api_key="sk-...")

agent = create_deep_agent(
    middleware=[
        SulcusMemoryMiddleware(client=client)
    ]
)
```

Every model call now gets relevant memories injected into the system prompt automatically.

### Tools (explicit memory operations)

```python
from sulcus_deepagents import SulcusMemoryTools

memory_tools = SulcusMemoryTools(client=client)

agent = create_deep_agent(
    tools=memory_tools.tools()
)
```

The agent gets five memory tools:

| Tool | Description |
|---|---|
| `sulcus_store` | Store a memory with type + importance classification |
| `sulcus_search` | Search by natural language, ranked by relevance and recency |
| `sulcus_recall` | Recall a memory by ID, boosting its priority |
| `sulcus_pin` | Pin/unpin to prevent/allow decay |
| `sulcus_forget` | Permanently delete a memory |

### Combined (recommended)

```python
agent = create_deep_agent(
    middleware=[SulcusMemoryMiddleware(client=client)],
    tools=memory_tools.tools(),
)
```

The middleware handles passive context injection. The tools handle active memory management. Together, the agent gets automatic recall AND explicit control.

### Backend (AGENTS.md interception)

```python
from sulcus_deepagents import SulcusBackend

agent = create_deep_agent(
    backend=SulcusBackend(client=client)
)
```

Intercepts AGENTS.md reads/writes — `read_file("AGENTS.md")` returns a Sulcus-generated summary; `write_file("AGENTS.md", content)` parses and stores entries as individual memory nodes.

## Memory Types

| Type | Use For | Default Decay |
|---|---|---|
| `episodic` | Events, conversations, task findings | Fast (24h half-life) |
| `semantic` | Facts, knowledge, data | Slow (30d half-life) |
| `preference` | Settings, opinions, style | Slower (90d half-life) |
| `procedural` | Workflows, how-tos, patterns | Slowest (180d half-life) |
| `moment` | Significant interactions | Slow (custom) |

## Sub-Agent Memory Sharing

This is where Sulcus changes the game. In standard Deep Agents:

```
Main Agent → spawns Sub-Agent → sub-agent edits its AGENTS.md → sub-agent terminates → AGENTS.md is GONE
```

With Sulcus:

```
Main Agent → spawns Sub-Agent → sub-agent calls sulcus_store → sub-agent terminates → memory PERSISTS
```

Both agents share one Sulcus tenant. The sub-agent's findings are immediately searchable by the main agent and any future agents.

## Configuration

```python
SulcusMemoryMiddleware(
    client=client,
    search_limit=15,       # Max memories per turn
    token_budget=2000,     # Approximate tokens for memory context
    memory_types=None,     # Filter types (None = all)
    min_heat=0.0,          # Minimum score threshold
)
```

## Connecting to Local Client or Cloud API

```python
# Connect to local Sulcus single-process binary (default port 4200)
client = Sulcus(base_url="http://localhost:4200")

# Or connect to managed Sulcus API
client = Sulcus(
    api_key="sk-...",
    base_url="https://api.sulcus.ca",
)
```

## Examples

- [`examples/basic_agent.py`](examples/basic_agent.py) — Single agent with persistent memory
- [`examples/multi_agent.py`](examples/multi_agent.py) — Main agent + research sub-agent with shared memory

## Links

- [Sulcus Documentation](https://sulcus.ca/docs)
- [Deep Agents Documentation](https://docs.langchain.com/oss/python/deepagents/overview)
- [Sulcus Python SDK](https://github.com/digitalforgeca/sulcus/tree/master/sdks/python)
- [All Integrations](https://github.com/digitalforgeca/sulcus/tree/master/integrations)
