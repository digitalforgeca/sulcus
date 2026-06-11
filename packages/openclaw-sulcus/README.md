# openclaw-sulcus

Thermodynamic memory for [OpenClaw](https://openclaw.ai) agents. Every memory is scored, classified, graph-linked, and subject to decay — your agent remembers what matters and forgets what doesn't.

## What Makes Sulcus Different

**Context Engine** — Sulcus doesn't just store memories, it manages your agent's entire context window. The v7.2.0 Context Engine owns compaction, prevents overflow, and builds context constructively from memory rather than patching transcripts.

**Reactive Triggers** — Rules that fire on memory events (`on_store`, `on_recall`, `on_boost`, `on_decay`). Actions include notify, boost, pin, tag, deprecate, webhook, and chain. Your agent can react to its own memory changes.

**Thermodynamic Decay** — Memories have heat. Frequently accessed memories stay hot; ignored ones cool and eventually fall out of context. Three modes: time-only, interaction-only, or hybrid (default).

## Install

```bash
openclaw skill install @digitalforgestudios/openclaw-sulcus
```

## Quick Start

Add to your OpenClaw config (`openclaw.json`):

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-sulcus"
    },
    "entries": {
      "openclaw-sulcus": {
        "enabled": true,
        "config": {
          "serverUrl": "https://api.sulcus.ca",
          "apiKey": "sk-YOUR_KEY_HERE",
          "agentId": "my-agent",
          "namespace": "my-agent",
          "autoRecall": true,
          "autoCapture": true
        }
      }
    }
  }
}
```

Restart: `openclaw gateway restart`

**No API key?** The plugin works in local-only mode without cloud sync. Get a key at [sulcus.ca](https://sulcus.ca) → Dashboard → API Keys.

## Features

### Context Engine (v7.0+)

The Context Engine registers as an OpenClaw context provider with `ownsCompaction: true`, giving Sulcus full control over how your agent's context window is managed.

- **Constructive assembly** — Builds context as a constructed view, not a patched log. Recent turns render at full fidelity; older turns use SILU-generated pointer summaries.
- **Overflow prevention** — Emergency brake at 90% budget, cumulative pressure tracking, adaptive compaction intervals based on growth rate.
- **Working memory cache** — Per-session cache of tool results with automatic Sulcus ingestion. Large results are stored in memory and replaced with pointers.
- **Session knowledge extraction** — Automatically identifies and captures decisions, file paths, commands, and intents from the conversation.
- **26 configurable thresholds** — Every ratio, char limit, and interval is tunable. No hardcoded magic numbers.

### SIU v2 Pipeline

Every `memory_store` fires the full pipeline automatically:

1. **SIVU** — Utility scoring. Quality gate that accepts or rejects content. ONNX inference, <1ms.
2. **SICU** — Type classification. Auto-classifies into memory types. ONNX inference, <1ms.
3. **SILU** — Entity extraction + graph relationships. LLM-powered, async.
4. **AGE graph** — Apache AGE knowledge graph updated with entities and edges.
5. **Triggers** — Reactive trigger rules evaluated against the event.

### Multi-Signal Recall

Recall combines multiple signals for relevance ranking:

- Semantic similarity (vector search)
- Full-text search with phrase proximity
- Thermodynamic heat (access-based decay)
- Knowledge graph neighbors (entity context)
- Temporal recency with type-aware half-lives
- Proper noun and keyword overlap boosts
- Confidence weighting and conflict detection

### SIRU — Adaptive Scoring

The Sulcus Intelligent Recall Unit learns your agent's recall patterns. After 20+ sessions, SIRU training optimizes scoring weights per namespace. Falls back to heuristic defaults until trained.

### Reactive Triggers

Rules that fire on memory events:

- **Events:** `on_store`, `on_recall`, `on_boost`, `on_decay`
- **Actions:** notify, boost, pin, tag, deprecate, webhook, chain
- **SITU training:** Feedback loop improves trigger accuracy over time

### Local-First Architecture (v7.2.0+)

- **SulcusLocalClient** — HTTP client for a localhost sidecar with health tracking
- **RetryQueue** — Bounded in-memory retry buffer for failed remote writes
- **Dual-write** — Local-first on store, fire-and-forget sync to cloud
- **Local-first recall** — Sidecar is the fast path, cloud is the fallback

## Tools

| Tool | Description |
|---|---|
| `memory_store` | Store a memory. SIU pipeline fires automatically. |
| `memory_recall` | Multi-signal semantic search with relevance scoring. |
| `memory_status` | Backend status, namespace info, hot nodes, decay mode. |
| `memory_delete` | Delete a memory by ID. Optionally trains SIVU rejection. |
| `consolidate` | Merge and prune cold memories below a heat threshold. |
| `export_markdown` | Export all memories as Markdown. |
| `import_markdown` | Import memories from Markdown. |
| `evaluate_triggers` | Evaluate reactive triggers against an event. |
| `trigger_feedback` | Submit feedback to improve trigger accuracy. |

## Memory Types

| Type | Decay Rate | Use For |
|---|---|---|
| `episodic` | Fast | Events, sessions, one-off observations |
| `semantic` | Slow | Concepts, relationships, domain knowledge |
| `preference` | Slower | User preferences, opinions, style choices |
| `fact` | Slow | Stable factual knowledge |
| `procedural` | Slowest | How-tos, processes, workflows |

## Configuration

| Option | Default | Description |
|---|---|---|
| `serverUrl` | — | Sulcus cloud URL (e.g. `https://api.sulcus.ca`) |
| `apiKey` | — | Sulcus API key |
| `agentId` | — | Agent identifier |
| `namespace` | `agentId` | Memory namespace |
| `autoRecall` | `false` | Inject relevant memories before each turn |
| `autoCapture` | `false` | Auto-store important conversation content |
| `maxRecallResults` | `5` | Max memories injected per turn |
| `minRecallScore` | `0.3` | Min relevance score for auto-recall (0–1) |
| `boostOnRecall` | `true` | Heat boost on recall (spaced repetition) |
| `captureOnCompaction` | `true` | Preserve memories before compaction |
| `captureOnReset` | `true` | Capture session summary on `/reset` |
| `captureFromAssistant` | `false` | Capture from assistant messages |
| `maxCapturePerTurn` | `3` | Max auto-captures per turn |
| `tokenBudget` | `10000` | Token budget for context injection |
| `maxRecallChars` | `2000` | Max chars per recalled memory |

### Context Engine Config

```json
{
  "contextEngine": {
    "compactMode": "smart",
    "thresholds": {
      "compactionTriggerRatio": 0.75,
      "trimTriggerRatio": 0.65,
      "largeResultChars": 3000,
      "emergencyBrakeRatio": 0.90,
      "emergencyHeadChars": 250,
      "emergencyTailChars": 250,
      "cumulativePressureChars": 50000,
      "highGrowthTokensPerTurn": 10000
    }
  }
}
```

## Hooks

| Hook | Description |
|---|---|
| `before_prompt_build` | Injects memory awareness + hot context |
| `before_agent_start` | Auto-recall relevant memories for the turn |
| `agent_end` | Post-turn capture, triggers, knowledge extraction |
| `build_context` | Context Engine assembly (when ownsCompaction enabled) |
| `on_compaction` | Memory preservation before context compaction |
| `on_reset` | Session summary capture |

## Links

- **Website:** [sulcus.ca](https://sulcus.ca)
- **npm:** [@digitalforgestudios/openclaw-sulcus](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus)
- **GitHub:** [digitalforgeca/sulcus](https://github.com/digitalforgeca/sulcus)
- **OpenClaw:** [openclaw.ai](https://openclaw.ai)

## License

MIT — [Digital Forge Studios Inc.](https://dforge.ca)
