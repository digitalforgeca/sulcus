# Sulcus Plugin for Claude Code

Persistent, thermodynamic memory for Claude Code — decisions, patterns, and learnings survive across sessions.

## What It Does

| Lifecycle Event | What Happens |
|---|---|
| **SessionStart** | Searches Sulcus for project context, hot memories, and status. Injects relevant memories into context. |
| **UserPromptSubmit** | On every user message, searches for relevant memories and injects them as context (skip for short prompts). |
| **PreToolUse** | Blocks writes to `MEMORY.md` and file-based memory. Redirects to Sulcus MCP tools. |
| **PostToolUse** | Tracks files modified and notable commands for session state capture. |
| **PreCompact** | Before context compaction, captures a comprehensive session summary to Sulcus (both direct API and Claude-driven via MCP). |
| **TaskCompleted** | After a task completes, prompts Claude to extract and store key learnings. |
| **Stop** | On session end, extracts signal content (decisions, architecture, bugs) from transcript and stores them. Prompts Claude to save any unstored learnings. |

## Setup

### 1. Set environment variables

```bash
export SULCUS_API_KEY="your-api-key"
export SULCUS_SERVER_URL="https://api.sulcus.ca"  # optional, this is the default
export SULCUS_NAMESPACE="your-namespace"           # optional, defaults to $USER
```

Get your API key at [sulcus.ca](https://sulcus.ca).

### 2. Install the plugin

**From the Sulcus repository:**
```bash
claude plugin marketplace add /path/to/sulcus/plugins
claude plugin install claude-code-sulcus
```

**Or from GitHub:**
```bash
claude plugin marketplace add https://github.com/digitalforgeca/sulcus.git --sparse plugins
claude plugin install claude-code-sulcus
```

### 3. Verify

```bash
claude plugin list
```

Should show `claude-code-sulcus@sulcus-plugins` as enabled.

## MCP Tools (36 available)

The plugin connects to the Sulcus MCP server, giving Claude access to:

| Category | Tools |
|---|---|
| **Core Memory** | `search_memory`, `record_memory`, `list_memories`, `get_memory`, `delete_memory`, `update_memory` |
| **Thermodynamics** | `memory_boost`, `memory_deprecate`, `configure_thermodynamics`, `get_thermodynamics` |
| **Knowledge Graph** | `graph_neighbors`, `graph_temporal`, `graph_status`, `graph_verify` |
| **Triggers** | `create_trigger`, `list_triggers`, `delete_trigger`, `evaluate_triggers` |
| **Organization** | `consolidate`, `fold_memories`, `bulk_patch`, `bulk_delete` |
| **SIU (Quality)** | Quality-gated storage — low-quality memories are rejected before they pollute the graph |

## Skills

### `sulcus-search`
Activated when user asks about past work, previous sessions, or wants to recall information. Guides Claude to use semantic search effectively.

### `sulcus-save`
Activated when important decisions, patterns, or learnings should be stored. Guides Claude on memory types, what makes good memories, and when to store proactively.

## Architecture

```
                    Claude Code Session
                           │
     ┌─────────────────────┼──────────────────────┐
     │                     │                       │
SessionStart        UserPromptSubmit          PreCompact
     │                     │                       │
     ▼                     ▼                       ▼
 Search Sulcus     Search per-prompt      Capture + Instruct
 for project       for relevant           Claude to store
 context           memories               session summary
     │                     │                       │
     └─────────────────────┼──────────────────────┘
                           │
                    Sulcus Server (MCP)
                    ┌──────┴──────┐
                    │  pgvector   │
                    │  AGE graph  │
                    │  SIU gate   │
                    │  Triggers   │
                    └─────────────┘
```

## What Makes Sulcus Different

- **36 MCP tools** — 4x more than Mem0, full graph/trigger/thermodynamic control
- **Knowledge Graph** — memories aren't just vectors; they're connected through semantic relationships
- **Reactive Triggers** — programmable rules that fire on memory events (no competitor has this)
- **SIU Quality Gating** — machine-learned quality filter prevents noise from entering the graph
- **Thermodynamic Decay** — memories naturally cool over time; important ones are boosted by use
- **Signal Extraction** — only captures high-signal turns (decisions, architecture, bugs), not noise

## Requirements

- Node.js 18+
- Sulcus API key ([sulcus.ca](https://sulcus.ca))
- Claude Code with plugin support

## License

Apache-2.0
