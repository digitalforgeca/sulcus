# Sulcus Industry Benchmark Adapter

Drop-in Sulcus adapter for [Mem0's memory-benchmarks](https://github.com/mem0ai/memory-benchmarks) harness.

## What This Is

Sulcus wrappers that plug into Mem0's official benchmark pipelines (LoCoMo, LongMemEval, BEAM)
using the exact same methodology, scoring, and judge LLM as Mem0's published results.

## Files

- `benchmarks/common/sulcus_client.py` — `SulcusClient` (drop-in for `Mem0Client`)
- `benchmarks/locomo/run_sulcus.py` — LoCoMo benchmark runner
- `benchmarks/longmemeval/run_sulcus.py` — LongMemEval benchmark runner

## Setup

1. Clone upstream: `git clone https://github.com/mem0ai/memory-benchmarks.git`
2. Copy our files into the clone
3. `pip install -r requirements.txt`
4. Set `SULCUS_API_KEY` and optionally `SULCUS_BASE_URL`

## Running

```bash
# LoCoMo (predict-only, no LLM cost)
python -m benchmarks.locomo.run_sulcus --sulcus-api-key $SULCUS_API_KEY --predict-only

# LongMemEval (predict-only)
python -m benchmarks.longmemeval.run_sulcus --sulcus-api-key $SULCUS_API_KEY --predict-only

# Full scored run (needs OPENAI_API_KEY for judge)
python -m benchmarks.locomo.run_sulcus --sulcus-api-key $SULCUS_API_KEY
```

## Targets to Beat

| Benchmark | Mem0 v3 (cloud) | Sulcus (TBD) |
|-----------|-----------------|---------------|
| LoCoMo    | 91.6%           | —             |
| LongMemEval | 93.4%         | —             |
| BEAM (1M) | 64.1%           | —             |
