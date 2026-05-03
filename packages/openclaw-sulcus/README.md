# openclaw-sulcus

Thermodynamic memory + Apache AGE knowledge graph for [OpenClaw](https://openclaw.ai) agents.

Sulcus is not a simple memory store. It's a cognitive memory system: every memory is scored, classified, graph-linked, and subject to decay. The SIU v2 pipeline processes every store automatically. A sleep-cycle curator keeps things clean. Reactive triggers fire on memory events.

## What Sulcus Does

- **Apache AGE knowledge graph** — temporal graph over all memories; entities, relationships, and provenance tracked automatically
- **SIU v2 pipeline** — SIVU (utility scoring) → SICU (type classification) → SILU (entity extraction) → AGE graph update → trigger evaluation, fires on every `memory_store`
- **Interaction-based decay** — 3 modes: Time-only, Interaction-only, Hybrid (default). Memories decay based on access patterns, not just wall-clock time. High-utility memories resist decay.
- **Curator (sleep cycle)** — background process that reclassifies, consolidates, summarizes, and re-vectorizes memories. Keeps the graph clean without manual intervention.
- **Relevance-weighted recall** — `score = similarity × 0.7 + heat × 0.3`. Frequently-accessed memories surface faster.
- **Confidence levels + conflict detection** — memories carry a confidence level (`observed`, `inferred`, `asserted`); the system detects contradictory nodes automatically (v2.3.0+).
- **Reactive triggers** — rules that fire on `on_store`, `on_recall`, `on_boost`, `on_decay` events. Actions: notify, boost, pin, tag, deprecate, webhook, chain.
- **Cross-agent sync** — optional cloud sync via `serverUrl`/`apiKey`. Local-first by default.

## Install

```bash
openclaw plugin install @digitalforgestudios/openclaw-sulcus
```

## Configure

Add to `~/.openclaw/openclaw.json`:

```json
"openclaw-sulcus": {
  "enabled": true,
  "config": {
    "apiKey": "sk-YOUR_KEY_HERE",
    "agentId": "my-agent",
    "namespace": "my-agent"
  }
}
```

Restart: `openclaw gateway restart`

**No API key?** Plugin starts in local-only mode (no cloud sync). Get a key at [sulcus.ca](https://sulcus.ca) → Dashboard → API Keys.

## Tools

| Tool | Description |
|---|---|
| `memory_store` | Store a memory. SIU pipeline fires automatically: scored, classified, graph-linked. |
| `memory_recall` | Semantic search with relevance weighting (similarity × 0.7 + heat × 0.3). |
| `memory_status` | Backend status, namespace info, hot nodes, decay mode, curator state. |
| `memory_delete` | Delete a memory by ID. Optionally trains SIVU to reject similar content. |
| `consolidate` | Merge and prune cold memories below a heat threshold. |
| `export_markdown` | Export all memories in current namespace as a Markdown document. |
| `import_markdown` | Import memories from a Markdown document into current namespace. |
| `evaluate_triggers` | Evaluate reactive triggers against an event and context object. |
| `trigger_feedback` | Submit feedback to improve trigger accuracy and SITU scoring. |

## Memory Types & Decay

Choose the right type — decay rates differ significantly:

| Type | Decay Rate | Use For |
|---|---|---|
| `episodic` | Fast | Events, sessions, one-off observations |
| `semantic` | Slow | Concepts, relationships, domain knowledge |
| `preference` | Slower | User preferences, opinions, style |
| `fact` | Slow | Stable factual knowledge |
| `procedural` | Slowest | How-tos, processes, workflows |

## Configuration Reference

| Option | Default | Description |
|---|---|---|
| `serverUrl` | — | Sulcus cloud URL (e.g. `https://api.sulcus.ca`) |
| `apiKey` | — | Sulcus API key (`sk-...`) |
| `agentId` | — | Agent identifier for namespacing |
| `namespace` | same as `agentId` | Memory namespace |
| `autoRecall` | `false` | Inject relevant memories into context before each turn |
| `autoCapture` | `false` | Auto-store important info from conversations |
| `maxRecallResults` | `5` | Max memories injected on auto-recall |
| `minRecallScore` | `0.3` | Min relevance score for auto-recall (0–1) |
| `boostOnRecall` | `true` | Boost heat when a memory is recalled (spaced repetition) |
| `captureOnCompaction` | `true` | Preserve memories before context compaction |
| `captureOnReset` | `true` | Capture session summary on `/reset` |
| `trackSessions` | `false` | Record session start/end as episodic memories |
| `captureFromAssistant` | `false` | Also capture from assistant messages |
| `captureToolResults` | `false` | Capture significant tool results |
| `captureLlmInsights` | `false` | Capture assistant decisions/preferences |
| `maxCapturePerTurn` | `3` | Max auto-captures per agent turn |

## Hooks

| Hook | Default | Description |
|---|---|---|
| `before_prompt_build` | ON | Inject memory awareness context |
| `before_agent_start` | ON | Auto-recall relevant memories |
| `agent_end` | ON | Post-turn processing (capture, triggers) |

## Links

- [sulcus.ca](https://sulcus.ca) — sign up, dashboard, docs
- [npm](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus) — `@digitalforgestudios/openclaw-sulcus`
- [GitHub](https://github.com/digitalforgeca/sulcus) — source, issues

## License

MIT — [Digital Forge Studios Inc.](https://sulcus.ca)
