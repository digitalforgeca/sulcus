# Sulcus Continue Plugin

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Continue.dev-cyan.svg)](https://continue.dev)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)

Persistent thermodynamic memory context provider (`@sulcus`) and zero-secret MCP integration for Continue.dev (VS Code & JetBrains).

---

## Integration Architecture

1. **`@sulcus` Custom Context Provider (`sulcus-context-provider.mjs`)**: Invokes `sulcus hook --harness continue recall "<query>"` to inject `<sulcus-memories>` on demand.
2. **Zero-Secret MCP (`config.yaml`)**: Connects Continue Agent Mode to `sulcus mcp-proxy` for `build_context`, `search_memory`, `expand_memory`, `store_memory`, `update_memory`, and local AST navigation (`project_map`, `find_symbol`, `get_outline`, `get_references`).
