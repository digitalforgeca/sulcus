# Sulcus — OpenAI Tool Definitions

Ready-to-use OpenAI function calling definitions for [Sulcus](https://sulcus.ca) — persistent, intelligent memory for AI agents.

## Files

| File | Purpose |
|------|---------|
| `tools.json` | OpenAI function calling schema (5 tools) |
| `handler.py` | Dispatch tool calls to Sulcus REST API (stdlib only) |
| `example.py` | Complete working example with `openai` library |

---

## Quick Start

```bash
pip install openai

export OPENAI_API_KEY="sk-..."
export SULCUS_API_KEY="your-sulcus-api-key"
export SULCUS_BASE_URL="https://api.sulcus.ca"  # optional, this is the default

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

**Params:**
- `content` *(required)* — The text to store
- `memory_type` — `"episodic"` | `"semantic"` | `"preference"` | `"procedural"` (default: `"semantic"`)
- `heat` — Activation heat 0–100 (default: 80.0). Higher = surfaces more often
- `namespace` — Fold/namespace for scoping (optional)

---

### `sulcus_search` — Search memories
```python
# Find anything relevant to a user query
sulcus_search(query="What does the user prefer for frontend development?")

# Search only preference memories
sulcus_search(query="user preferences", memory_type="preference", limit=5)
```

**Params:**
- `query` *(required)* — Natural language query
- `limit` — Max results (default: 10)
- `memory_type` — Filter by type (optional)

---

### `sulcus_list` — Browse memories
```python
# List all pinned memories
sulcus_list(pinned=True)

# Page through procedural memories in a namespace
sulcus_list(memory_type="procedural", namespace="project-alpha", page=1, page_size=10)
```

**Params:**
- `page` — Page number (default: 1)
- `page_size` — Results per page (default: 20)
- `memory_type` — Filter by type (optional)
- `namespace` — Filter by namespace (optional)
- `pinned` — `True`/`False` filter, or omit for all (optional)

---

### `sulcus_forget` — Delete a memory
```python
# Permanently delete by UUID (get ID from search/list results)
sulcus_forget(memory_id="018f1234-abcd-7000-8000-000000000001")
```

**Params:**
- `memory_id` *(required)* — UUID from search/list results

---

### `sulcus_update` — Update a memory
```python
# Correct a stored fact
sulcus_update(
    memory_id="018f1234-abcd-7000-8000-000000000001",
    label="User name",
    memory_type="semantic",
    is_pinned=True,
    heat=95.0,
)
```

**Params:**
- `memory_id` *(required)* — UUID from search/list results
- `label` — New display label (optional)
- `memory_type` — New type (optional)
- `is_pinned` — Pin/unpin (optional)
- `heat` — New heat value 0–100 (optional)

---

## Integration Pattern

```python
import json
from openai import OpenAI
from handler import handle_tool_call

# Load tools
with open("tools.json") as f:
    tools = json.load(f)

client = OpenAI()
messages = [
    {"role": "system", "content": "You have access to Sulcus memory tools."},
    {"role": "user", "content": "Remember that I prefer dark mode everywhere."},
]

# Agentic loop
while True:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools,
        tool_choice="auto",
    )
    message = response.choices[0].message
    messages.append(message)

    if not message.tool_calls:
        print(message.content)
        break

    for tool_call in message.tool_calls:
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": handle_tool_call(tool_call),
        })
```

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
| `SULCUS_BASE_URL` | `https://api.sulcus.ca` | Sulcus server base URL |

---

## Error Handling

`handler.py` catches all errors and returns them as JSON strings so the model can read and relay them gracefully:

```json
{"error": "Sulcus API error 401 on POST /memories: Unauthorized"}
```

No exceptions propagate out of `handle_tool_call()`.
