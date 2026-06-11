# sulcus-core-tools

**Single source of truth for all Sulcus tool definitions and Python handler logic.**

Every integration (OpenAI, Anthropic, CrewAI, LangChain, etc.) derives from this package instead of maintaining its own copy.

## What's in here

```
sulcus-core-tools/
├── tool_defs.py          # Canonical tool definitions (Python dataclasses)
├── handler.py            # Shared HTTP client + tool implementations
├── formatters/
│   ├── openai.py         # tool_defs → OpenAI function calling JSON
│   ├── anthropic.py      # tool_defs → Anthropic tool_use JSON
│   ├── mcp.py            # tool_defs → MCP tool schema
│   └── gemini.py         # tool_defs → Gemini function declarations
├── dispatchers/
│   ├── openai.py         # OpenAI tool_call → handler dispatch
│   └── anthropic.py      # Anthropic ToolUseBlock → handler dispatch
└── hooks/
    ├── _sulcus-lib.sh    # Shared shell library (cloud/local detection)
    ├── session-start.sh  # Session start hook
    ├── on-user-prompt.sh # User prompt recall hook
    ├── block-memory-write.sh
    ├── post-tool-use.sh
    ├── on-pre-compact.sh
    ├── on-task-completed.sh
    └── on-stop.sh
```

## How integrations use this

### Python integrations (OpenAI, Anthropic, CrewAI, etc.)

```python
from sulcus_core_tools import handler
from sulcus_core_tools.formatters import openai as fmt

# Get tool definitions in OpenAI format
tools_json = fmt.format_tools()

# Handle a tool call
result = handler.dispatch("sulcus_search", {"query": "preferences", "limit": 5})
```

### Shell hook plugins (Claude Code, Cursor, Codex)

Hook scripts are symlinked or copied from `hooks/`. Each platform plugin's hooks.json points at the scripts using `${PLUGIN_ROOT}/hooks-handlers/`.

### Generating tools.json for any platform

```bash
python -m sulcus_core_tools --format openai > tools.json
python -m sulcus_core_tools --format anthropic > tools.json
python -m sulcus_core_tools --format gemini > tools.json
```

## Adding a new tool

1. Add the tool definition to `tool_defs.py`
2. Add the handler function to `handler.py`
3. All formatters automatically pick it up
4. All integrations get the new tool on next publish

## Server endpoint mapping (v2.25.2)

All paths are relative to `BASE_URL/api/v1`.

| Tool | Method | Path | Notes |
|---|---|---|---|
| `sulcus_remember` | POST | `/agent/nodes` | Field: `label` (not `content`); heat is 0.0–1.0 server-side |
| `sulcus_search` | POST | `/agent/search` | Hybrid semantic + full-text |
| `sulcus_list` | GET | `/agent/nodes` | Query params: page, page_size, memory_type, namespace, pinned |
| `sulcus_forget` | DELETE | `/agent/nodes/:id` | Permanent |
| `sulcus_update` | PATCH | `/agent/nodes/:id` | Field: `current_heat` (not `heat`) for heat updates |
| `sulcus_boost` | POST | `/agent/boost-batch` | GET current heat first, then set clamped(current + delta) |
| `sulcus_deprecate` | POST | `/agent/boost-batch` | GET current heat first, then set clamped(current - delta) |
| `sulcus_hot_nodes` | GET | `/agent/hot_nodes` | Query param: limit |
| `sulcus_build_context` | POST | `/agent/hot-context` | Returns hottest memories, no query vector |
| `sulcus_create_trigger` | POST | `/triggers` | |
| `sulcus_list_triggers` | GET | `/triggers` | |
| `sulcus_delete_trigger` | DELETE | `/triggers/:id` | |
| `sulcus_relate` | — | not supported | Returns guidance message; edges are auto-created by SILU |
| `sulcus_graph_traverse` | GET | `/agent/graph/neighbors/:id` | depth param unsupported server-side |
| `sulcus_status` | GET | `/status` | Public status endpoint |

## Environment variables

| Var | Default | Description |
|---|---|---|
| `SULCUS_BASE_URL` | `https://api.sulcus.ca` | Server base URL (no trailing slash) |
| `SULCUS_API_KEY` | _(required)_ | Bearer token for authentication |
