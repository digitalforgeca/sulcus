# Sulcus Zed Extension

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Zed%20Editor-cyan.svg)](https://zed.dev)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)

Zero-secret MCP Context Server (`sulcus mcp-proxy`), System 1 (`VCR`) curation, Synapse reaction, and `.rules` workflow guide for Zed Editor Assistant.

---

## Integration Architecture

Zed Assistant integrates via MCP Context Servers (`extension.toml` `[context_servers.sulcus]` running `sulcus mcp-proxy`) paired with workspace `.rules` directives instructing the assistant to query `build_context` / `search_memory` first and persist durable findings via `store_memory`.
