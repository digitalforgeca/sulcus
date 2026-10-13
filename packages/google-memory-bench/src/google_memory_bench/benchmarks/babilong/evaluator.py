"""Evaluator for BABILong Multi-Hop Reasoning Benchmark."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from ...adapters.base import BaseAdapter
from .tasks import BabiTask, get_babilong_tasks


@dataclass
class BabiResult:
    task_id: str
    task_name: str
    category: str
    score: float
    passed: bool
    latency_ms: int
    expected: list[str]
    retrieved: str


def evaluate_babi_task(adapter: BaseAdapter, task: BabiTask) -> BabiResult:
    """Execute a BABILong task on an adapter."""
    t0 = time.time()
    adapter.reset()

    # Store story facts
    adapter.store_batch(task.story_facts, memory_type="episodic")

    # Issue reasoning question
    retrieved = adapter.query(task.question, top_k=10)
    latency_ms = int((time.time() - t0) * 1000)

    retrieved_lower = retrieved.lower()

    # Check for expected answers
    hits = sum(1 for exp in task.expected_answer if exp.lower() in retrieved_lower)
    score = 1.0 if hits > 0 else 0.0

    return BabiResult(
        task_id=task.task_id,
        task_name=task.task_name,
        category=task.category,
        score=score,
        passed=score >= 0.99,
        latency_ms=latency_ms,
        expected=task.expected_answer,
        retrieved=retrieved,
    )


def run_babilong_suite(adapter: BaseAdapter) -> list[BabiResult]:
    """Run BABILong suite against an adapter."""
    tasks = get_babilong_tasks()
    results: list[BabiResult] = []
    for t in tasks:
        res = evaluate_babi_task(adapter, t)
        results.append(res)
    return results
