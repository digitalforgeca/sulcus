# Sulcus Junie Plugin

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)

Persistent thermodynamic memory, System 1 VCR curation, and 1,000+ turn Activity Ledger undo for **JetBrains Junie CLI** and **RubyMine 2024.3+ / 2025.1+**.

> **Repository Scope**: This package is maintained alongside `plugins/sulcus-jetbrains`.

## Architecture Overview

1. **Zero-Secret MCP Server (`.junie/mcp/mcp.json`)**:
   Connects Junie to `sulcus mcp-proxy` locally (reading credentials from `0600 ~/.config/sulcus/sulcus.ini` or OS environment rather than storing API keys in git-tracked files).
2. **Full Pure-Rust Lifecycle Hooks (`.junie/config.json`)**:
   - `SessionStart` & `UserPromptSubmit`: Injects delta-only `<sulcus-memories>` within a strict socket budget.
   - `PreToolUse`: Snapshots target files for surgical Activity Ledger undo (`{}` passive response so Junie's interactive approval flow is preserved).
   - `PostToolUse`: Records file diffs to the Activity Ledger, pairs tool failures with subsequent fixes (`[learn:candidate]`), and reconciles `.junie/guidelines.md` / `SKILL.md` promotions.
   - `PreCompact`: Resets surfaced-memory tracking before context window compaction.
   - `Stop` & `SessionEnd`: Distills completed turns through System 1 VCR (`/api/v1/agent/ingest`).
3. **RubyMine & Rails Guidelines (`.junie/guidelines.md` + `skills/sulcus/SKILL.md`)**:
   Teaches Junie to scan lightweight memory pointers first, check project namespaces, and pair Sulcus memory with targeted `rspec file:line` runs and RubyMine symbol navigation.

## Quick Start

```bash
# Via sulcus CLI (recommended)
sulcus connect junie

# Or via the standalone Junie helper (adds secret-safe .gitignore rules automatically)
node plugins/sulcus-junie/bin/sulcus-junie.mjs install --project --rubymine

# Verify binary availability and ensure zero plaintext tokens exist in .junie/
node plugins/sulcus-junie/bin/sulcus-junie.mjs doctor
```

## Running Lifecycle Tests

```bash
node --test plugins/sulcus-junie/tests/junie_lifecycle.test.mjs
```
