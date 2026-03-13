# MemBench

**Open Memory Benchmark for AI Agent Memory Systems.**

MemBench is a standardized benchmark suite for evaluating how well AI memory systems retain, retrieve, and manage information across conversations and sessions.

## Why

Every AI memory system claims to be the best. None of them prove it with the same tests. MemBench fixes that.

## What It Tests

| Category | Tasks | What It Measures |
|----------|-------|-----------------|
| **Recall** | 4 | Can the system remember facts stated in conversation? |
| **Temporal** | 4 | Can the system reason about *when* things happened? |
| **Contradiction** | 4 | Can the system detect changes and use the latest info? |
| **Multi-Session** | 4 | Does memory persist across separate sessions? |
| **Token Efficiency** | 4 | How much context does the system use for retrieval? |

20 tasks total. Each scored on **accuracy** (did it get the right answer?), **efficiency** (how much context did it use?), and **latency** (how fast?).

## Quick Start

```bash
# Install
pip install membench

# List available tasks
membench list

# Run against Sulcus
SULCUS_API_KEY=sk-... membench run --adapter sulcus -o results/sulcus.json

# Run against Mem0
MEM0_API_KEY=... membench run --adapter mem0 -o results/mem0.json

# Run the baseline (raw context, no memory system)
membench run --adapter baseline -o results/baseline.json

# Compare
membench compare results/*.json
```

## Scoring

Each task produces three scores:

- **Accuracy** (0.0–1.0): Did the system return the correct information?
- **Efficiency** (0.0–1.0): How much context was used? Less is better.
- **Latency**: Raw query time in milliseconds.

**Composite Score** = 60% accuracy + 30% efficiency + 10% latency

## Adapters

| Adapter | System | Install |
|---------|--------|---------|
| `sulcus` | Sulcus | `pip install membench[sulcus]` |
| `mem0` | Mem0 | `pip install membench[mem0]` |
| `zep` | Zep | `pip install membench[zep]` |
| `langchain-buffer` | LangChain Buffer Memory | `pip install membench[langchain]` |
| `langchain-summary` | LangChain Summary Memory | `pip install membench[langchain]` |
| `baseline` | Raw context (control group) | Built-in |

### Writing Your Own Adapter

```python
from membench.adapter import MemoryAdapter, Message, MemoryStats

class MyAdapter(MemoryAdapter):
    @property
    def name(self) -> str:
        return "My Memory System"

    @property
    def version(self) -> str:
        return "1.0.0"

    def reset(self) -> None:
        # Clear all stored memories
        ...

    def ingest(self, messages: list[Message]) -> None:
        # Store conversation messages
        ...

    def query(self, question: str) -> str:
        # Return relevant context for the question
        ...

    def get_stats(self) -> MemoryStats:
        # Return current memory statistics
        return MemoryStats(context_bytes=..., node_count=...)
```

## Philosophy

1. **Open source** — tasks, runner, adapters all MIT licensed. Anyone can run, verify, and submit.
2. **Honest** — if a system loses, we publish the loss. Cherry-picked benchmarks are worthless.
3. **Reproducible** — same tasks, same evaluation, deterministic scoring. Pin your model versions.
4. **Versioned** — MemBench v0.1, with a changelog. Systems improve; benchmarks evolve.

## Contributing

- Submit new tasks via PR
- Write adapters for systems we haven't covered
- Report scoring issues — fairness is more important than any particular result

## License

MIT

---

*MemBench is maintained by [Sulcus](https://sulcus.dforge.ca) — but it belongs to the community.*
