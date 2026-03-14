"""MemBench — Core benchmark runner.

Usage:
    python -m membench.runner.runner --adapter sulcus --api-key sk-... --tasks tasks/
    python -m membench.runner.runner --adapter in-context --tasks tasks/ --output results/
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

from .types import BenchTask, BenchReport, TaskResult
from .scoring import score_standard

# ─── Adapter Registry ────────────────────────────────────────────────────────
# Each adapter module registers itself here.
_ADAPTERS: Dict[str, str] = {
    "sulcus":       "membench.adapters.sulcus_adapter",
    "in-context":   "membench.adapters.in_context_adapter",
    "openai":       "membench.adapters.openai_adapter",
    "mem0":         "membench.adapters.mem0_adapter",
    "zep":          "membench.adapters.zep_adapter",
    "no-memory":    "membench.adapters.no_memory_adapter",
}


def load_tasks(tasks_dir: str) -> List[BenchTask]:
    """Load all .json task files from a directory."""
    tasks = []
    p = Path(tasks_dir)
    for f in sorted(p.glob("*.json")):
        try:
            with open(f) as fh:
                d = json.load(fh)
            tasks.append(BenchTask.from_dict(d))
        except Exception as e:
            print(f"[WARN] Could not load {f}: {e}", file=sys.stderr)
    return tasks


def load_adapter(name: str):
    """Dynamically import and return an adapter instance."""
    if name not in _ADAPTERS:
        raise ValueError(
            f"Unknown adapter '{name}'. Available: {', '.join(_ADAPTERS)}"
        )
    import importlib
    module = importlib.import_module(_ADAPTERS[name])
    return module.Adapter


def run_benchmark(
    adapter_class,
    tasks: List[BenchTask],
    adapter_kwargs: Dict,
) -> BenchReport:
    """Run all tasks against a given adapter and return a BenchReport."""
    adapter_name = adapter_kwargs.get("name", adapter_class.__name__)
    adapter = adapter_class(**{k: v for k, v in adapter_kwargs.items() if k != "name"})

    results: List[TaskResult] = []
    start_wall = time.time()

    for i, task in enumerate(tasks):
        print(f"  [{i+1:2d}/{len(tasks)}] {task.id}: {task.name}...", end=" ", flush=True)
        t0 = time.time()
        try:
            result = adapter.run_task(task)
        except Exception as e:
            latency = int((time.time() - t0) * 1000)
            result = TaskResult(
                task_id=task.id, task_name=task.name,
                category=task.category, difficulty=task.difficulty,
                adapter=adapter_name, score=0.0, raw_score=0.0,
                max_score=1.0, response="", passed=False,
                latency_ms=latency, error=str(e),
            )

        icon = "✓" if result.passed else ("~" if result.score > 0 else "✗")
        print(f"{icon} ({result.score:.2f}, {result.latency_ms}ms)")
        results.append(result)

    elapsed_ms = int((time.time() - start_wall) * 1000)

    # Aggregate
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    overall = sum(r.score for r in results) / total if total else 0.0

    # Per-category
    cats: Dict[str, List[float]] = {}
    for r in results:
        cats.setdefault(r.category, []).append(r.score)
    cat_scores = {c: sum(s) / len(s) for c, s in cats.items()}

    # Per-difficulty
    diffs: Dict[str, List[float]] = {}
    for r in results:
        diffs.setdefault(r.difficulty, []).append(r.score)
    diff_scores = {d: sum(s) / len(s) for d, s in diffs.items()}

    return BenchReport(
        adapter=adapter_name,
        total_tasks=total,
        passed=passed,
        failed=total - passed,
        overall_score=overall,
        category_scores=cat_scores,
        difficulty_scores=diff_scores,
        results=results,
        elapsed_ms=elapsed_ms,
    )


def print_report(report: BenchReport):
    """Print a formatted benchmark report."""
    print("\n" + "=" * 60)
    print(f"  MemBench Results — {report.adapter}")
    print("=" * 60)
    print(f"  Overall score:   {report.overall_score:.1%}")
    print(f"  Tasks passed:    {report.passed}/{report.total_tasks}")
    print(f"  Total time:      {report.elapsed_ms / 1000:.1f}s")
    print()

    print("  By category:")
    for cat, score in sorted(report.category_scores.items()):
        bar = "█" * int(score * 20) + "░" * (20 - int(score * 20))
        print(f"    {cat:<20} {bar} {score:.1%}")

    print()
    print("  By difficulty:")
    for diff, score in sorted(report.difficulty_scores.items()):
        print(f"    {diff:<12} {score:.1%}")

    if any(r.error for r in report.results):
        print()
        print("  Errors:")
        for r in report.results:
            if r.error:
                print(f"    {r.task_id}: {r.error}")
    print("=" * 60)


def save_report(report: BenchReport, output_dir: str):
    """Save report as JSON to the output directory."""
    import dataclasses
    p = Path(output_dir)
    p.mkdir(parents=True, exist_ok=True)
    ts = int(time.time())
    fname = p / f"{report.adapter}_{ts}.json"
    with open(fname, "w") as f:
        json.dump(dataclasses.asdict(report), f, indent=2)
    print(f"\n  Saved: {fname}")


def main():
    parser = argparse.ArgumentParser(
        description="MemBench — Open Memory Benchmark",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run Sulcus adapter
  python -m membench --adapter sulcus --api-key sk-... --base-url https://server.sulcus.dforge.ca

  # Run in-context baseline (no memory system)
  python -m membench --adapter in-context

  # Run no-memory baseline
  python -m membench --adapter no-memory

  # Save results
  python -m membench --adapter sulcus --api-key sk-... --output results/
        """,
    )
    parser.add_argument("--adapter", default="in-context",
                        choices=list(_ADAPTERS.keys()),
                        help="Memory adapter to benchmark")
    parser.add_argument("--tasks", default="tasks/",
                        help="Directory containing task JSON files")
    parser.add_argument("--output", default=None,
                        help="Directory to save JSON report")
    parser.add_argument("--api-key", default=None,
                        help="API key for the memory system")
    parser.add_argument("--base-url", default=None,
                        help="Base URL for the memory system")
    parser.add_argument("--categories", nargs="+", default=None,
                        help="Filter to specific categories")
    parser.add_argument("--difficulty", default=None,
                        choices=["easy", "medium", "hard"],
                        help="Filter to specific difficulty")
    args = parser.parse_args()

    # Load tasks
    print(f"\nLoading tasks from {args.tasks}...")
    tasks = load_tasks(args.tasks)
    if not tasks:
        print("No tasks found!", file=sys.stderr)
        sys.exit(1)

    # Filter
    if args.categories:
        tasks = [t for t in tasks if t.category in args.categories]
    if args.difficulty:
        tasks = [t for t in tasks if t.difficulty == args.difficulty]

    print(f"Loaded {len(tasks)} tasks")

    # Load adapter
    adapter_class = load_adapter(args.adapter)
    adapter_kwargs = {"name": args.adapter}
    if args.api_key:
        adapter_kwargs["api_key"] = args.api_key
    if args.base_url:
        adapter_kwargs["base_url"] = args.base_url

    # Run
    print(f"\nRunning MemBench with adapter: {args.adapter}\n")
    report = run_benchmark(adapter_class, tasks, adapter_kwargs)

    print_report(report)

    if args.output:
        save_report(report, args.output)


if __name__ == "__main__":
    main()
