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

## Memory Lifecycle Control

```python
# Store with full control over retention
client.remember(
    "Deploy procedure for production",
    memory_type="procedural",
    decay_class="permanent",   # volatile | normal | stable | permanent
    is_pinned=True,            # Prevents decay below min_heat
    min_heat=0.5,              # Floor — never decays below this
    key_points=["docker build", "az containerapp update", "DEPLOY_TS trick"],
)

# Bulk update multiple memories at once
client.bulk_update(
    ids=["mem-1", "mem-2", "mem-3"],
    is_pinned=True,
    decay_class="stable",
)
```

## Memory Types

| Type | Description | Default Decay |
|------|-------------|---------------|
| `episodic` | Events, conversations, experiences | Fast |
| `semantic` | Facts, knowledge, definitions | Slow |
| `preference` | User preferences, settings | Medium |
| `procedural` | How-to knowledge, workflows | Slow |
| `fact` | Stable knowledge, decisions | Near-permanent |

## API

### `Sulcus(api_key, base_url?, namespace?, timeout?)`

Create a client. `base_url` defaults to Sulcus Cloud.

### `.remember(content, *, memory_type?, decay_class?, is_pinned?, min_heat?, key_points?, namespace?) -> Memory`

Store a memory with full lifecycle control. `decay_class` controls retention speed (`volatile`, `normal`, `stable`, `permanent`). `key_points` are indexed for better recall.

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
