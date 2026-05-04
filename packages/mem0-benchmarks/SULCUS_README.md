# Sulcus + Industry Benchmark Harness

This package is Mem0's open-source [memory-benchmarks](https://github.com/mem0ai/memory-benchmarks) harness,
forked and extended with a **Sulcus backend adapter**.

It runs LoCoMo, LongMemEval, and BEAM against Sulcus using the **exact same pipeline**
that Mem0 uses to produce their published scores — giving directly comparable results.

## Why This Matters

MemBench was our own homebrew test suite. It measured internal consistency, not
industry-recognized capability. These benchmarks are what the field actually uses:

| Benchmark | Dataset | Questions | What it tests |
|---|---|---|---|
| **LoCoMo** | 10 multi-session dialogues | ~300 | Factual recall, temporal reasoning, multi-hop inference |
| **LongMemEval** | 500 diverse questions, 6 types | 500 | Long-term memory across information extraction, temporal, multi-session |
| **BEAM** | 100 convos per size bucket (1M–10M tokens) | 2000+ | Real-world retrieval across 10 memory ability types |

Mem0's published scores (v3 pipeline, cloud):
- **LongMemEval**: 93.4% (Top 200)
- **LoCoMo**: 91.6% (Top 200)

## Setup

```bash
cd packages/mem0-benchmarks
pip install -r requirements.txt

# Required for answerer/judge LLMs
export OPENAI_API_KEY=sk-your-key

# Sulcus credentials
export SULCUS_API_KEY=your-sulcus-key
# Optional: override server (defaults to https://api.sulcus.ca)
export SULCUS_BASE_URL=https://api.sulcus.ca
```

## Running LoCoMo (Sulcus)

```bash
# Full run — 10 conversations, ~300 questions
python -m benchmarks.locomo.run_sulcus \
    --project-name sulcus-locomo-v1 \
    --sulcus-api-key $SULCUS_API_KEY

# Quick test — 10 questions, ingest+search only (no LLM needed for this phase)
python -m benchmarks.locomo.run_sulcus \
    --project-name sulcus-test \
    --sulcus-api-key $SULCUS_API_KEY \
    --max-questions 10 --predict-only

# Resume a previous run
python -m benchmarks.locomo.run_sulcus \
    --project-name sulcus-locomo-v1 \
    --sulcus-api-key $SULCUS_API_KEY \
    --resume
```

## Running LongMemEval (Sulcus)

```bash
# All 500 questions
python -m benchmarks.longmemeval.run_sulcus \
    --project-name sulcus-lme-v1 \
    --sulcus-api-key $SULCUS_API_KEY \
    --all-questions

# Quick test — 5 per question type (30 total), search only
python -m benchmarks.longmemeval.run_sulcus \
    --project-name sulcus-lme-test \
    --sulcus-api-key $SULCUS_API_KEY \
    --per-type 5 --predict-only

# Specific question types
python -m benchmarks.longmemeval.run_sulcus \
    --project-name sulcus-temporal \
    --sulcus-api-key $SULCUS_API_KEY \
    --question-types temporal-reasoning,knowledge-update
```

## How the Sulcus Adapter Works

`benchmarks/common/sulcus_client.py` is a drop-in replacement for `Mem0Client`.
It implements the same async interface:

| Mem0Client method | Sulcus endpoint | Notes |
|---|---|---|
| `add(messages, user_id)` | `POST /api/v1/agent/nodes` | One node per message turn, with temporal context prefix |
| `search(query, user_id, top_k)` | `POST /api/v1/agent/search` | Returns Mem0-compatible `{memory, score, id}` list |
| `delete_user(user_id)` | `GET + DELETE /api/v1/agent/nodes` | Purges all nodes in the user's namespace |
| `get_user_profile(user_id)` | Stub → `None` | Sulcus doesn't have a user profile endpoint |

**Namespace isolation**: Each benchmark `user_id` maps to a Sulcus namespace
`bench-{sanitized_user_id}` — keeping test data isolated from production memories.

## Result Format

Results are written as `UnifiedResult` JSON (same schema as Mem0's benchmarks):

```
results/sulcus-locomo/
  predicted_sulcus-locomo-v1/
    {run_id}_{project_name}_result.json   # full result with all evaluations
    *.json                                 # per-question checkpoints
```

## Comparing Against Mem0

To run Mem0 as a comparison (requires Mem0 API key):

```bash
# LoCoMo with Mem0 cloud
python -m benchmarks.locomo.run \
    --project-name mem0-locomo-v1 \
    --backend cloud \
    --mem0-api-key $MEM0_API_KEY

# LoCoMo with Sulcus
python -m benchmarks.locomo.run_sulcus \
    --project-name sulcus-locomo-v1 \
    --sulcus-api-key $SULCUS_API_KEY
```

Both produce the same JSON schema — compare `metrics.overall_accuracy` directly.

## Files Added (Sulcus-specific)

| File | Description |
|---|---|
| `benchmarks/common/sulcus_client.py` | Drop-in Sulcus client replacing Mem0Client |
| `benchmarks/locomo/run_sulcus.py` | LoCoMo runner with Sulcus backend |
| `benchmarks/longmemeval/run_sulcus.py` | LongMemEval runner with Sulcus backend |
| `SULCUS_README.md` | This file |

## Notes

- The answerer and judge LLMs must be the same as Mem0's published scores for a fair comparison
- Mem0 uses `gpt-5` (defaulted) — you may need to use `gpt-4o` if `gpt-5` isn't available
- BEAM is supported by the upstream harness but no Sulcus shim yet (large dataset — add when ready)
- LLM costs: LoCoMo full run ≈ $5–15 with gpt-4o as both answerer and judge
