"""Needle In A Haystack (NIAH) Evaluator.

Executes context depth matrices across target token horizons,
recording precision, recall, and distractor rejection rates.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from ...adapters.base import BaseAdapter
from .engine import NiahTestCase, build_niah_scenario


@dataclass
class NiahResult:
    test_id: str
    test_type: str
    tokens: int
    depth: float
    score: float  # 0.0 to 1.0
    passed: bool
    latency_ms: int
    expected: list[str]
    retrieved: str
    details: dict[str, Any] = field(default_factory=dict)


def evaluate_niah_case(adapter: BaseAdapter, test_case: NiahTestCase, turns: list[str]) -> NiahResult:
    """Execute a single NIAH test case on an adapter."""
    t0 = time.time()
    adapter.reset()

    # Ingest turns into adapter using bulk batching
    adapter.store_batch(turns, memory_type="episodic")

    # Issue retrieval query
    retrieved = adapter.query(test_case.query, top_k=15)
    latency_ms = int((time.time() - t0) * 1000)

    retrieved_lower = retrieved.lower()

    # Check fail indicators (distractors or admission of failure)
    for fail_text in test_case.fail_indicators:
        if fail_text.lower() in retrieved_lower:
            return NiahResult(
                test_id=test_case.test_id,
                test_type=test_case.test_type,
                tokens=test_case.target_tokens,
                depth=test_case.needles[0].depth_percent if test_case.needles else 0.5,
                score=0.0,
                passed=False,
                latency_ms=latency_ms,
                expected=test_case.expected_values,
                retrieved=retrieved,
                details={"fail_indicator_triggered": fail_text},
            )

    # Check expected value recall
    hits = 0
    missing = []
    for exp in test_case.expected_values:
        if exp.lower() in retrieved_lower:
            hits += 1
        else:
            missing.append(exp)

    score = hits / len(test_case.expected_values) if test_case.expected_values else 0.0
    passed = score >= 0.99

    return NiahResult(
        test_id=test_case.test_id,
        test_type=test_case.test_type,
        tokens=test_case.target_tokens,
        depth=test_case.needles[0].depth_percent if test_case.needles else 0.5,
        score=score,
        passed=passed,
        latency_ms=latency_ms,
        expected=test_case.expected_values,
        retrieved=retrieved,
        details={"hits": hits, "missing": missing},
    )


def run_niah_suite(
    adapter: BaseAdapter,
    token_horizons: list[int] | None = None,
    depths: list[float] | None = None,
    include_multi: bool = True,
    include_adversarial: bool = True,
) -> list[NiahResult]:
    """Run full Google Gemini-style NIAH depth vs context grid."""
    if token_horizons is None:
        token_horizons = [1000, 3000, 6000, 10000]
    if depths is None:
        depths = [0.0, 0.25, 0.50, 0.75, 1.0]

    results: list[NiahResult] = []

    # 1. Single needle matrix (Depth x Tokens)
    for tok in token_horizons:
        for d in depths:
            turns, test_case = build_niah_scenario("single", tok, d)
            res = evaluate_niah_case(adapter, test_case, turns)
            results.append(res)

    # 2. Multi-needle cases
    if include_multi:
        for tok in token_horizons[:2]:  # sample multi across primary token sizes
            turns, test_case = build_niah_scenario("multi", tok, 0.5)
            res = evaluate_niah_case(adapter, test_case, turns)
            results.append(res)

    # 3. Adversarial cases
    if include_adversarial:
        for tok in token_horizons[:2]:
            turns, test_case = build_niah_scenario("adversarial", tok, 0.75)
            res = evaluate_niah_case(adapter, test_case, turns)
            results.append(res)

    return results
