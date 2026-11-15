# Sulcus AGY Plugin

[![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Antigravity%20AGY-cyan.svg)](https://github.com/digitalforgeca/sulcus)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU%20%2B%20VCR-cyan.svg)](https://sulcus.ca)

Pure-Rust persistent thermodynamic memory, System 1 (`VCR`) curation, AST Personalized PageRank, and bidirectional `/learn` promotion for Antigravity (`agy`).

---

## Core Capabilities

### Strict AGY v1.5.8+ Pure-Rust Hook Engine (`<15ms`)
Validates with zero warnings or notes under `agy plugin validate --strict --json`, routing Antigravity's **6 native lifecycle events** (`SessionStart`, `PreInvocation`, `PostInvocation`, `Stop`, `PreToolUse`, `PostToolUse`) with bounded per-handler timeouts and anchored `~/.sulcus/models/fastembed` model caching.

### `lastUserInput` Fast-Path & Multi-Facet Hydration
Uses `lastUserInput` in $O(1)$ on standard turns (ignoring `/task-` background task logs and `TOOL_RESPONSE` headers), fusing multi-facet RRF (`k = 60`), and injecting `<sulcus-memories>` + local AST Personalized PageRank anchors via `injectSteps[].systemMessage`.

### `PreInvocation` Compaction Detection & Error-to-Resolution Pairing
Detects AGY context compaction automatically via `initialNumSteps` regressions and `<CONTEXT_SUMMARY>` BLAKE3 digests (resetting `surfaced_context.json` and archiving compaction summaries), while `PostToolUse` captures tool step `"error"` payloads and pairs retries that succeed into `[learn:candidate]` error-resolution memories.

### Bidirectional `/learn` × Sulcus Promotion Loop
Automatically injects `<sulcus-learn-candidates>` on `/learn` invocations (filtered against existing `AGENTS.md`, `GEMINI.md`, and `.agents/rules/*.md` files), reconciles promoted rules (`[promoted:rule]`) on `PostToolUse`, and auto-indexes newly authored `SKILL.md` files into Sulcus Dynamic Skills VMMU (`skills_index`).

---

## Lifecycle Hooks (6 Verified AGY Events)

| Hook Stage | Native Handler | Timeout | Execution Objective |
| --- | --- | --- | --- |
| `SessionStart` | `sulcus hook --harness agy SessionStart` | `5s` | Background daemon ensure & workspace hot-node priming |
| `PreInvocation` | `sulcus hook --harness agy PreInvocation` | `5s` | Compaction detection, multi-facet RRF recall, AST PPR & `/learn` candidate hydration |
| `PostInvocation` | `sulcus hook --harness agy PostInvocation` | `5s` | Extract durable System 1 VCR turns & optional `user_markdown` UI badge |
| `Stop` | `sulcus hook --harness agy Stop` | `5s` | Flush final turns when `!continuationActive && fullyIdle` |
| `PreToolUse` | `sulcus hook --harness agy PreToolUse` | `2s` | Read-only fast skip & `0700` pre-mutation file snapshot for surgical undo |
| `PostToolUse` | `sulcus hook --harness agy PostToolUse` | `5s` | Activity Ledger SHA-256 diff, `.error` -> fix pairing & `/learn` rule/skill reconciliation |

---

## Installation & Self-Repair

```bash
sulcus connect agy
sulcus doctor --fix
sulcus learn
```
