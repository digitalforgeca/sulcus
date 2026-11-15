# Sulcus ChatGPT App (`chatgpt-v0.1.1`)

[![Version](https://img.shields.io/badge/version-0.1.1-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-OpenAI%20ChatGPT-cyan.svg)](https://chatgpt.com)
[![Protocol](https://img.shields.io/badge/protocol-Streamable%20HTTP%20MCP-purple.svg)](https://modelcontextprotocol.io)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Hosted Streamable HTTP MCP (`https://api.sulcus.ca/mcp`) memory connector and onboarding skills for OpenAI ChatGPT.

---

## Capabilities

ChatGPT connects directly to the managed Sulcus API (`streamable-http` MCP) without requiring local workstation binaries:
- **Semantic Recall (`search_memory`, `build_context`, `list_memories`)**: Surfaces thermodynamic pointers across project namespaces, retrieving full territory (`expand_memory`) only when needed.
- **Durable Knowledge Capture (`store_memory`, `update_memory`, `forget_memory`)**: Persists facts, preferences, decisions, and syntheses through the managed Sulcus API's System 1 (`VCR`) pipeline across ChatGPT conversations and your personal CLI/IDE coding sessions (`agy`, Claude Code, Cursor, VS Code, Junie).
