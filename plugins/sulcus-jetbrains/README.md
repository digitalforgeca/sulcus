# Sulcus JetBrains Plugin

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://sulcus.ca)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-RubyMine%20%7C%20IntelliJ%202024.3%2B-cyan.svg)](https://jetbrains.com)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)

Persistent thermodynamic memory, System 1 VCR curation, and RSpec/Rails execution compaction for **JetBrains RubyMine**, **IntelliJ IDEA**, **PyCharm**, **WebStorm**, **RustRover**, **GoLand**, **CLion**, and **Junie**.

## Core Capabilities

### IntelliJ Platform Integration
- **Project Trust Safety**: Verifies `TrustedProjects.isProjectTrusted(project)` before running any workspace inspection or Junie bootstrap action.
- **Secure Credential Storage**: Stores `SULCUS_API_KEY` inside JetBrains `PasswordSafe` (OS keychain) rather than plain XML files.
- **RSpec, Minitest & Rake Execution Listener**: Hooks into JetBrains `ExecutionListener` to compact failing Ruby/Rails test runs (stripping ANSI escape codes and `/gems/` frames) before System 1 VCR ingestion.
- **One-Click Junie Bootstrap**: `Tools -> Sulcus Memory -> Bootstrap Junie Config` writes zero-secret `.junie/mcp/mcp.json` (requires the single-binary `sulcus` CLI on `PATH`) and RubyMine guidelines for the active project.

## Building Locally

```bash
cd plugins/sulcus-jetbrains
gradle buildPlugin
```

Install the generated `.zip` from `build/distributions/` in RubyMine via `Settings -> Plugins -> Install Plugin from Disk...`.
