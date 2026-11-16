# Sulcus OpenCode Plugin

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-OpenCode%20CLI-cyan.svg)](https://opencode.ai)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Persistent thermodynamic memory knowledge graph, Activity Ledger tracking, and proactive context injection sidecar for OpenCode (`opencode`).

---

## Plugin Lifecycle

| OpenCode Event | Delegated Rust Command | Execution Objective |
| --- | --- | --- |
| `chat.message` | `sulcus hook --harness opencode recall` | Inject delta `<sulcus-memories>` and `/learn` candidates |
| `tool.execute.after` | `sulcus hook --harness opencode PostToolUse` | Record Activity Ledger mutations and reconcile `AGENTS.md` / `SKILL.md` writes |
| `session.compacted` | `sulcus hook --harness opencode Compaction` | Reset surfaced-memory state and preserve compaction summary |
| `session.idle` | `sulcus hook --harness opencode ingest` | Distill completed turns via System 1 VCR |

---

## Quick Start

```bash
# Wire opencode.json MCP + .opencode/plugins/sulcus.mjs
sulcus connect opencode
```
