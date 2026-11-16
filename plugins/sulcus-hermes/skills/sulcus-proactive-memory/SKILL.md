---
name: sulcus-proactive-memory
description: "Proactive Sulcus memory workflow for Hermes Agent."
version: 0.1.1
author: Digital Forge, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [sulcus, memory, proactive, hybrid]
    related_skills: [hermes-agent]
---

# Proactive Memory Skill

This skill documents the proactive memory workflow provided by the `sulcus-hermes` plugin. The plugin operates automatically via Hermes lifecycle hooks (`pre_llm_call`, `post_llm_call`, `on_session_start`, `on_session_end`, `on_session_finalize`, `pre_auxiliary_call`, `post_auxiliary_call`) — no manual invocation required.

## Lifecycle Hooks

The plugin registers the following Hermes lifecycle hooks:

### Proactive Recall
Fires on `pre_llm_call` before every LLM call. Queries Sulcus with the user's prompt and injects delta-only `<sulcus-memories>` context blocks.

**Behavior:**
- Only triggers when `auto_recall: true` (default) and local daemon or API key is configured
- Uses session delta tracking (`_surfaced_ids_by_session`) to avoid re-injecting duplicate pointers
- Respects token budget (`token_budget` config, default 4000 tokens)

### Proactive Capture
Fires on `post_llm_call` after every LLM response. Forwards high-signal assistant output to the System 1 VCR ingestion pipeline (`/api/v1/agent/ingest`).

**Behavior:**
- Only triggers when `auto_capture: true` (default) and local daemon or API key is configured
- Skips generic acknowledgments and short responses
- Evaluates and classifies via System 1 VCR across `preference`, `fact`, `semantic`, `procedural`, and `episodic` memory types

### Session Initialization
Fires on `on_session_start` (startup/resume/compact). Sets up context boundaries.

### Session Cleanup
Fires on `on_session_end`. Purges session-scoped ephemeral memories.

### Compaction Detection
Fires on `on_session_finalize` and `pre_auxiliary_call`. Detects context compaction auxiliary tasks, resets `_surfaced_ids_by_session`, and signals pre-compaction capture.

### Compaction Rebuild
Fires on `post_auxiliary_call` after compaction completes, recalling and boosting salient memories to rebuild working context.

## Configuration

Set in `~/.hermes/config.yaml` under `plugins.entries.sulcus-hermes.config`, `~/.config/sulcus/sulcus.ini`, or via environment:

| Setting | Env Var | Default | Description |
|---------|---------|---------|-------------|
| `sulcus_server_url` | `SULCUS_SERVER_URL` | `https://api.sulcus.ca` | Sulcus API URL |
| `sulcus_api_key` | `SULCUS_API_KEY` | *(optional in local mode)* | API key for cloud/hybrid sync |
| `namespace` | `SULCUS_NAMESPACE` | `default` | Memory namespace |
| `token_budget` | `SULCUS_TOKEN_BUDGET` | `4000` | Recall token budget |
| `auto_recall` | `SULCUS_AUTO_RECALL` | `true` | Enable proactive recall |
| `auto_capture` | `SULCUS_AUTO_CAPTURE` | `true` | Enable proactive capture |
| `hybrid_mode` | `SULCUS_HYBRID_MODE` | `true` | Use local `sulcus` daemon + cloud API |

## Hybrid Mode

When `hybrid_mode: true` (default), the plugin:
1. Prefers the local `sulcus` binary (`~/.sulcus/bin/sulcus`, `~/.cargo/bin/sulcus`, `/opt/homebrew/bin/sulcus`, or `/usr/local/bin/sulcus`) and local sidecar (`127.0.0.1:4203`)
2. Queries and syncs with `SULCUS_SERVER_URL` when `SULCUS_API_KEY` is configured

Local mode provides sub-millisecond recall/store; cloud mode adds cross-workstation synchronization and semantic knowledge graphs powered by System 1 (`VCR`).
