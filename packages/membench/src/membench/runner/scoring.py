"""MemBench — Scoring engine.

Handles all scoring logic for benchmark tasks:
- Standard recall (exact match, partial credit, fail indicators)
- Decay quality (weighted high/medium/low fact retention)
"""

from __future__ import annotations

from typing import List, Tuple
from .types import BenchTask, TaskResult, ScoringConfig


def _contains_any(text: str, phrases: List[str]) -> List[str]:
    """Return which phrases from the list appear in text (case-insensitive)."""
    text_lower = text.lower()
    return [p for p in phrases if p.lower() in text_lower]


def score_standard(
    task: BenchTask,
    response: str,
    adapter: str,
    latency_ms: int,
    error: str | None = None,
) -> TaskResult:
    """Score a standard recall/temporal/contradiction/multisession task.

    For efficiency tasks with accuracy.exact, scores proportionally:
    each fact found = 1/N credit (N = total facts expected).
    """
    s = task.scoring
    resp_lower = response.lower()

    if error:
        return TaskResult(
            task_id=task.id, task_name=task.name, category=task.category,
            difficulty=task.difficulty, adapter=adapter, score=0.0,
            raw_score=0.0, max_score=1.0, response=response,
            passed=False, latency_ms=latency_ms, error=error,
        )

    # Fail fast: hard failure indicators override everything
    failed = _contains_any(response, s.fail_indicators)
    if failed:
        return TaskResult(
            task_id=task.id, task_name=task.name, category=task.category,
            difficulty=task.difficulty, adapter=adapter, score=0.0,
            raw_score=0.0, max_score=1.0, response=response,
            passed=False, latency_ms=latency_ms,
            metadata={"fail_indicators_hit": failed},
        )

    # Efficiency tasks with accuracy config: proportional per-fact scoring
    if s.accuracy and isinstance(s.accuracy, dict):
        acc_exact = s.accuracy.get("exact", [])
        acc_max = s.accuracy.get("max_score", len(acc_exact)) or len(acc_exact)
        if acc_exact and acc_max > 0:
            hits = _contains_any(response, acc_exact)
            raw = len(hits)
            score = raw / acc_max

            # Factor in relevance penalty if present
            meta = {"accuracy_hits": hits, "accuracy_total": acc_max}
            if s.relevance and isinstance(s.relevance, dict):
                should_exclude = s.relevance.get("should_exclude", [])
                noise = _contains_any(response, should_exclude)
                if noise:
                    penalty = len(noise) * 0.1  # -10% per noise item
                    score = max(0.0, score - penalty)
                    meta["relevance_noise"] = noise
                    meta["relevance_penalty"] = penalty

            return TaskResult(
                task_id=task.id, task_name=task.name, category=task.category,
                difficulty=task.difficulty, adapter=adapter,
                score=min(score, 1.0),
                raw_score=float(raw), max_score=float(acc_max),
                response=response, passed=score >= 0.5,
                latency_ms=latency_ms, metadata=meta,
            )

    # Ordered sequence check (temporal tasks)
    # Check that items appear in the correct order in the response
    if hasattr(s, '_raw_scoring') and s._raw_scoring and s._raw_scoring.get("exact_order"):
        exact_order = s._raw_scoring["exact_order"]
        resp_lower_stripped = resp_lower
        positions = []
        for item in exact_order:
            pos = resp_lower_stripped.find(item.lower())
            positions.append(pos)
        found = [p >= 0 for p in positions]
        found_count = sum(found)
        if found_count == 0:
            pass  # fall through to partial
        else:
            # Check ordering of found items
            found_positions = [(positions[i], exact_order[i]) for i in range(len(exact_order)) if positions[i] >= 0]
            is_ordered = all(found_positions[i][0] < found_positions[i+1][0] for i in range(len(found_positions)-1))
            score = (found_count / len(exact_order)) * (1.0 if is_ordered else 0.5)
            return TaskResult(
                task_id=task.id, task_name=task.name, category=task.category,
                difficulty=task.difficulty, adapter=adapter, score=score,
                raw_score=float(found_count), max_score=float(len(exact_order)),
                response=response, passed=score >= 0.75,
                latency_ms=latency_ms,
                metadata={"ordered": is_ordered, "found": [e for e, p in zip(exact_order, positions) if p >= 0]},
            )

    # Standard exact matches = full credit (1.0)
    # For recall/temporal/contradiction/multi_session tasks, the exact list
    # contains alternative phrasings of the same answer — any hit = 1.0.
    # Only efficiency tasks (handled above via accuracy.exact) score proportionally.
    exact_hits = _contains_any(response, s.exact)
    if exact_hits:
        return TaskResult(
            task_id=task.id, task_name=task.name, category=task.category,
            difficulty=task.difficulty, adapter=adapter, score=1.0,
            raw_score=1.0, max_score=1.0, response=response,
            passed=True, latency_ms=latency_ms,
            metadata={"exact_hits": exact_hits},
        )

    # Partial matches = 0.5 credit
    partial_hits = _contains_any(response, s.partial)
    if partial_hits:
        return TaskResult(
            task_id=task.id, task_name=task.name, category=task.category,
            difficulty=task.difficulty, adapter=adapter, score=0.5,
            raw_score=0.5, max_score=1.0, response=response,
            passed=False, latency_ms=latency_ms,
            metadata={"partial_hits": partial_hits},
        )

    # No match
    return TaskResult(
        task_id=task.id, task_name=task.name, category=task.category,
        difficulty=task.difficulty, adapter=adapter, score=0.0,
        raw_score=0.0, max_score=1.0, response=response,
        passed=False, latency_ms=latency_ms,
    )


def score_decay(
    task: BenchTask,
    high_retained: List[str],
    medium_retained: List[str],
    low_pruned: List[str],
    response: str,
    adapter: str,
    latency_ms: int,
    error: str | None = None,
) -> TaskResult:
    """Score an efficiency-04 style decay quality task.

    Args:
        high_retained: high-importance facts that were recalled
        medium_retained: medium-importance facts that were recalled
        low_pruned: low-importance facts that were NOT recalled (correctly pruned)
    """
    s = task.scoring
    if error:
        return TaskResult(
            task_id=task.id, task_name=task.name, category=task.category,
            difficulty=task.difficulty, adapter=adapter, score=0.0,
            raw_score=0.0, max_score=float(s.max_score or 1),
            response=response, passed=False, latency_ms=latency_ms, error=error,
        )

    high_w = s.high_retained.get("weight", 3) if s.high_retained else 3
    med_w = s.medium_retained.get("weight", 1) if s.medium_retained else 1
    low_w = s.low_pruned.get("weight", 1) if s.low_pruned else 1

    raw = (
        len(high_retained) * high_w
        + len(medium_retained) * med_w
        + len(low_pruned) * low_w
    )
    max_score = float(s.max_score or 30)
    normalised = min(raw / max_score, 1.0)

    return TaskResult(
        task_id=task.id, task_name=task.name, category=task.category,
        difficulty=task.difficulty, adapter=adapter, score=normalised,
        raw_score=float(raw), max_score=max_score, response=response,
        passed=normalised >= 0.6, latency_ms=latency_ms,
        metadata={
            "high_retained": high_retained,
            "medium_retained": medium_retained,
            "low_pruned": low_pruned,
        },
    )
