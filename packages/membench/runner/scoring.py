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
    """Score a standard recall/temporal/contradiction/multisession task."""
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

    # Exact matches = full credit (1.0)
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
