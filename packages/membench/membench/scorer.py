"""Scoring logic for MemBench tasks."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class TaskScore:
    """Score for a single task."""
    task_id: str
    category: str
    task_name: str
    accuracy: float  # 0.0 - 1.0
    efficiency: float  # 0.0 - 1.0 (1.0 = optimal context usage)
    latency_ms: float
    context_bytes: int
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def composite(self) -> float:
        """Weighted composite score: 60% accuracy, 30% efficiency, 10% latency."""
        latency_score = max(0, 1.0 - (self.latency_ms / 5000))  # 5s = 0 score
        return (0.6 * self.accuracy) + (0.3 * self.efficiency) + (0.1 * latency_score)


def score_recall(response: str, scoring: dict[str, Any]) -> float:
    """Score a recall task based on exact/partial matches."""
    response_lower = response.lower()
    exact_matches = scoring.get("exact", [])
    partial_matches = scoring.get("partial", [])
    fail_indicators = scoring.get("fail_indicators", [])

    # Check for fail indicators first
    for fail in fail_indicators:
        if fail.lower() in response_lower:
            return 0.0

    # Check exact matches (each worth equal share of 1.0)
    if exact_matches:
        hits = sum(1 for e in exact_matches if e.lower() in response_lower)
        exact_score = hits / len(exact_matches)
    else:
        exact_score = 0.0

    # Partial matches boost the score but can't exceed 1.0
    if partial_matches and exact_score < 1.0:
        partial_hits = sum(1 for p in partial_matches if p.lower() in response_lower)
        partial_bonus = (partial_hits / len(partial_matches)) * 0.3
        return min(1.0, exact_score + partial_bonus)

    return exact_score


def score_temporal(response: str, scoring: dict[str, Any]) -> float:
    """Score temporal reasoning tasks."""
    response_lower = response.lower()

    # Check exact order if specified
    exact_order = scoring.get("exact_order", [])
    if exact_order:
        positions = []
        for item in exact_order:
            pos = response_lower.find(item.lower())
            if pos == -1:
                return 0.0  # Missing item = fail
            positions.append(pos)
        # Check if positions are in ascending order
        if positions == sorted(positions):
            return 1.0
        else:
            return 0.3  # Items present but wrong order

    # Fall back to standard recall scoring
    return score_recall(response, scoring)


def score_contradiction(response: str, scoring: dict[str, Any]) -> float:
    """Score contradiction resolution tasks."""
    response_lower = response.lower()

    # Check for fail indicators (old/stale information)
    fail_indicators = scoring.get("fail_indicators", [])
    for fail in fail_indicators:
        if fail.lower() in response_lower:
            # Mentioning old info as historical context is OK,
            # but presenting it as current is a fail.
            # Simple heuristic: if exact match is also present, it's context.
            exact = scoring.get("exact", [])
            has_correct = any(e.lower() in response_lower for e in exact)
            if not has_correct:
                return 0.0

    return score_recall(response, scoring)


def score_efficiency(context_bytes: int, scoring: dict[str, Any]) -> float:
    """Score token efficiency."""
    eff = scoring.get("efficiency", {})
    ideal = eff.get("ideal", 500)
    acceptable = eff.get("acceptable", 2000)
    wasteful = eff.get("wasteful", 10000)

    if context_bytes <= ideal:
        return 1.0
    elif context_bytes <= acceptable:
        return 0.7 + 0.3 * (1 - (context_bytes - ideal) / (acceptable - ideal))
    elif context_bytes <= wasteful:
        return 0.3 * (1 - (context_bytes - acceptable) / (wasteful - acceptable))
    else:
        return 0.0
