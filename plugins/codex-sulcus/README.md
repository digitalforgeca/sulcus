# Sulcus Memory Plugin for Codex CLI

**Author:** [Digital Forge Studios](https://sulcus.ca)  
**License:** MIT  
**Version:** 1.0.0  
**Links:** [sulcus.ca](https://sulcus.ca) · [GitHub](https://github.com/digitalforgeca/sulcus)

---

Give Codex CLI persistent, cross-session memory powered by [Sulcus](https://sulcus.ca) — thermodynamic memory with heat-based decay, a knowledge graph, semantic search, reactive triggers, and adaptive recall via SIRU.

## What It Does

This plugin connects Codex to Sulcus via MCP, giving it:

- **36+ MCP tools** for storing, searching, graphing, and managing memories
- **Multi-signal recall** (semantic search + hot-context + entity-context)
- **Thermodynamic decay** — memories naturally cool over time, keeping context fresh
- **Knowledge graph** — entities are linked across memories for richer recall
- **SIRU adaptive scoring** — recall weights learn from your usage patterns
- **Skill protocol** — Codex knows when and how to use memory automatically

## Installation

```bash
# From the Sulcus repo
codex plugin install /path/to/sulcus/plugins/codex-sulcus

# Or from Git
codex plugin install https://github.com/digitalforgeca/sulcus
```

### Verify

```bash
codex plugin list
# codex-sulcus  v1.0.0  enabled
```

## Environment Variables

```bash
export SULCUS_SERVER_URL="https://api.sulcus.ca"  # or your self-hosted URL
export SULCUS_API_KEY="your-api-key"
```

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SULCUS_SERVER_URL` | `https://api.sulcus.ca` | No | Sulcus server base URL |
| `SULCUS_API_KEY` | — | Yes (cloud) | Your Sulcus API key |

If `SULCUS_API_KEY` is not set but the `sulcus` binary is available locally, the plugin uses local mode. If neither is available, tools will return configuration warnings.

### Get an API Key

1. Visit [sulcus.ca](https://sulcus.ca)
2. Create a free account
3. Generate an API key from your dashboard

## MCP Tools

The plugin connects Codex to the full Sulcus MCP server:

| Category | Tools | What They Do |
|----------|-------|--------------|
| **Memory** | `record_memory`, `search_memory`, `forget_memory` | Store, search, and delete memories |
| **Heat** | `memory_boost`, `memory_deprecate`, `list_hot_nodes` | Adjust importance and see active memories |
| **Context** | `build_context` | Get a budget-constrained context block |
| **Triggers** | `create_trigger`, `list_triggers`, `delete_trigger` | Reactive rules that fire on memory events |
| **Graph** | `memory_relate`, `memory_reclassify`, `graph_traverse` | Manage relationships between memories |
| **Config** | `configure_thermodynamics`, `get_status` | View and adjust decay settings |
| **Sync** | `export_memories`, `import_memories` | Bulk memory management |

## Memory Types

| Type | Decay Rate | Best For |
|------|-----------|----------|
| `episodic` | Fast | Events, session logs, what happened |
| `semantic` | Slow | Knowledge, concepts, learned facts |
| `preference` | Slower | User preferences, style, opinions |
| `procedural` | Slowest | How-tos, workflows, step-by-step processes |
| `fact` | Slow | Stable data, configurations, IDs |

## What Makes Sulcus Different

- **Thermodynamic decay** — memories fade naturally over time. No manual cleanup needed. Pin important memories to prevent decay.
- **Knowledge graph** — Apache AGE graph connects entities across memories. Ask about a person and get everything related.
- **Reactive triggers** — fire custom actions when memory conditions are met (e.g., "alert me if a memory about X is stored").
- **Adaptive recall** — SIRU learns which memories are most useful over time and optimizes scoring weights.
- **Quality gate** — SIVU/SICU auto-classify and filter memories before storage. No junk accumulation.

## License

MIT — [Digital Forge Studios](https://sulcus.ca)
