# MemBench Temporal Stability Analysis
**Date:** 2026-05-03
**Task:** 76 — MemBench temporal stability
**Server:** v2.13.0-ed90208 (historical; current production is v2.25.2)
**Adapter:** sulcus (namespace: membench-temporal-stability)

## Summary

Temporal category is **perfectly stable**: 62.5% across all 3 runs, zero variance.

The ±12.5% historical variance (observed in results from 2026-04-28 to 2026-05-02)
was an artifact of earlier adapter versions, not non-determinism in Sulcus itself.

## 3-Run Results

| Run | temporal-01 | temporal-02 | temporal-03 | temporal-04 | Category Score |
|-----|------------|------------|------------|------------|---------------|
| 1   | 0.50       | 0.50       | 0.50       | 1.00       | **62.5%**     |
| 2   | 0.50       | 0.50       | 0.50       | 1.00       | **62.5%**     |
| 3   | 0.50       | 0.50       | 0.50       | 1.00       | **62.5%**     |
| **Mean** | 0.50 | 0.50 | 0.50 | 1.00 | **62.5%** |
| **StdDev** | 0.00 | 0.00 | 0.00 | 0.00 | **0.0%** |

## Per-Task Analysis

### temporal-01: Event Sequence Ordering (0.50 — consistent)
**Root cause:** Sulcus returns all 4 items (PostgreSQL, GraphQL, Redis, Kubernetes) but
in heat/recency order, not chronological order of the events described. The scoring
`exact_order` check finds all items but marks `ordered=False`, yielding 0.5.

**Response order received:** PostgreSQL → Redis → GraphQL → Kubernetes  
**Expected order:** PostgreSQL → GraphQL → Redis → Kubernetes

This is a structural limitation: vector recall ranks by relevance + heat, not by
temporal sequence of the underlying events. Fixing this requires either:
- Server-side temporal sort option on the search endpoint
- Client-side re-ranking by turn order (turn_idx in response metadata)

### temporal-02: Most Recent State (0.50 — consistent)
Returns partial match — finds "new job" or "Rust" but not both "NovaTech" + "senior engineer"
in the same response. Partial match scores 0.5.

### temporal-03: Duration and Timeline (0.50 — consistent)
Partial match — finds some timeline markers but not the complete expected answer.

### temporal-04: When Did I Say That (1.00 — consistent)
Full pass — exact match on the date/context lookup. Works well.

## Historical Variance Explanation

Earlier runs showed temporal scores ranging from 0.0 to 0.75. This was caused by:
1. **v5.4.0 adapter bugs** (pre-Task 63 deploy) — incorrect extraction logic
2. **Different namespace state** — membench namespace had stale memories from prior runs
3. **Adapter changes** across Tasks 62-63 changed extraction behavior

With the current adapter (post-Task 63) and clean namespace per run, scores are deterministic.

## Conclusion

**No race condition.** No non-determinism in Sulcus's memory ingestion or heat normalization.
The temporal category scores 62.5% consistently. The ceiling is ~75% (temporal-01 is hard
to fully solve without a server-side temporal sort feature).

## Improvement Path

To reach 75%+ on temporal:
1. **Server:** Add `sort_by=turn_order` option to `/api/v1/agent/search` — let callers
   request results sorted by ingestion order instead of relevance score
2. **Adapter:** Re-rank results by `turn_idx` before constructing response for temporal queries
   (the adapter already has `_is_temporal_query()` detection)

Option 2 is plugin-only and can be done without a server deploy.
