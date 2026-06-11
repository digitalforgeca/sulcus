# Sulcus Plugin for Claude Code

Persistent, thermodynamic memory for Claude Code - decisions, patterns, and learnings survive across sessions.

Near feature-parity with the OpenClaw plugin (`@digitalforgestudios/openclaw-sulcus@6.6.6`) for the complete memory lifecycle: recall → inject → capture → persist.

## What It Does

| Lifecycle Event | What Happens |
|---|---|
| **SessionStart** | Searches Sulcus for project context, hot memories, status, and agent profile (preferences + facts). Resets topic cache and context-window estimator. |
| **UserPromptSubmit** | Full recall pipeline: vector search → graph-hop expansion → diversity filter → temporal supersession → guardrails (PII redaction + preference check) → topic-shift caching → context-window throttling → token budget → SIRU logging → auto-capture of user messages via SIU v2. |
| **PreToolUse** | Blocks writes to `MEMORY.md` and file-based memory. Redirects to Sulcus MCP tools. |
| **PostToolUse** | Tracks files modified and notable commands for session state capture. |
| **PreCompact** | Before context compaction, captures a comprehensive session summary to Sulcus (both direct API and Claude-driven via MCP). Resets context-window estimator. |
| **TaskCompleted** | After a task completes, prompts Claude to extract and store key learnings. |
| **Stop** | On session end, extracts signal content (decisions, architecture, bugs) from transcript and stores them. Purges session-scoped ephemeral memories. Prompts Claude to save any unstored learnings. |

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

## MCP Tools (19 available)

The plugin connects to the Sulcus MCP server, giving Claude access to:

| Category | Tools |
|---|---|
| **Core Memory** | `sulcus_remember`, `sulcus_search`, `sulcus_list`, `sulcus_forget`, `sulcus_update` |
| **Heat (Thermodynamics)** | `sulcus_boost`, `sulcus_deprecate`, `sulcus_hot_nodes` |
| **Context Assembly** | `sulcus_build_context`, `sulcus_auto_recall`, `sulcus_auto_capture` |
| **Knowledge Graph** | `sulcus_relate`, `sulcus_graph_traverse` |
| **Reactive Triggers** | `sulcus_create_trigger`, `sulcus_list_triggers`, `sulcus_delete_trigger` |
| **Intelligence** | `sulcus_classify`, `sulcus_scan_pii` |
| **Status** | `sulcus_status` |

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
  Project search    Vector search           Capture summary
  + Hot nodes       + Graph-hop expand      + Reset throttle
  + Status          + Diversity filter
  + Profile inject  + Temporal supersession
  + Cache reset     + PII redaction
                    + Pref guard
                    + Topic-shift cache
                    + Context throttle
                    + Token budget
                    + SIRU recall log
                    + Auto-capture (SIU v2)
      │                     │                       │
      └─────────────────────┼──────────────────────┘
                            │
                     Sulcus Server (API + MCP)
                     ┌──────┴──────┐
                     │  pgvector   │
                     │  AGE graph  │
                     │  SIU gate   │
                     │  SIRU learn │
                     │  Triggers   │
                     └─────────────┘
```

## Recall Pipeline Detail

The `UserPromptSubmit` hook runs a multi-stage recall pipeline:

1. **Vector search** - semantic search against Sulcus (limit 10, score > 0.35)
2. **Graph-hop expansion** - seed top-2 results into graph neighbor lookup, fold warm (heat ≥ 0.2) nodes, take top 4
3. **Diversity filter** - Jaccard overlap > 0.6 removes near-duplicates
4. **Temporal supersession** - overlapping memories where a newer one corrects/replaces an older one get a 50% heat penalty
5. **Guardrails** - PII redaction (email, phone, SSN, CC, DOB) + preference violation detection
6. **Topic-shift cache** - Jaccard overlap on topic tokens; skip API call if topic is stable (0.25 threshold, 5min TTL)
7. **Temporal re-ranking** - for time-based queries ("yesterday", "last week"), re-sort chronologically
8. **Context-window throttling** - scales budget by estimated context fill (normal/reduced/muted/silent at 60/80/90%)
9. **Token budget** - greedy packing within configurable budget (default 4000 tokens)
10. **SIRU recall logging** - fire-and-forget POST of recall metadata for server-side learning
11. **Auto-capture** - user message classified by SIU v2; stored if quality gate passes

## Configuration

Environment variables (all optional except `SULCUS_API_KEY`):

| Variable | Default | Description |
|---|---|---|
| `SULCUS_API_KEY` | — | API key (required) |
| `SULCUS_SERVER_URL` | `https://api.sulcus.ca` | Server URL |
| `SULCUS_NAMESPACE` | `$USER` | Memory namespace |
| `SULCUS_CONTEXT_WINDOW` | `200000` | Estimated context window size (tokens) |
| `SULCUS_THROTTLE_ENABLED` | `true` | Enable context-window throttling |

## What Makes Sulcus Different

- **36 MCP tools** — 4x more than Mem0, full graph/trigger/thermodynamic control
- **Knowledge Graph** — memories aren’t just vectors; they’re connected through semantic relationships
- **Graph-hop recall** — vector search is just the start; neighbors expand the recall set
- **Reactive Triggers** — programmable rules that fire on memory events (no competitor has this)
- **SIU Quality Gating** — machine-learned quality filter prevents noise from entering the graph
- **Thermodynamic Decay** — memories naturally cool over time; important ones are boosted by use
- **Temporal awareness** — supersession detection penalizes outdated info; chronological re-ranking for time queries
- **Guardrails** — PII redaction before injection, preference violation detection
- **Signal Extraction** — only captures high-signal turns (decisions, architecture, bugs), not noise
- **Context-aware throttling** — automatically scales recall injection as context window fills

## Library Modules

| Module | Purpose |
|---|---|
| `sulcus-client.cjs` | Zero-dependency REST API client (search, store, graph, classify, recall-log, session memory) |
| `capture-utils.cjs` | Junk filter, dedup tracker, correction detection for auto-capture |
| `context-throttle.cjs` | Context-window usage estimator with 4-level throttling |
| `diversity-filter.cjs` | Jaccard overlap dedup for recall results |
| `guardrails.cjs` | PII regex detection/redaction + preference violation checking |
| `temporal.cjs` | Temporal query detection, chronological re-ranking, supersession |
| `topic-cache.cjs` | Jaccard overlap topic-shift detection with file-based persistence |
| `transcript.cjs` | JSONL transcript parser with signal keyword extraction |
| `stdin.cjs` | JSON stdin/stdout IO for Claude Code hook protocol |

## Requirements

- Node.js 18+
- Sulcus API key ([sulcus.ca](https://sulcus.ca))
- Claude Code with plugin support

## License

Apache-2.0
