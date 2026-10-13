---
name: sulcus-proactive-memory
description: "Proactive Sulcus memory workflow for Hermes Agent."
version: 0.1.0
author: Dooley (mcdoolz), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [sulcus, memory, proactive, hybrid]
    related_skills: [hermes-agent]
---

# Sulcus Proactive Memory Skill

This skill documents the proactive memory workflow provided by the `sulcus-hermes` plugin. The plugin operates automatically via Hermes hooks — no manual invocation required.

## How It Works

The plugin registers the following Hermes lifecycle hooks:

### 1. `pre_llm_call` — Proactive Recall
Fires before every LLM call. Queries Sulcus with the user's prompt and injects relevant memories as `<sulcus-recall>` context block.

**Behavior:**
- Only triggers when `auto_recall: true` (default) and API key configured
- Uses topic-shift caching to avoid redundant API calls
- Respects token budget (`token_budget` config, default 4000 tokens)
- Filters by relevance score (> 0.3) and heat (> 0.2)

### 2. `post_llm_call` — Proactive Capture
Fires after every LLM response. Captures high-signal assistant output via SIU quality gate.

**Behavior:**
- Only triggers when `auto_capture: true` (default) and API key configured
- Skips generic acknowledgments and short responses
- Classifies via Sulcus SIU v2 (`/api/v2/siu/label`) for memory type
- Stores with metadata: `source: post-llm-hook`, `siu_classified: true`

### 3. `on_session_start` — Session Initialization
Fires on session startup/resume/compact. Sets up context boundaries.

### 4. `on_session_end` — Session Cleanup
Fires on session end. Purges session-scoped memories (ephemeral scratch-pad).

### 5. `on_session_finalize` / `pre_auxiliary_call` — Compaction Detection
Detects context compaction auxiliary tasks and signals pre-compaction capture.

### 6. `post_auxiliary_call` — Post-Compaction Rebuild
After compaction completes, recalls relevant memories to rebuild working context.

## Configuration

Set in `~/.hermes/config.yaml` under `plugins.entries.sulcus-hermes.config` or via environment:

| Setting | Env Var | Default | Description |
|---------|---------|---------|-------------|
| `sulcus_server_url` | `SULCUS_SERVER_URL` | `https://api.sulcus.ca` | Sulcus server URL |
| `sulcus_api_key` | `SULCUS_API_KEY` | *(required)* | API key for hybrid mode |
| `namespace` | `SULCUS_NAMESPACE` | `hermes-default` | Memory namespace |
| `token_budget` | — | `4000` | Recall token budget |
| `auto_recall` | — | `true` | Enable proactive recall |
| `auto_capture` | — | `true` | Enable proactive capture |
| `hybrid_mode` | — | `true` | Use local sulcus binary + remote |

## CLI Commands

The plugin registers a `hermes sulcus` command:

```bash
# Recall memories
hermes sulcus recall "deployment issues"

# Store a memory manually
hermes sulcus store "User prefers dark mode"

# Check Sulcus status
hermes sulcus status

# Search memories
hermes sulcus search "API keys"

# Boost memory heat
hermes sulcus boost <memory-id>
```

## Hybrid Mode

When `hybrid_mode: true` (default), the plugin:
1. Prefers local `sulcus` binary if found at `~/dev/sulcus/target/release/sulcus` or `~/.cargo/bin/sulcus`
2. Falls back to REST API calls to `SULCUS_SERVER_URL`
3. Uses `SULCUS_API_KEY` for authentication in both modes

Local binary provides lower latency for recall/store; remote provides full SIU pipeline (SIVU/SICU/SILU) and graph features.

## Verification

- Check plugin loaded: `hermes plugins list` should show `sulcus-hermes`
- Watch logs for `[Sulcus] Plugin loaded:` on startup
- Recall injection appears as `<sulcus-recall>` block in context
- Memories stored visible via `hermes sulcus recall ""` or Sulcus dashboard

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No recall injection | Verify `SULCUS_API_KEY` in `.env` and `auto_recall: true` |
| No capture | Verify `auto_capture: true`; check SIU service availability |
| Local binary not found | Install sulcus locally or set `hybrid_mode: false` |
| Context too large | Reduce `token_budget` or disable `auto_recall` |