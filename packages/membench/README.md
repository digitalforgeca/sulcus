# MemBench — Open Memory Benchmark for AI Systems

**20 tasks. 5 categories. One question: does your memory layer actually work?**

MemBench is an open benchmark framework for evaluating AI memory systems. It tests whether a memory layer can persist, retrieve, update, and prioritize information across conversations — not just within a single context window.

## The Gap

| System | Score | Verdict |
|--------|-------|---------|
| No Memory (floor) | 0% | Baseline — verifies tests require memory |
| In-Context (ceiling) | 57.9% | Everything in the prompt. Passes recall, fails persistence. |
| **Persistent memory** | **?** | **The territory we're benchmarking.** |

The 42.1% gap between in-context and perfect is what persistent memory systems must capture: cross-session recall, intelligent decay, scaling efficiency, and contradiction resolution across time.

## Categories

- **Recall** (4 tasks) — Basic fact retention across topic changes
- **Temporal** (4 tasks) — Sequence ordering, recency bias, timeline tracking
- **Contradiction** (4 tasks) — Detecting and resolving conflicting information
- **Multi-Session** (4 tasks) — Cross-session fact persistence and state updates
- **Token Efficiency** (4 tasks) — Signal-to-noise, scaling, relevance filtering, thermodynamic decay

## Quick Start

```bash
git clone https://github.com/digitalforgeca/sulcus.git
cd sulcus/packages/membench

# Run baselines (no API keys needed)
python -m membench --adapter no-memory
python -m membench --adapter in-context

# Test Sulcus
python -m membench --adapter sulcus --api-key sk-...

# Test competitors
python -m membench --adapter mem0 --api-key ...    # pip install mem0ai
python -m membench --adapter openai --api-key ...  # pip install openai
python -m membench --adapter zep --api-key ...     # pip install zep-python

# Filter
python -m membench --adapter sulcus --api-key sk-... --categories recall temporal
python -m membench --adapter sulcus --api-key sk-... --difficulty hard

# Save results
python -m membench --adapter sulcus --api-key sk-... --output results/
```

## Adapters

| Adapter | Dependencies | What it tests |
|---------|-------------|---------------|
| `no-memory` | None | Floor baseline — 0% expected |
| `in-context` | None | Conversation scan — upper bound without persistence |
| `sulcus` | None (urllib) | Sulcus reactive, thermodynamic memory via REST API |
| `openai` | `openai` | OpenAI Assistants with thread-level memory |
| `mem0` | `mem0ai` | Mem0 managed memory API |
| `zep` | `zep-python` | Zep session-based memory |

## Writing Custom Adapters

```python
from membench.adapters.base import BaseAdapter
from membench.runner.types import BenchTask, TaskResult
from membench.runner.scoring import score_standard

class Adapter(BaseAdapter):
    def __init__(self, **kwargs):
        self.name = "my-memory-system"

    def reset(self) -> None:
        # Clear state between tasks
        pass

    def run_task(self, task: BenchTask) -> TaskResult:
        # 1. Ingest task.conversation into your memory system
        # 2. Query with task.query
        # 3. Score with score_standard(task, response, self.name, latency_ms)
        ...
```

## Scoring

- **Exact match** → 1.0 (answer contains the expected value)
- **Partial match** → 0.5 (answer contains related keywords)
- **Fail indicators** → 0.0 (response says "I don't know" etc.)
- **Decay tasks** use weighted scoring: high-importance facts retained (3pts), medium (1pt), low correctly pruned (1pt)

## Design Principles

1. **Include losses** — No benchmark is credible if the maker always wins
2. **Zero-dependency runner** — Python stdlib only (adapters can pull their own deps)
3. **Conversational tasks** — Tests embed realistic multi-turn conversations with topic shifts
4. **Open results** — Submit via PR, leaderboard at [sulcus.ca/membench](https://sulcus.ca/membench)

## License

MIT
