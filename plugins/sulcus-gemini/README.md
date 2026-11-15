# Sulcus Gemini CLI Extension (`v1.2.0`)

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Gemini%20CLI-cyan.svg)](https://github.com/google-gemini/gemini-cli)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)

Persistent thermodynamic memory knowledge graph, AST PageRank, and Activity Ledger undo extension for Google Gemini CLI (`gemini`).

> **Note**: For Google **Antigravity (`agy`)**, use [`plugins/sulcus-agy`](../sulcus-agy/README.md) (`sulcus connect agy`), which uses Antigravity's native `PreInvocation`/`PostInvocation` `injectSteps` protocol.

---

## Pure-Rust Lifecycle Hooks (`hooks/hooks.json` / `.gemini/settings.json`)

Gemini CLI uses **millisecond** `timeout` values and `hookSpecificOutput.additionalContext`:

| Gemini CLI Event | Handler | Timeout | Execution Objective |
| --- | --- | --- | --- |
| `SessionStart` | `sulcus hook --harness gemini SessionStart` | `5000 ms` | Prime workspace hot nodes via `hookSpecificOutput.additionalContext` |
| `BeforeAgent` | `sulcus hook --harness gemini BeforeAgent` | `5000 ms` | Inject delta `<sulcus-memories>` |
| `BeforeTool` | `sulcus hook --harness gemini BeforeTool` | `2500 ms` | Snapshot pre-mutation state (`{"decision":"allow"}`) |
| `AfterTool` | `sulcus hook --harness gemini AfterTool` | `3000 ms` | Record Activity Ledger diffs, pair resolved errors, reconcile `GEMINI.md` / `SKILL.md` writes |
| `PreCompress` | `sulcus hook --harness gemini PreCompress` | `5000 ms` | Reset surfaced-memory cache before context compression |
| `AfterAgent` | `sulcus hook --harness gemini AfterAgent` | `5000 ms` | Capture completed turns via System 1 VCR |
| `SessionEnd` | `sulcus hook --harness gemini SessionEnd` | `3000 ms` | Flush final turns on session exit |

---

## Quick Start

```bash
# Wire .gemini/settings.json (or pass --global for ~/.gemini/settings.json)
sulcus connect gemini
```
