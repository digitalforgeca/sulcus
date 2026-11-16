# Sulcus Windsurf Plugin

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windsurf%20Editor-cyan.svg)](https://windsurf.com)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Persistent thermodynamic memory knowledge graph, Activity Ledger undo, and proactive context injection sidecar for Windsurf Cascade.

---

## Cascade Hooks

| Windsurf Cascade Event | Handler | Execution Objective |
| --- | --- | --- |
| `pre_user_prompt` | `sulcus hook --harness windsurf pre_user_prompt` (`show_output: true`) | Inject delta `<sulcus-memories>` |
| `pre_write_code` | `sulcus hook --harness windsurf pre_write_code` | Snapshot pre-mutation file state for Activity Ledger undo |
| `post_write_code` | `sulcus hook --harness windsurf post_write_code` | Record file diffs and reconcile `.windsurf/rules/*` / `.windsurfrules` writes |
| `post_run_command` | `sulcus hook --harness windsurf post_run_command` | Capture command failures and pair resolved retries |
| `post_cascade_response` | `sulcus hook --harness windsurf post_cascade_response` | Distill completed Cascade turns via System 1 VCR |

---

## Quick Start

```bash
# Wire Windsurf MCP + .windsurf/hooks.json
sulcus connect windsurf
```
