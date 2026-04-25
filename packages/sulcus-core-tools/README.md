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
python -m sulcus_core_tools.generate --format openai > tools.json
python -m sulcus_core_tools.generate --format anthropic > tools.json
python -m sulcus_core_tools.generate --format gemini > tools.json
python -m sulcus_core_tools.generate --format mcp > tools.json
```

## Adding a new tool

1. Add the tool definition to `tool_defs.py`
2. Add the handler function to `handler.py`
3. All formatters automatically pick it up
4. All integrations get the new tool on next publish
