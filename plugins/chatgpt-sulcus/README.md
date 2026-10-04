# SULCUS ChatGPT Plugin

Official integration package connecting **SULCUS Semantic Thermodynamic Memory** to **ChatGPT** via Model Context Protocol (MCP).

SULCUS equips ChatGPT with persistent cross-session memory, proactive context recall, durable knowledge capture, and structured settings configuration.

---

## Architecture

- **Protocol:** Model Context Protocol (MCP) Streamable HTTP
- **Endpoint:** `https://api.sulcus.ca/mcp`
- **Specification:** Agent Plugins 1.0.0 (`plugin.json` + `.codex-plugin/plugin.json`)
- **App Registration:** `.app.json` (`asdk_app_6abf215bfa608191bcd028d0a3d75332`)
- **Settings:** Native OpenAI Structured Settings capability (`settings.read`, `settings.update`)
- **Operational Directives:** `skills/sulcus-setup/SKILL.md`

---

## Canonical MCP Tools

- `search_memories`: Semantic and full-text search across persistent knowledge nodes
- `store_memory`: Classify and persist durable facts, preferences, decisions, and procedural directives
- `get_memory`: Retrieve memory node details and CCR pointers
- `update_memory`: Revise existing memory nodes and reconcile contradictions
- `delete_memory`: Explicit memory forgetting and graph node deletion
- `list_hot_memories`: Retrieve recently active or high-heat contextual memories
- `get_user_profile`: Load core user identity facts, account tier, and permanent directives
- `list_namespaces`: Multi-workspace and namespace isolation

---

## Configuration & Authentication

The plugin relies on the OpenAI Structured Settings capability exposed by the remote MCP server (`settings.read`, `settings.update`). Users configure their API key via ChatGPT's native Settings modal rather than in-chat prompts.

---

## Package Contents

- `.app.json`: OpenAI app registration
- `.mcp.json`: Remote MCP streamable HTTP server pointer
- `plugin.json`: Root Agent Plugins manifest
- `.codex-plugin/plugin.json`: Codex compatibility manifest
- `skills/sulcus-setup/SKILL.md`: Model lifecycle behavior & tool directives
- `SULCUS_CHATGPT_INTEGRATION.md`: Platform integration contract
