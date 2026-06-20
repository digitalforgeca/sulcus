# Sulcus Memory Plugin for Cursor

**Author:** [Digital Forge Studios](https://sulcus.ca)  
**License:** MIT  
**Version:** 1.0.0  
**Links:** [sulcus.ca](https://sulcus.ca) · [GitHub](https://github.com/digitalforgeca/sulcus)

---

Give Cursor persistent, cross-session memory powered by [Sulcus](https://sulcus.ca) — thermodynamic memory with heat-based decay, a knowledge graph, semantic search, reactive triggers, and adaptive recall via SIRU.

## What It Does

This plugin wires seven Cursor lifecycle hooks into Sulcus, giving your AI:

- **Multi-signal recall** on every user prompt (semantic search + hot-context + entity-context)
- **Hot-context injection** at session start (your most active memories, automatically)
- **SIRU training data** — every recall session is logged for adaptive weight optimization
- **Protection** against accidentally overwriting memory files directly
- **Auto-capture** of file changes, task completions, and session lifecycle events
- **Compaction awareness** so memory continuity survives context window resets
- **36+ MCP tools** for full programmatic control of your memory graph

---

## Hooks

| Hook | Script | Description |
|------|--------|-------------|
| `sessionStart` | `session-start.sh` | Fetches your hottest memories + SIRU weight status and injects them as context. |
| `beforeSubmitPrompt` | `on-user-prompt.sh` | Multi-signal recall: semantic search + hot-context + entity-context. |
| `preToolUse` | `block-memory-write.sh` | Blocks direct file writes to `.sulcus/`, `MEMORY.md`, or `memory/` paths. |
| `postToolUse` | `post-tool-use.sh` | Records file paths modified by Write/Edit/Bash tools as episodic memories. |
| `preCompact` | `on-pre-compact.sh` | Stores an episodic marker before context compaction. |
| `stop` | `on-stop.sh` | Stores an episodic marker on session shutdown. |

---

## Installation

```bash
# From the Sulcus repo
cursor plugin install /path/to/sulcus/plugins/cursor-sulcus

# Or from Git
cursor plugin install https://github.com/digitalforgeca/sulcus
```

## Environment Variables

```bash
export SULCUS_SERVER_URL="https://api.sulcus.ca"
export SULCUS_API_KEY="your-api-key"
```

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SULCUS_SERVER_URL` | `https://api.sulcus.ca` | No | Sulcus server base URL |
| `SULCUS_API_KEY` | — | Yes (cloud) | Your Sulcus API key |

If `SULCUS_API_KEY` is not set but the `sulcus` binary is available locally, hooks use local mode.

### Get an API Key

1. Visit [sulcus.ca](https://sulcus.ca)
2. Create a free account
3. Generate an API key from your dashboard

## MCP Tools

The plugin connects Cursor to the Sulcus MCP server (19 tools):

| Category | Tools | What They Do |
|----------|-------|--------------|
| **Core Memory** | `sulcus_remember`, `sulcus_search`, `sulcus_list`, `sulcus_forget`, `sulcus_update` | Store, search, browse, delete, and update memories |
| **Heat** | `sulcus_boost`, `sulcus_deprecate`, `sulcus_hot_nodes` | Adjust importance and see active memories |
| **Context** | `sulcus_build_context`, `sulcus_auto_recall`, `sulcus_auto_capture` | Assemble context blocks, full recall pipeline, SIU-gated capture |
| **Triggers** | `sulcus_create_trigger`, `sulcus_list_triggers`, `sulcus_delete_trigger` | Reactive rules that fire on memory events |
| **Graph** | `sulcus_relate`, `sulcus_graph_traverse` | Create and traverse knowledge graph relationships |
| **Intelligence** | `sulcus_classify`, `sulcus_scan_pii` | SIU v2 quality gate, PII detection |
| **Status** | `sulcus_status` | Server health, version, memory count |

## Memory Types

| Type | Decay Rate | Best For |
|------|-----------|----------|
| `episodic` | Fast | Events, session logs, what happened |
| `semantic` | Slow | Knowledge, concepts, learned facts |
| `preference` | Slower | User preferences, style, opinions |
| `procedural` | Slowest | How-tos, workflows, step-by-step processes |
| `fact` | Slow | Stable data, configurations, IDs |

## License

MIT — [Digital Forge Studios](https://sulcus.ca)
