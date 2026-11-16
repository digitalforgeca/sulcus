# Sulcus Cursor Plugin

[![Version](https://img.shields.io/badge/version-1.2.1-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Cursor%20Editor-cyan.svg)](https://cursor.com)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Persistent thermodynamic memory knowledge graph, Activity Ledger undo, and proactive context injection client for Cursor.

---

## Lifecycle Hooks

| Cursor Event | Handler | Timeout | Execution Objective |
| --- | --- | --- | --- |
| `sessionStart` | `sulcus hook --harness cursor sessionStart` | `5s` | Prime hot workspace pointers (`additional_context`) |
| `beforeSubmitPrompt` | `sulcus hook --harness cursor beforeSubmitPrompt` | `5s` | Inject delta `<sulcus-memories>` (`{"continue":true,"additional_context":...}`) |
| `preToolUse` | `sulcus hook --harness cursor preToolUse` | `2s` | Snapshot pre-mutation state for surgical undo (`{"permission":"allow"}`) |
| `postToolUse` | `sulcus hook --harness cursor postToolUse` | `3s` | Record Activity Ledger diffs, pair resolved errors, reconcile `.cursor/rules/*` writes |
| `postToolUseFailure` | `sulcus hook --harness cursor postToolUseFailure` | `3s` | Capture tool failures for `error_resolution` pairing |
| `preCompact` | `sulcus hook --harness cursor preCompact` | `5s` | Reset surfaced-memory cache before context window compaction |
| `stop` | `sulcus hook --harness cursor stop` | `5s` | Distill uncaptured turns via System 1 VCR |

---

## Quick Start

```bash
# Wire .cursor/mcp.json + .cursor/hooks.json (version: 1) + .cursor/rules/sulcus.mdc
sulcus connect cursor
```
