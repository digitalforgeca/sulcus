# Sulcus Memory Plugin for Codex CLI

**Author:** [Digital Forge Studios](https://sulcus.ca)  
**License:** MIT  
**Version:** 1.0.0  
**Links:** [sulcus.ca](https://sulcus.ca) · [GitHub](https://github.com/digitalforgeca/sulcus)

---

Give Codex CLI persistent, cross-session memory powered by [Sulcus](https://sulcus.ca) — thermodynamic memory with heat-based decay, a knowledge graph, semantic search, reactive triggers, and adaptive recall via SIRU.

## What It Does

This plugin connects Codex to Sulcus via MCP, giving it:

- **19 MCP tools** for storing, searching, graphing, and managing memories
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
export SULCUS_SERVER_URL="https://api.sulcus.ca"
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

The plugin connects Codex to the Sulcus MCP server (19 tools):

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

## What Makes Sulcus Different

- **Thermodynamic decay** — memories fade naturally over time. No manual cleanup needed. Pin important memories to prevent decay.
- **Knowledge graph** — Apache AGE graph connects entities across memories. Ask about a person and get everything related.
- **Reactive triggers** — fire custom actions when memory conditions are met (e.g., "alert me if a memory about X is stored").
- **Adaptive recall** — SIRU learns which memories are most useful over time and optimizes scoring weights.
- **Quality gate** — SIVU/SICU auto-classify and filter memories before storage. No junk accumulation.

## License

MIT — [Digital Forge Studios](https://sulcus.ca)
