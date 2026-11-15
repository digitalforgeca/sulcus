# Sulcus Memory Engine (`v1.2.3`)

[![Version](https://img.shields.io/badge/version-1.2.3-blue.svg)](https://github.com/digitalforgeca/sulcus/tree/main/plugins/sulcus-vscode)
[![License](https://img.shields.io/badge/license-Apache--2.0-emerald.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-VS%20Code-cyan.svg)](https://code.visualstudio.com)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://www.rust-lang.org)
[![Language](https://img.shields.io/badge/language-TypeScript-blue.svg)](https://www.typescriptlang.org)
[![Storage](https://img.shields.io/badge/storage-PostgreSQL-blue.svg)](https://www.postgresql.org)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Persistent thermodynamic memory knowledge graph and Activity Ledger undo sidecar for Visual Studio Code and GitHub Copilot Agent Mode.

---

## Core Features

### Thermodynamic Memory & System 1 (VCR)
Sulcus models information salience using physical thermodynamics and the unified Value-Classify-Retrieve (`VCR`) pipeline. Active memories accumulate heat with frequent access while neglected nodes decay gracefully.

### Constellation Graph & Activity Ledger
Interactive memory web visualizes relationships, clusters, and cross-namespace bridges, paired with a surgical turn-level Activity Ledger sidebar (`sulcus.undoLastTurn`).

### GitHub Copilot Agent Hooks (`.github/hooks/sulcus.json` `version: 1`)
Automatic provisioning (`sulcus.configureHooks` or `sulcus connect vscode`) wires pure-Rust `sulcus hook --harness vscode <Event>` (`type: "command"`, `timeoutSec: 5`) across:
- `SessionStart` & `UserPromptSubmit`: Injects `<sulcus-memories>` via `hookSpecificOutput.additionalContext`.
- `PreToolUse` & `PostToolUse`: Snapshots mutations, records Activity Ledger diffs, pairs resolved errors, and reconciles `.github/copilot-instructions.md` / `SKILL.md` writes.
- `PreCompact` & `Stop`: Preserves state across compactions and flushes completed turns via System 1 VCR.
