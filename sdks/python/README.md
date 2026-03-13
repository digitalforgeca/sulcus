# Sulcus Python SDK

**Thermodynamic memory for AI agents.** Zero dependencies.

Sulcus is a memory system where physics decides what to forget. Memories have heat — hot memories are instantly accessible, cold ones fade naturally. CRDT sync keeps agents in lockstep.

## Install

```bash
pip install sulcus
```

For async support:

```bash
pip install sulcus[async]
```

## Quick Start

```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Remember something
client.remember("User prefers dark mode", memory_type="preference")
client.remember("Meeting with design team at 3pm", memory_type="episodic")
client.remember("API rate limit is 1000 req/min", memory_type="semantic")

# Search memories
results = client.search("dark mode")
for m in results:
    print(f"[{m.memory_type}] {m.pointer_summary} (heat: {m.current_heat:.2f})")

# List hot memories
memories = client.list(limit=10)

# Update a memory
client.update(memories[0].id, label="Updated preference")

# Pin important memories (prevents decay)
client.pin(memories[0].id)

# Forget
client.forget(memories[0].id)
```

## Async

```python
import asyncio
from sulcus import AsyncSulcus

async def main():
    async with AsyncSulcus(api_key="sk-...") as client:
        await client.remember("async memory", memory_type="semantic")
        results = await client.search("async")
        print(results)

asyncio.run(main())
```

## Self-Hosted

```python
client = Sulcus(
    api_key="your-key",
    base_url="http://localhost:4200",
)
```

## Memory Types

| Type | Description | Default Decay |
|------|-------------|---------------|
| `episodic` | Events, conversations, experiences | Fast |
| `semantic` | Facts, knowledge, definitions | Slow |
| `preference` | User preferences, settings | Medium |
| `procedural` | How-to knowledge, workflows | Slow |

## API

### `Sulcus(api_key, base_url?, namespace?, timeout?)`

Create a client. `base_url` defaults to Sulcus Cloud.

### `.remember(content, *, memory_type?, heat?, namespace?) -> Memory`

Store a memory. Returns the created node.

### `.search(query, *, limit?, memory_type?, namespace?) -> list[Memory]`

Text search. Results sorted by heat (most active first).

### `.list(*, limit?, offset?, memory_type?, namespace?) -> list[Memory]`

List memories with optional filters.

### `.get(memory_id) -> Memory`

Get a single memory by ID.

### `.update(memory_id, *, label?, memory_type?, is_pinned?, namespace?, heat?) -> Memory`

Update fields on a memory.

### `.forget(memory_id) -> bool`

Permanently delete a memory.

### `.pin(memory_id) / .unpin(memory_id) -> Memory`

Pin/unpin a memory. Pinned memories don't decay.

### `.whoami() -> dict`

Get account/org info.

### `.metrics() -> dict`

Get storage and health metrics.

## License

MIT
