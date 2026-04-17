# Sulcus Memory Plugin for Claude Code

**Author:** [Digital Forge Studios](https://dforge.ca)  
**License:** MIT  
**Version:** 2.1.0  
**Links:** [sulcus.ca](https://sulcus.ca) · [GitHub](https://github.com/digitalforgeca/sulcus)

---

Give Claude Code persistent, cross-session memory powered by [Sulcus](https://sulcus.ca) — thermodynamic memory with heat-based decay, a knowledge graph, semantic search, reactive triggers, and adaptive recall via SIRU.

## What It Does

This plugin wires seven Claude Code lifecycle hooks into Sulcus, giving Claude:

- **Multi-signal recall** on every user prompt (semantic search + hot-context + entity-context)
- **Hot-context injection** at session start (your most active memories, automatically)
- **SIRU training data** — every recall session is logged for adaptive weight optimization
- **Protection** against accidentally overwriting memory files directly
- **Auto-capture** of file changes, task completions, and session lifecycle events
- **Compaction awareness** so memory continuity survives context window resets
- **36 MCP tools** for full programmatic control of your memory graph

---

## Hooks

| Hook | Script | Description |
|------|--------|-------------|
| `SessionStart` | `session-start.sh` | Fetches your hottest memories + SIRU weight status and injects them as context at session start. |
| `UserPromptSubmit` | `on-user-prompt.sh` | Multi-signal recall: semantic search + hot-context + entity-context. Logs session for SIRU training. |
| `PreToolUse` | `block-memory-write.sh` | Blocks direct file writes to `.sulcus/`, `MEMORY.md`, or `memory/` paths. |
| `PostToolUse` | `post-tool-use.sh` | Records file paths modified by Write/Edit/Bash tools as episodic memories. |
| `PreCompact` | `on-pre-compact.sh` | Stores an episodic marker before context compaction. |
| `TaskCompleted` | `on-task-completed.sh` | Stores a procedural memory summarizing completed tasks. |
| `Stop` | `on-stop.sh` | Stores an episodic marker on session shutdown. |

---

## SIU Architecture

The Sulcusian Intelligence Unit (SIU) is a multi-unit pipeline that processes every memory:

| Unit | Name | What It Does |
|------|------|-------------|
| **SIVU** | Value Unit | Binary store/reject quality gate (ONNX) |
| **SICU** | Classification Unit | 5-class memory type classifier (ONNX) |
| **SILU** | Learning Unit | LLM-powered entity extraction + classification |
| **SIRU** | Recall Unit | Adaptive recall weight optimization |
| **SITU** | Trigger Unit | Trigger fire evaluator (planned) |

### SIRU — Adaptive Recall

SIRU learns which memories are most useful by analyzing accumulated recall sessions:

1. Every `UserPromptSubmit` logs what was queried, selected, and scored
2. After 20+ sessions, `POST /api/v2/siu/retrain?model=siru` optimizes weights
3. The plugin fetches learned weights every 30 minutes
4. Composite scoring uses learned weights instead of heuristic defaults

No action needed from the user — training data accumulates automatically.

---

## Installation

```bash
# Option A: Local path
claude plugin install /path/to/sulcus/plugins/claude-code-sulcus

# Option B: Git
claude plugin install https://github.com/digitalforgeca/sulcus

# Option C: Marketplace
claude plugin install sulcus-memory
```

### Verify

```bash
claude plugin list
# sulcus-memory  v2.1.0  enabled
```

---

## Environment Variables

```bash
export SULCUS_SERVER_URL="https://api.sulcus.ca"  # or your self-hosted URL
export SULCUS_API_KEY="your-api-key"
```

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SULCUS_SERVER_URL` | `https://api.sulcus.ca` | No | Sulcus server base URL |
| `SULCUS_API_KEY` | — | Yes (cloud) | Your Sulcus API key |

If `SULCUS_API_KEY` is not set but the `sulcus` binary is available locally, hooks use local mode. If neither is available, hooks exit silently with a configuration warning at session start.

### Get an API Key

1. Visit [sulcus.ca](https://sulcus.ca)
2. Create a free account
3. Generate an API key from your dashboard

---

## MCP Tools

The plugin connects Claude Code to the full Sulcus MCP server (36 tools):

| Category | Tools | What They Do |
|----------|-------|--------------|
| **Memory** | `record_memory`, `search_memory`, `forget_memory` | Store, search, and delete memories |
| **Heat** | `memory_boost`, `memory_deprecate`, `list_hot_nodes` | Adjust importance and see active memories |
| **Context** | `build_context` | Get a budget-constrained context block |
| **Triggers** | `create_trigger`, `list_triggers`, `delete_trigger` | Reactive rules that fire on memory events |
| **Graph** | `memory_relate`, `memory_reclassify`, `graph_traverse` | Manage relationships between memories |
| **Config** | `configure_thermodynamics`, `get_status` | View and adjust decay settings |
| **Sync** | `export_memories`, `import_memories` | Bulk memory management |

---

## Memory Types

| Type | Decay Rate | Best For |
|------|-----------|----------|
| `episodic` | Fast | Events, session logs, what happened |
| `semantic` | Slow | Knowledge, concepts, learned facts |
| `preference` | Slower | User preferences, style, opinions |
| `procedural` | Slowest | How-tos, workflows, step-by-step processes |
| `fact` | Slow | Stable data, configurations, IDs |

---

## Troubleshooting

**Memories not injecting at session start**  
→ Check `SULCUS_API_KEY` is set: `echo $SULCUS_API_KEY`  
→ Check server is reachable: `curl $SULCUS_SERVER_URL/api/v1/status`

**Memory writes being blocked**  
→ Expected for `.sulcus/`, `MEMORY.md`, or `memory/` paths. Use MCP tools instead.

**No relevant memories on prompt**  
→ Your memory graph may be empty. Store some memories first via `record_memory`.

**Hook scripts not running**  
→ Re-run: `chmod +x hooks-handlers/*.sh`

---

## Changelog

### v2.1.0
- Multi-signal recall in `on-user-prompt.sh` (semantic + hot-context + entity-context)
- SIRU recall session logging for adaptive weight training
- SIRU weight status shown at session start
- Fixed API endpoint: uses `/api/v1/agent/nodes` (not `/api/v1/agent/memory`)
- Consolidated `sulcus_store` helper in `_sulcus-lib.sh`
- Simplified all store hooks to use shared helper

### v2.0.0
- Initial Claude Code hooks plugin with 7 lifecycle hooks
- Cloud and local mode support
- Memory file write protection

---

## License

MIT — [Digital Forge Studios](https://dforge.ca)
