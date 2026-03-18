# Sulcus — Anthropic Tool Definitions

Ready-to-use Anthropic tool_use definitions for [Sulcus](https://sulcus.ca) — a thermodynamic memory system for AI agents.

## Files

| File | Purpose |
|------|---------|
| `tools.json` | Anthropic tool_use schema (5 tools, `input_schema` format) |
| `handler.py` | Dispatch tool_use blocks to Sulcus REST API (stdlib only) |
| `example.py` | Complete working example with `anthropic` library |

---

## Quick Start

```bash
pip install anthropic

export ANTHROPIC_API_KEY="sk-ant-..."
export SULCUS_API_KEY="your-sulcus-api-key"
export SULCUS_BASE_URL="https://server.sulcus.ca"  # optional, this is the default

python example.py
```

---

## Tools

### `sulcus_remember` — Store a memory
```python
# Store a user preference
sulcus_remember(
    content="User prefers TypeScript over JavaScript for all new projects.",
    memory_type="preference",
    heat=90.0,
)

# Store a fact scoped to a project namespace
sulcus_remember(
    content="Project Alpha uses PostgreSQL 16 on Azure Container Apps.",
    memory_type="semantic",
    namespace="project-alpha",
)
```

**Input:**
- `content` *(required)* — The text to store
- `memory_type` — `"episodic"` | `"semantic"` | `"preference"` | `"procedural"` (default: `"semantic"`)
- `heat` — Activation heat 0–100 (default: 80.0)
- `namespace` — Fold/namespace for scoping (optional)

---

### `sulcus_search` — Search memories
```python
sulcus_search(query="What does the user prefer for frontend development?")
sulcus_search(query="user preferences", memory_type="preference", limit=5)
```

**Input:**
- `query` *(required)* — Natural language query
- `limit` — Max results (default: 10)
- `memory_type` — Filter by type (optional)

---

### `sulcus_list` — Browse memories
```python
sulcus_list(pinned=True)
sulcus_list(memory_type="procedural", namespace="project-alpha", page=1, page_size=10)
```

**Input:**
- `page` — Page number (default: 1)
- `page_size` — Results per page (default: 20)
- `memory_type` / `namespace` / `pinned` — Optional filters

---

### `sulcus_forget` — Delete a memory
```python
sulcus_forget(memory_id="018f1234-abcd-7000-8000-000000000001")
```

**Input:** `memory_id` *(required)* — UUID from search/list

---

### `sulcus_update` — Update a memory
```python
sulcus_update(
    memory_id="018f1234-abcd-7000-8000-000000000001",
    label="User name",
    is_pinned=True,
    heat=95.0,
)
```

**Input:** `memory_id` *(required)* + any of: `label`, `memory_type`, `is_pinned`, `heat`

---

## Integration Pattern

```python
import json
import anthropic
from handler import handle_tool_use

with open("tools.json") as f:
    tools = json.load(f)

client = anthropic.Anthropic()
messages = [{"role": "user", "content": "Remember that I prefer dark mode everywhere."}]

# Agentic loop
while True:
    response = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=4096,
        system="You have access to Sulcus memory tools.",
        tools=tools,
        messages=messages,
    )

    messages.append({"role": "assistant", "content": response.content})

    if response.stop_reason != "tool_use":
        # Extract and print text blocks
        for block in response.content:
            if hasattr(block, "text"):
                print(block.text)
        break

    # Handle all tool_use blocks and feed results back
    tool_results = [
        handle_tool_use(block)
        for block in response.content
        if block.type == "tool_use"
    ]
    messages.append({"role": "user", "content": tool_results})
```

---

## Anthropic vs OpenAI Format Differences

| Aspect | OpenAI | Anthropic |
|--------|--------|-----------|
| Schema key | `"parameters"` | `"input_schema"` |
| Tool call type | `tool_calls[i].function` | `content[i].input` (dict, not JSON string) |
| Result message | `{"role": "tool", ...}` | `{"role": "user", "content": [{"type": "tool_result", ...}]}` |
| Stop signal | `finish_reason == "tool_calls"` | `stop_reason == "tool_use"` |

The `handler.py` in each integration handles these differences transparently.

---

## Memory Types

| Type | Use for | Example |
|------|---------|---------|
| `semantic` | Facts, knowledge, entities | "The server runs on port 3000" |
| `episodic` | Events, conversation history | "User asked about billing on 2026-03-13" |
| `preference` | How the user likes things | "User prefers concise replies" |
| `procedural` | How to do things | "Deploy: az acr build + containerapp update" |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SULCUS_API_KEY` | *(required)* | Your Sulcus API key |
| `SULCUS_BASE_URL` | `https://server.sulcus.ca` | Sulcus server base URL |

---

## Error Handling

`handler.py` never raises. Errors are returned as `tool_result` blocks with `is_error: true` and a descriptive JSON content string, so Claude can read and relay them gracefully:

```python
{
    "type": "tool_result",
    "tool_use_id": "toolu_abc123",
    "content": '{"error": "Sulcus API error 401 on POST /memories: Unauthorized"}',
    "is_error": True,
}
```
