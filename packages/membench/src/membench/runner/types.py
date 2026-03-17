"""MemBench — Type definitions shared across runner and adapters."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ConversationTurn:
    role: str  # 'user' | 'assistant'
    content: str


@dataclass
class ScoringConfig:
    exact: List[str] = field(default_factory=list)
    partial: List[str] = field(default_factory=list)
    fail_indicators: List[str] = field(default_factory=list)

    # For decay tasks
    high_retained: Optional[Dict[str, Any]] = None
    medium_retained: Optional[Dict[str, Any]] = None
    low_pruned: Optional[Dict[str, Any]] = None
    max_score: Optional[int] = None

    # For efficiency tasks — nested scoring
    accuracy: Optional[Dict[str, Any]] = None
    efficiency: Optional[Dict[str, Any]] = None
    relevance: Optional[Dict[str, Any]] = None
    growth_rate: Optional[Dict[str, Any]] = None


@dataclass
class BenchTask:
    id: str
    category: str
    name: str
    description: str
    difficulty: str
    query: str
    expected: str
    scoring: ScoringConfig
    conversation: List[ConversationTurn] = field(default_factory=list)

    # Decay-specific fields
    facts: Optional[Dict[str, List[str]]] = None
    decay_cycles: Optional[int] = None
    note: Optional[str] = None

    # Raw dict for adapter access to non-standard fields (key_facts, etc.)
    _raw: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "BenchTask":
        scoring_raw = d.get("scoring", {})

        # Efficiency tasks nest exact matches under scoring.accuracy.exact
        accuracy = scoring_raw.get("accuracy")
        exact = scoring_raw.get("exact", [])
        if not exact and accuracy and isinstance(accuracy, dict):
            exact = accuracy.get("exact", [])

        scoring = ScoringConfig(
            exact=exact,
            partial=scoring_raw.get("partial", []),
            fail_indicators=scoring_raw.get("fail_indicators", []),
            high_retained=scoring_raw.get("high_retained"),
            medium_retained=scoring_raw.get("medium_retained"),
            low_pruned=scoring_raw.get("low_pruned"),
            max_score=scoring_raw.get("max_score"),
            accuracy=accuracy,
            efficiency=scoring_raw.get("efficiency"),
            relevance=scoring_raw.get("relevance"),
            growth_rate=scoring_raw.get("growth_rate"),
        )
        turns = [
            ConversationTurn(role=t["role"], content=t["content"])
            for t in d.get("conversation", [])
        ]
        return cls(
            id=d["id"],
            category=d["category"],
            name=d["name"],
            description=d["description"],
            difficulty=d.get("difficulty", "medium"),
            query=d["query"],
            expected=d.get("expected", ""),
            scoring=scoring,
            conversation=turns,
            facts=d.get("facts"),
            decay_cycles=d.get("decay_cycles"),
            note=d.get("note"),
            _raw=d,
        )


@dataclass
class TaskResult:
    task_id: str
    task_name: str
    category: str
    difficulty: str
    adapter: str
    score: float          # 0.0 – 1.0
    raw_score: float      # adapter-specific score before normalisation
    max_score: float
    response: str         # raw response from the memory system
    passed: bool
    latency_ms: int
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BenchReport:
    adapter: str
    total_tasks: int
    passed: int
    failed: int
    overall_score: float    # 0.0 – 1.0
    category_scores: Dict[str, float]
    difficulty_scores: Dict[str, float]
    results: List[TaskResult]
    elapsed_ms: int
