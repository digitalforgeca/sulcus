# Sulcus Memory Plugin for Claude Code

**Author:** [Digital Forge Studios](https://dforge.ca)  
**License:** MIT  
**Links:** [sulcus.ca](https://sulcus.ca) · [GitHub](https://github.com/digitalforgeca/sulcus)

---

Give Claude Code persistent, cross-session memory powered by [Sulcus](https://sulcus.ca) — thermodynamic memory with heat-based decay, semantic search, and reactive triggers.

## What It Does

This plugin wires seven Claude Code lifecycle hooks into Sulcus, giving Claude:

- **Automatic context recall** on every session start and every user prompt
- **Protection** against accidentally overwriting memory files directly
- **Auto-capture** of file changes, task completions, and session lifecycle events
- **Compaction awareness** so memory continuity survives context window resets
- **36 MCP tools** for full programmatic control of your memory graph

---

## Hooks

| Hook | Script | Description |
|------|--------|-------------|
| `SessionStart` | `session-start.sh` | Fetches your hottest memories and injects them as context at the start of every session. Claude knows your history, preferences, and active work automatically. |
| `UserPromptSubmit` | `on-user-prompt.sh` | Performs a semantic search on every user prompt and injects the top 5 relevant memories. Targeted recall without manual `/search`. |
| `PreToolUse` | `block-memory-write.sh` | Blocks direct file writes to `.sulcus/`, `MEMORY.md`, or `memory/` paths. Memory must be managed through Sulcus MCP tools, not raw file edits. |
| `PostToolUse` | `post-tool-use.sh` | Records file paths modified by Write/Edit/Bash tools as episodic memories. Future sessions know what was built without storing file contents. |
| `PreCompact` | `on-pre-compact.sh` | Stores an episodic marker before context compaction so future sessions know a truncation event occurred. |
| `TaskCompleted` | `on-task-completed.sh` | Stores a procedural memory summarizing completed tasks. Builds a persistent log of what was accomplished across sessions. |
| `Stop` | `on-stop.sh` | Stores an episodic marker on session shutdown for timeline reconstruction and heat decay accounting. |

---

## Installation

### Option A: Marketplace (Recommended)

```bash
# Add the Sulcus marketplace (one-time)
claude plugin marketplace add https://github.com/digitalforgeca/sulcus

# Install
claude plugin install claude-sulcus
```

### Option B: Local Path (development)

```bash
claude plugin install /path/to/sulcus/plugins/claude-code-sulcus
```

### Option C: Session-only (testing)

```bash
claude --plugin-dir /path/to/sulcus/plugins/claude-code-sulcus
```

### Verify

```bash
claude plugin list
# claude-sulcus  v2.0.0  enabled
```

---

## Environment Variables

Set these before starting Claude Code:

```bash
export SULCUS_SERVER_URL="https://api.sulcus.ca"  # or your self-hosted URL
export SULCUS_API_KEY="your-api-key"
```

Add to `.zshrc` / `.bashrc` for persistence.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SULCUS_SERVER_URL` | `https://api.sulcus.ca` | No | Sulcus server base URL |
| `SULCUS_API_KEY` | — | Yes | Your Sulcus API key |

If `SULCUS_API_KEY` is not set, hooks exit silently (no errors, no memory). The `SessionStart` hook will show a configuration warning with setup instructions.

### Get an API Key

1. Visit [sulcus.ca](https://sulcus.ca)
2. Create a free account
3. Generate an API key from your dashboard

### Self-Hosted Sulcus

```bash
export SULCUS_SERVER_URL="http://localhost:3040"
export SULCUS_API_KEY="your-local-key"
```

---

## MCP Tools

The plugin connects Claude Code to the full Sulcus MCP server (36 tools). Key categories:

| Category | Tools | What They Do |
|----------|-------|--------------|
| **Memory** | `record_memory`, `search_memory`, `forget_memory` | Store, search, and delete memories |
| **Heat** | `memory_boost`, `memory_deprecate`, `list_hot_nodes` | Adjust importance and see active memories |
| **Context** | `build_context` | Get a budget-constrained context block |
| **Triggers** | `create_trigger`, `list_triggers`, `delete_trigger` | Reactive rules that fire on memory events |
| **Graph** | `memory_relate`, `memory_reclassify`, `graph_traverse` | Manage relationships between memories |
| **Config** | `configure_thermodynamics`, `get_status` | View and adjust decay settings |
| **Sync** | `export_memories`, `import_memories` | Bulk memory management |

Claude can invoke any of these directly using its MCP tool interface.

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
→ Verify plugin is listed: `claude plugin list`

**Memory writes being blocked**  
→ This is expected if Claude tries to write directly to `.sulcus/`, `MEMORY.md`, or `memory/` paths. Use MCP tools (`record_memory`) instead.

**No relevant memories on prompt**  
→ Your memory graph may be empty. Ask Claude to store some memories first via `record_memory`.  
→ Check `SULCUS_API_KEY` is valid and the server is running.

**Hook scripts not running**  
→ Confirm scripts are executable: `ls -la hooks-handlers/`  
→ Re-run: `chmod +x hooks-handlers/*.sh`

**PostToolUse firing too often**  
→ The hook matcher captures `Write|Edit|Bash`, but `post-tool-use.sh` filters internally — only writes with a resolved file path are stored. Bash-only tool uses without file output are silently skipped.

---

## License

MIT — [Digital Forge Studios](https://dforge.ca)
