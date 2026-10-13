# Google Memory Benchmark Suite

A standalone, reproducible implementation of Google & Google DeepMind's canonical AI memory evaluation benchmarks for LLMs and AI Agents.

## Suites Implemented

1. **Multi-Needle in a Haystack (NIAH)**:
   - Google's canonical Gemini long-context retrieval evaluation.
   - Evaluates needle extraction across context horizons (1k, 3k, 6k, 10k+ tokens) and depths (0%, 25%, 50%, 75%, 100%).
   - Includes **Single-Needle**, **Multi-Needle** (simultaneous multi-fact extraction), and **Adversarial Distractor** tests.
   - Outputs Gemini-style visual grid heatmaps.

2. **Google DeepMind Evo-Memory (ReMem / ExpRAG)**:
   - Sequential task streams evaluating:
     - **Test-Time Learning (TTL)**: Reusing operational knowledge from prior tasks.
     - **Conflict Resolution (CR)**: Discarding obsolete procedures when requirements change.
     - **Abstention & Negative Knowledge**: Rejecting hallucinations when information is unstated.

3. **BABILong Multi-Hop Reasoning**:
   - Multi-hop memory reasoning across transitive chains, spatial path traversal, and deductive rules.

## Quick Start

```bash
# Run quick test suite against Sulcus
PYTHONPATH=src python3 -m google_memory_bench --adapter sulcus-direct --api-key icarus-sulcus-2026 --quick

# Run full Google benchmark matrix
PYTHONPATH=src python3 -m google_memory_bench --adapter sulcus-direct --api-key icarus-sulcus-2026 --benchmark all

# Run specific suite
PYTHONPATH=src python3 -m google_memory_bench --adapter sulcus-direct --api-key icarus-sulcus-2026 --benchmark niah
PYTHONPATH=src python3 -m google_memory_bench --adapter sulcus-direct --api-key icarus-sulcus-2026 --benchmark evo-memory
PYTHONPATH=src python3 -m google_memory_bench --adapter sulcus-direct --api-key icarus-sulcus-2026 --benchmark babilong
```
