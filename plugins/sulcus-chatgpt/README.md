# Sulcus ChatGPT App (`chatgpt-v0.1.1`)

[![Version](https://img.shields.io/badge/version-0.1.1-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-Proprietary-slate.svg)](plugin.json)
[![Platform](https://img.shields.io/badge/platform-OpenAI%20ChatGPT-cyan.svg)](https://chatgpt.com)
[![Protocol](https://img.shields.io/badge/protocol-Streamable%20HTTP%20MCP-purple.svg)](https://modelcontextprotocol.io)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Hosted Streamable HTTP MCP (`https://api.sulcus.ca/mcp`) memory connector and onboarding skills for OpenAI ChatGPT.

---

## Capabilities

ChatGPT connects directly to the managed Sulcus API (`streamable-http` MCP) without requiring local workstation binaries:
- **Semantic Recall (`search_memory`, `build_context`, `list_hot_nodes`)**: Surfaces thermodynamic pointers across linked namespaces, retrieving full territory (`fetch_memory`) only when needed.
- **Durable Knowledge Capture (`store_memory`, `update_memory`, `delete_memory`)**: Persists facts, preferences, decisions, and syntheses through the managed Sulcus API's System 1 (`VCR`) pipeline across ChatGPT conversations and shares them seamlessly with CLI/IDE coding agents (`agy`, Claude Code, Cursor, VS Code, Junie).
