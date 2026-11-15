# Sulcus Codex Plugin (`v1.2.0`)

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-OpenAI%20Codex%20CLI-cyan.svg)](https://openai.com)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Persistent thermodynamic memory knowledge graph, Activity Ledger undo, and proactive context injection sidecar for OpenAI Codex CLI.

---

## Pure-Rust Lifecycle Hooks (`hooks.json` / `.codex/hooks.json`)

Codex CLI supports 5 PascalCase lifecycle hook events (`codex_hooks = true`):

| Codex Event | Handler | Timeout | Execution Objective |
| --- | --- | --- | --- |
| `SessionStart` | `sulcus hook --harness codex SessionStart` | `5s` | Prime workspace hot nodes via `hookSpecificOutput.additionalContext` |
| `UserPromptSubmit` | `sulcus hook --harness codex UserPromptSubmit` | `5s` | Inject delta `<sulcus-memories>` |
| `PreToolUse` | `sulcus hook --harness codex PreToolUse` | `2s` | Snapshot pre-mutation state for surgical undo |
| `PostToolUse` | `sulcus hook --harness codex PostToolUse` | `3s` | Record Activity Ledger diffs, pair resolved errors, reconcile `AGENTS.md` / `SKILL.md` writes |
| `Stop` | `sulcus hook --harness codex Stop` | `5s` | Distill completed turns via System 1 VCR |

---

## Quick Start

```bash
# Wire .codex/mcp.json + .codex/hooks.json (or pass --global for ~/.codex/)
sulcus connect codex
```
