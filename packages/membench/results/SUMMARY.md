# MemBench Benchmark Results

**Last Updated:** 2026-05-03 (Task 73 — competitor adapter fixes)
**Runner:** MemBench v0.1 (20 tasks across 5 categories)

---

## Benchmark Results (May 2, 2026 — server v2.13.0)

> **Historical:** These results were recorded against server v2.13.0. Current server is v2.25.2.
> Re-running benchmarks against the latest server is recommended for up-to-date comparisons.

| Adapter | Overall | Recall | Temporal | Contradiction | Multi-Session | Token Efficiency |
|---------|---------|--------|----------|---------------|---------------|-----------------|
| **no-memory** (floor) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| **in-context** (ceiling) | 55.0% | 100.0% | 75.0% | 100.0% | 0.0% | 0.0% |
| **Sulcus v2.13.0** (latest) | **64.5%** | 75.0% | 62.5% | 50.0% | 75.0% | 60.0% |

### vs March 2026 baseline (server v2.11.0)

| Category | March | May | Delta |
|----------|-------|-----|-------|
| Overall | 58.5% | 64.5% | **+6.0%** ✅ |
| Multi-Session | 50.0% | 75.0% | **+25.0%** ✅ |
| Token Efficiency | 42.5% | 60.0% | **+17.5%** ✅ |
| Recall | 75.0% | 75.0% | 0.0% — |
| Contradiction | 50.0% | 50.0% | 0.0% — |
| Temporal | 75.0% | 62.5% | -12.5% ⚠️ |

### Key improvements driving the +6pt gain
- **Multi-session +25pts**: Server v2.13.0 improvements — FTS/BM25 fusion recall, type-aware heat weights, better graph traversal
- **Token efficiency +17.5pts**: FTS text scoring + improved relevance filtering
- **Temporal regression -12.5pts**: Within run variance (was also inconsistent in March); recommend re-running 3x for stable signal

---

## Historical Score Progression (Sulcus)

```
March 2026 v0: 20.0%  (baseline — naive keyword search)
March 2026 v1: 30.2%  (multi-session ingestion, scoring fix)
March 2026 v2: 41.0%  (temporal markers, contradiction detection)
March 2026 v3: 48.5%  (broad namespace fetch for contradictions)
March 2026 v4: 56.0%  (recency sort, expanded contradiction keywords)
March 2026 v5: 58.5%  (temporal sequence ordering, exact_order scoring)
May 2026 v6:   64.5%  (server v2.13.0: FTS fusion, type-aware scoring; adapter contradiction fix)
```

---

---

## Task 73 — Competitor Adapter Fixes (2026-05-03)

**Status:** Adapters fixed. Live re-run blocked on paid API credentials (Mem0 Pro+, Zep Cloud).

### What Was Fixed

**Zep adapter (`zep_adapter.py`) — root cause of 0% failure diagnosed:**
- `_extract_messages()` used a hardcoded absolute macOS path
  (`packages/membench/tasks/*.json`) for multi-session task loading.
  This path doesn't exist in CI or any non-dev environment — multi-session tasks received
  empty message lists and scored 0. Fix: use `task._raw` directly (BenchTask stores the full
  JSON dict via `_raw=d` in `from_dict()`). Same approach already used by sulcus_adapter.
- Added `_is_contradiction_query()` + 2-sentence excerpt extraction for contradiction tasks.
  Matches the sulcus_adapter fix from Task 72 for a level playing field.

**Mem0 adapter (`mem0_adapter.py`) — parity improvements:**
- `_extract_messages()`: same `_load_task_file` hardcoded path bug — replaced with `task._raw` access.
- Added `_is_contradiction_query()` — recency sort (by `created_at` DESC) + 2-sentence excerpt
  for contradiction/current-state queries. Previously returned all memories in default API order,
  which on free tier (get_all fallback) was insertion order, not recency.
- Updated docstring to distinguish Hobby vs Pro+ tier behaviour: paid tier has working vector search;
  free tier falls back to get_all + local keyword matching.

### Why Paid Credentials Are Required

- **Mem0 Hobby tier:** vector search (`/v2/memories/search/`) returns `[]` consistently.
  Free tier results relied on local keyword matching as fallback. To get true vector search
  performance (the feature Mem0 actually markets), a Pro+ subscription is needed.
- **Zep Cloud:** API key required; no free tier available.
- **These are blocking.** We cannot produce a fair competitor score without live API access.

### Expected Impact (estimate, pending live run)

With adapter fixes applied:
- **Zep:** Multi-session tasks should now ingest correctly (was 0 messages ingested). Expected
  score to recover from 0% to somewhere in the 40-65% range depending on graph API accuracy.
- **Mem0 (Hobby):** Contradiction path now returns recency-sorted + excerpted results.
  Likely improvement on contradiction category (was 25-50%, should approach 75%+).
- **Mem0 (Pro+):** With working vector search, recall scores should be significantly better.
  No estimate without actual run.

---

## ⚠️ FAIRNESS CAVEATS (READ BEFORE CITING)

**These results require validation before any public claims.**

1. **We wrote the benchmark.** There is inherent bias when the benchmark designer is also a competitor. External review needed.
2. **Competitor adapters fixed but not re-run** — Mem0/Zep adapter bugs fixed (Task 73), but live re-run requires paid API credentials. Scores below for those systems reflect pre-fix runs.
3. **Sulcus adapter optimization** — The contradiction path was improved (first 2 sentences, not full turn content). Equivalent optimization now applied to all adapters.
4. **Temporal regression (-12.5pts)** — Within run variance based on March consistency. Recommend 3 runs for stable temporal score.
5. **No LLM synthesis** — Sulcus adapter returns raw memory content, not synthesized answers. Contradiction-02 and -03 require multi-fact synthesis which our adapter cannot do without an LLM call.

## What We Can Honestly Claim

- Sulcus **beats the in-context ceiling** (55%) by **9.5 percentage points** — genuine persistent memory advantage
- **Multi-session recall is genuinely better** (75% vs 50%) — server improvements are measurable
- **64.5%** with pure retrieval (no LLM synthesis) — substantial headroom as adapter matures
- The benchmark framework itself works and measures real capabilities
- **Competitor adapter bugs are now fixed** — next run will be the first fair comparison

## What We CANNOT Honestly Claim (Yet)

- "Sulcus beats all competitors" — competitor adapters now fixed but not yet re-run with paid APIs
- The specific temporal score (±12.5% variance between runs)
- Any externally-validated competitive claims

## Next Steps for Fair Comparison

- [x] Fix Zep adapter 0% failure (Task 73 — hardcoded path bug, contradiction path)
- [x] Fix Mem0 adapter multi-session bug + add recency sort + contradiction excerpt (Task 73)
- [ ] Re-test Mem0 on paid tier with fixed adapter (Mem0 Pro+ API key needed)
- [ ] Re-test Zep Cloud with fixed adapter (Zep API key needed)
- [ ] Run each adapter 3x and report mean ± stddev
- [ ] External review of benchmark design for bias

---

*Results are internal development metrics. Not for public marketing without fairness validation.*
