"""Evaluator for Google DeepMind Evo-Memory & ReasoningBank."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from ...adapters.base import BaseAdapter
from .tasks import EvoStream, get_evo_memory_streams


@dataclass
class EvoResult:
    stream_id: str
    name: str
    category: str
    score: float
    passed: bool
    latency_ms: int
    expected: list[str]
    retrieved: str
    fail_indicators_hit: list[str] = field(default_factory=list)


def evaluate_evo_stream(adapter: BaseAdapter, stream: EvoStream) -> EvoResult:
    """Execute an Evo-Memory sequential task stream on an adapter."""
    t0 = time.time()
    adapter.reset()

    query_step = None

    for step in stream.steps:
        if step.is_query:
            query_step = step
            break
        else:
            adapter.store(step.content, memory_type="episodic")

    if not query_step:
        return EvoResult(
            stream_id=stream.stream_id,
            name=stream.name,
            category=stream.category,
            score=0.0,
            passed=False,
            latency_ms=0,
            expected=[],
            retrieved="",
        )

    retrieved = adapter.query(query_step.content, top_k=10)
    latency_ms = int((time.time() - t0) * 1000)

    retrieved_lower = retrieved.lower()

    # Check fail indicators
    fails_hit = []
    for fail_text in query_step.fail_indicators:
        if fail_text.lower() in retrieved_lower:
            fails_hit.append(fail_text)

    if fails_hit:
        return EvoResult(
            stream_id=stream.stream_id,
            name=stream.name,
            category=stream.category,
            score=0.0,
            passed=False,
            latency_ms=latency_ms,
            expected=query_step.expected_answer,
            retrieved=retrieved,
            fail_indicators_hit=fails_hit,
        )

    # For abstention, passing means the system didn't hallucinate the unshared key
    if stream.category == "abstention":
        score = 1.0 if not fails_hit else 0.0
        return EvoResult(
            stream_id=stream.stream_id,
            name=stream.name,
            category=stream.category,
            score=score,
            passed=score >= 0.99,
            latency_ms=latency_ms,
            expected=query_step.expected_answer,
            retrieved=retrieved,
        )

    # Check hits on expected keywords
    hits = 0
    for exp in query_step.expected_answer:
        if exp.lower() in retrieved_lower:
            hits += 1

    score = hits / len(query_step.expected_answer) if query_step.expected_answer else 0.0
    passed = score >= 0.65  # partial credit allows >= 65%

    return EvoResult(
        stream_id=stream.stream_id,
        name=stream.name,
        category=stream.category,
        score=score,
        passed=passed,
        latency_ms=latency_ms,
        expected=query_step.expected_answer,
        retrieved=retrieved,
    )


def run_evo_memory_suite(adapter: BaseAdapter) -> list[EvoResult]:
    """Run all Evo-Memory task streams against adapter."""
    streams = get_evo_memory_streams()
    results: list[EvoResult] = []
    for stream in streams:
        res = evaluate_evo_stream(adapter, stream)
        results.append(res)
    return results
