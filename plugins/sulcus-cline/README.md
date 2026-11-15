# Sulcus Cline Plugin (`v1.2.0`)

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Cline%20Extension-cyan.svg)](https://github.com/cline/cline)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Persistent thermodynamic memory knowledge graph, Activity Ledger undo, and proactive context injection sidecar for Cline.

---

## Executable Cline Lifecycle Hooks (`.clinerules/hooks/`)

Cline executes scripts named after each lifecycle event inside `.clinerules/hooks/` and reads `{"cancel": false, "contextModification": "..."}` from stdout:

| Cline Script | Handler | Execution Objective |
| --- | --- | --- |
| `.clinerules/hooks/TaskStart` | `sulcus hook --harness cline TaskStart` | Prime workspace hot nodes at task start |
| `.clinerules/hooks/UserPromptSubmit` | `sulcus hook --harness cline UserPromptSubmit` | Inject delta `<sulcus-memories>` |
| `.clinerules/hooks/PreToolUse` | `sulcus hook --harness cline PreToolUse` | Snapshot pre-mutation file state (`{"cancel":false}`) |
| `.clinerules/hooks/PostToolUse` | `sulcus hook --harness cline PostToolUse` | Record Activity Ledger diffs and reconcile `.clinerules/*` writes |
| `.clinerules/hooks/TaskComplete` | `sulcus hook --harness cline TaskComplete` | Capture completed task output via System 1 VCR |

---

## Quick Start

```bash
# Wire Cline MCP + executable .clinerules/hooks/* wrappers
sulcus connect cline
```
