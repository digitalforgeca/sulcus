"""MemBench runner — loads tasks, runs adapters, produces scored results."""

from __future__ import annotations

import json
import os
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .adapter import MemoryAdapter, Message, MemoryStats
from .scorer import TaskScore, score_recall, score_temporal, score_contradiction, score_efficiency


TASKS_DIR = Path(__file__).parent.parent / "tasks"

CATEGORY_SCORERS = {
    "recall": score_recall,
    "temporal": score_temporal,
    "contradiction": score_contradiction,
    "multi_session": score_recall,  # multi-session uses recall scoring on the final query
    "token_efficiency": score_recall,  # accuracy part; efficiency scored separately
}


def load_tasks(category: str | None = None) -> list[dict[str, Any]]:
    """Load task definitions from JSON files."""
    tasks = []
    for f in sorted(TASKS_DIR.glob("*.json")):
        with open(f) as fh:
            task = json.load(fh)
            if category is None or task.get("category") == category:
                tasks.append(task)
    return tasks


def run_single_task(adapter: MemoryAdapter, task: dict[str, Any]) -> TaskScore:
    """Run a single task against an adapter and return the score."""
    adapter.reset()

    category = task["category"]

    # Ingest conversation
    if "sessions" in task:
        # Multi-session task
        for session in task["sessions"]:
            messages = [
                Message(
                    role=m["role"],
                    content=m["content"],
                    session_id=session["session_id"],
                )
                for m in session.get("conversation", [])
            ]
            if messages:
                adapter.ingest(messages)
            adapter.end_session()
    elif "conversation" in task:
        messages = [Message(role=m["role"], content=m["content"]) for m in task["conversation"]]
        adapter.ingest(messages)

    # Run decay if specified
    decay_cycles = task.get("decay_cycles", 0)
    if decay_cycles > 0:
        adapter.decay(decay_cycles)

    # Query
    query = task.get("query", "")
    t0 = time.monotonic()
    response = adapter.query(query)
    latency_ms = (time.monotonic() - t0) * 1000

    # Get stats
    stats = adapter.get_stats()

    # Score accuracy
    scoring = task.get("scoring", {})
    scorer_fn = CATEGORY_SCORERS.get(category, score_recall)
    accuracy = scorer_fn(response, scoring)

    # Score efficiency
    if category == "token_efficiency":
        efficiency = score_efficiency(stats.context_bytes, scoring)
    else:
        # For non-efficiency tasks, use a simple penalty for excessive context
        # Anything under 5KB is fine, linear penalty up to 50KB
        if stats.context_bytes <= 5000:
            efficiency = 1.0
        elif stats.context_bytes <= 50000:
            efficiency = 1.0 - ((stats.context_bytes - 5000) / 45000) * 0.7
        else:
            efficiency = 0.3

    return TaskScore(
        task_id=task["id"],
        category=category,
        task_name=task.get("name", task["id"]),
        accuracy=accuracy,
        efficiency=efficiency,
        latency_ms=latency_ms,
        context_bytes=stats.context_bytes,
        details={
            "response": response[:500],  # Truncate for reporting
            "expected": task.get("expected", ""),
            "node_count": stats.node_count,
        },
    )


def run_benchmark(
    adapter: MemoryAdapter,
    category: str | None = None,
    output_path: str | None = None,
) -> dict[str, Any]:
    """Run the full benchmark suite against an adapter.

    Returns a results dict with per-task scores and aggregate metrics.
    """
    tasks = load_tasks(category)
    scores: list[TaskScore] = []

    for task in tasks:
        try:
            score = run_single_task(adapter, task)
            scores.append(score)
            print(f"  ✓ {task['id']:30s}  acc={score.accuracy:.2f}  eff={score.efficiency:.2f}  {score.latency_ms:.0f}ms")
        except Exception as e:
            print(f"  ✗ {task['id']:30s}  ERROR: {e}")
            scores.append(TaskScore(
                task_id=task["id"],
                category=task.get("category", "unknown"),
                task_name=task.get("name", ""),
                accuracy=0.0,
                efficiency=0.0,
                latency_ms=0.0,
                context_bytes=0,
                details={"error": str(e)},
            ))

    # Aggregate
    if scores:
        avg_accuracy = sum(s.accuracy for s in scores) / len(scores)
        avg_efficiency = sum(s.efficiency for s in scores) / len(scores)
        avg_latency = sum(s.latency_ms for s in scores) / len(scores)
        composite = sum(s.composite for s in scores) / len(scores)
    else:
        avg_accuracy = avg_efficiency = avg_latency = composite = 0.0

    # Per-category aggregates
    categories: dict[str, list[TaskScore]] = {}
    for s in scores:
        categories.setdefault(s.category, []).append(s)

    category_scores = {}
    for cat, cat_scores in categories.items():
        category_scores[cat] = {
            "accuracy": sum(s.accuracy for s in cat_scores) / len(cat_scores),
            "efficiency": sum(s.efficiency for s in cat_scores) / len(cat_scores),
            "composite": sum(s.composite for s in cat_scores) / len(cat_scores),
            "count": len(cat_scores),
        }

    result = {
        "system": adapter.name,
        "version": adapter.version,
        "membench_version": "0.1.0",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": {
            "accuracy": round(avg_accuracy, 4),
            "efficiency": round(avg_efficiency, 4),
            "latency_ms": round(avg_latency, 1),
            "composite": round(composite, 4),
            "tasks_run": len(scores),
            "tasks_passed": sum(1 for s in scores if s.accuracy > 0.5),
        },
        "categories": category_scores,
        "tasks": [asdict(s) for s in scores],
    }

    if output_path:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(result, f, indent=2, default=str)
        print(f"\nResults written to {output_path}")

    return result
