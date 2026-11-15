# Sulcus Claude Code Plugin (`v1.2.1`)

[![Version](https://img.shields.io/badge/version-1.2.1-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Claude%20Code-cyan.svg)](https://claude.ai)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Persistent thermodynamic memory knowledge graph, Activity Ledger undo, and proactive context injection sidecar for Claude Code.

---

## Core Features

### Multi-Signal Recall & `/learn` Candidate Surfacing
Semantic recall combines vector similarity, thermodynamic heat ranking, local AST Personalized PageRank, and entity graph expansion on every prompt via `hookSpecificOutput.additionalContext`.

### System 1 (VCR) Auto-Capture & Error-to-Fix Pairing
Evaluates assistant turn completions and tool error -> retry resolutions through the unified Value-Classify-Retrieve (`VCR`) pipeline (`/api/v1/agent/ingest`).

### Context Compaction Awareness & Surgical Undo
`PreCompact` resets surfaced session state and preserves active milestones across token window compaction, while passive `PreToolUse` returns `{}` so Claude Code's native interactive permission prompt is never bypassed.

---

## Pure-Rust Lifecycle Hooks (`sulcus hook --harness claude`)

| Hook Event | Matcher | Timeout | Execution Objective |
| --- | --- | --- | --- |
| `SessionStart` | `startup\|resume\|compact` | `5s` | Prime workspace hot nodes |
| `UserPromptSubmit` | `*` | `5s` | Inject delta `<sulcus-memories>` and `/learn` candidates |
| `PreToolUse` | `Write\|Edit\|MultiEdit` | `2s` | Snapshot pre-mutation state for surgical undo |
| `PostToolUse` | `Write\|Edit\|MultiEdit\|Bash` | `3s` | Record Activity Ledger diffs, pair resolved errors, reconcile rule/skill writes |
| `PostToolUseFailure` | `Write\|Edit\|MultiEdit\|Bash` | `3s` | Capture tool failures for `error_resolution` pairing |
| `PreCompact` | `*` | `10s` | Reset surfaced-memory cache and distill pre-compaction state |
| `TaskCompleted` | `*` | `5s` | Capture completed task milestones |
| `Stop` | `*` | `5s` | Flush uncaptured turns (honors `stop_hook_active`) |

---

## Quick Start

```bash
# Wire zero-secret MCP + Claude Code lifecycle hooks into the current project (or pass --global)
sulcus connect claude-code
```
