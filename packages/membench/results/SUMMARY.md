# MemBench Benchmark Results

**Date:** 2026-03-16 → 2026-03-17
**Runner:** MemBench v0.1 (20 tasks across 5 categories)
**Machine:** MacBook Pro M4

---

## Latest Results (March 17, post-adapter improvements)

| Adapter | Overall | Recall | Temporal | Contradiction | Multi-Session | Token Efficiency |
|---------|---------|--------|----------|---------------|---------------|-----------------|
| **no-memory** (floor) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| **in-context** (ceiling) | 55.0% | 100.0% | 75.0% | 100.0% | 0.0% | 0.0% |
| **Sulcus** (latest) | **58.5%** | 75.0% | 75.0% | 50.0% | 50.0% | 42.5% |
| **Mem0** (free tier) | 35.0% | 50.0% | 25.0% | 0.0% | 50.0% | 25.0% |
| **Supermemory** (free) | 27.5% | 37.5% | 25.0% | 0.0% | 50.0% | 25.0% |
| **Zep** (latest re-run) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

## ⚠️ FAIRNESS CAVEATS (READ BEFORE CITING)

**These results require validation before any public claims.**

1. **Zep scored 0%** on re-run despite a validated API key. The adapter may be broken or their API changed. Until diagnosed, Zep's score is unreliable.
2. **Mem0 free tier has broken vector search** (`/v2/memories/search/` returns `[]`). We used keyword fallback. This doesn't represent their paid product.
3. **Supermemory** was tested against their free API — not representative of paid tier capabilities.
4. **Sulcus adapter got significant optimization** (broad fetch, recency sort, temporal markers, question-skip). Other adapters did NOT receive equivalent optimization effort. This is an unfair comparison.
5. **Some fail indicators fire on negations** (e.g., "not JavaScript" contains "JavaScript"). This affects ALL adapters but Sulcus's adapter works around it more aggressively.
6. **We wrote the benchmark.** There is inherent bias when the benchmark designer is also a competitor.

## What We Can Honestly Claim

- Sulcus performs well on **recall tasks** (75%) — search returns relevant content
- Sulcus handles **temporal ordering** when given markers (75%)
- The adapter-level intelligence (recency sort, contradiction detection) is genuine capability
- The benchmark framework itself works and covers important memory system dimensions

## What We CANNOT Honestly Claim (Yet)

- "Sulcus beats all competitors" — until all adapters get equal optimization effort
- "Sulcus beats in-context" — many of our wins are adapter cleverness, not engine capability
- Any competitive positioning based on these specific numbers

## Next Steps for Fair Comparison

- [ ] Diagnose Zep adapter — why 0% on re-run?
- [ ] Test Mem0 with a paid tier API key (or confirm free tier limitations documented)
- [ ] Give each competitor adapter the SAME optimization treatment (broad fetch, recency, etc.)
- [ ] Have someone else (not the Sulcus team) review benchmark design for bias
- [ ] Engine-level contradiction memory type (genuine capability, not adapter hack)

## Score Progression (Sulcus adapter iterations)

```
v0: 20.0%  (baseline — naive keyword search)
v1: 30.2%  (multi-session ingestion, scoring fix)
v2: 41.0%  (temporal markers, contradiction detection)
v3: 48.5%  (broad namespace fetch for contradictions)
v4: 56.0%  (recency sort, expanded contradiction keywords)
v5: 58.5%  (temporal sequence ordering, exact_order scoring)
```

---

*Results are internal development metrics. Not for public marketing without fairness validation.*
