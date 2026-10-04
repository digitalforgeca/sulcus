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

### MemPalace Recall Pipeline (v7.3.0+)

Sulcus uses a two-stage recall architecture inspired by biological memory consolidation:

**Stage 1 — Server retrieval:** Vector search (pgvector HNSW) with heat weighting and Ebbinghaus effective strength computation. Each hit potentiates the memory's Hebbian strength, making frequently retrieved memories progressively more prominent.

**Stage 2 — Client reranking:** The plugin applies a multi-stage pipeline to the server's response:

| Stage | Algorithm | Key Parameter |
|---|---|---|
| BM25 + Vector Fusion | Okapi BM25 over labels fused with cosine similarity | 0.6 vector / 0.4 BM25 |
| Deduplication | Jaccard token-overlap proxy (cosine dedup) | threshold 0.85 |
| Hebbian Blending | Blend Ebbinghaus `effective_strength` into heat score | 0.7 hybrid / 0.3 strength |
| Credential Boost | Service-aware promotion for credential memories | +0.20 unpinned / +0.30 pinned |
| Topic-Shift Guard | BM25-based cache invalidation between turns | relevance threshold 0.20 |
| Staleness Filter | Drop memories below heat threshold from context | heat < 0.10 |

The result: your agent sees memories ranked by a blend of **what's semantically relevant**, **what matches lexically**, and **what it actually uses** — not just recency.

### Multi-Signal Recall

Beyond the MemPalace pipeline, recall combines multiple server-side signals:

- Semantic similarity (vector search, BGE-small-en-v1.5)
- Full-text search with phrase proximity
- Thermodynamic heat (access-based decay)
- Knowledge graph neighbors (AGE entity context)
- Temporal recency with type-aware half-lives
- Hebbian potentiation (strength grows with use)
- Ebbinghaus decay (effective_strength models forgetting)
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

## MemPalace Tuning Reference

All MemPalace thresholds are named constants in `src/recall-ranking.ts`. Defaults are calibrated for general-purpose agents; adjust for specialized use cases.

### BM25 Parameters

| Constant | Default | Description |
|---|---|---|
| `BM25_K1` | `1.5` | Term frequency saturation. Lower = faster saturation (good for short labels). |
| `BM25_B` | `0.75` | Length normalization. `0` = no normalization, `1` = full normalization. |
| `HYBRID_VECTOR_WEIGHT` | `0.6` | Weight for semantic (vector) score in hybrid fusion. |
| `HYBRID_BM25_WEIGHT` | `0.4` | Weight for lexical (BM25) score in hybrid fusion. Must sum to 1.0 with vector weight. |

### Deduplication

| Constant | Default | Description |
|---|---|---|
| `COSINE_DEDUP_THRESHOLD` | `0.85` | Jaccard overlap above this → duplicate (later item dropped). Raise to be more aggressive (remove more). |

### Hebbian Strength Blending

| Constant | Default | Description |
|---|---|---|
| `HEBBIAN_HYBRID_WEIGHT` | `0.7` | Weight for BM25+vector hybrid score in final blend. |
| `HEBBIAN_STRENGTH_WEIGHT` | `0.3` | Weight for Ebbinghaus effective_strength in final blend. |
| `HEBBIAN_STRENGTH_MAX` | `5.0` | Server potentiation ceiling — normalizes effective_strength to [0, 1]. |

### Topic-Shift and Staleness

| Constant | Default | Description |
|---|---|---|
| `BM25_TOPIC_RELEVANCE_THRESHOLD` | `0.20` | BM25 max score below this → topic shifted, refresh cache. Raise to cache more aggressively. |
| `STALE_HEAT_THRESHOLD` | `0.10` | Memories with heat below this are omitted from context injection. |

### Credential Boost

Boost applies automatically when the query contains a recognized service name AND the memory matches a credential pattern. The 40+ recognized services include: `github`, `npm`, `docker`, `azure`, `aws`, `gcp`, `openai`, `anthropic`, `elevenlabs`, `tailscale`, `postgres`, `redis`, `discord`, `stripe`, and more.

| Condition | Boost |
|---|---|
| Pinned credential memory | `+0.30` |
| Unpinned credential memory | `+0.20` |

## Links

- **Website:** [sulcus.ca](https://sulcus.ca)
- **npm:** [@digitalforgestudios/openclaw-sulcus](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus)
- **GitHub:** [digitalforgeca/sulcus](https://github.com/digitalforgeca/sulcus)
- **OpenClaw:** [openclaw.ai](https://openclaw.ai)

## License

MIT — [Digital Forge Studios Inc.](https://dforge.ca)
