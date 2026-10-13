"""Unified CLI Runner for Google Memory Benchmarks."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

from .adapters.base import BaseAdapter
from .adapters.sulcus_direct import SulcusDirectAdapter
from .adapters.agy_agent import AgyAgentAdapter
from .benchmarks.niah.evaluator import run_niah_suite
from .benchmarks.evo_memory.evaluator import run_evo_memory_suite
from .benchmarks.babilong.evaluator import run_babilong_suite
from .reporting.heatmap import render_niah_heatmap_ascii, render_niah_markdown_table


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Google Memory Benchmark Suite (NIAH, Evo-Memory, BABILong)"
    )
    parser.add_argument(
        "--benchmark",
        choices=["all", "niah", "evo-memory", "babilong"],
        default="all",
        help="Which Google benchmark suite to execute (default: all)",
    )
    parser.add_argument(
        "--adapter",
        choices=["sulcus-direct", "agy-agent"],
        default="sulcus-direct",
        help="Adapter to test (default: sulcus-direct)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("SULCUS_API_KEY", ""),
        help="Sulcus API key for sulcus-direct adapter",
    )
    parser.add_argument(
        "--base-url",
        default="https://api.sulcus.ca",
        help="Sulcus base API URL",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Run quick representative subset",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Path to save output JSON summary",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    print("=" * 65)
    print("  Google Memory Benchmark Suite for AI Agents & Systems")
    print(f"  Benchmark Target: {args.benchmark.upper()}")
    print(f"  Adapter:          {args.adapter}")
    print("=" * 65)

    adapter: BaseAdapter
    if args.adapter == "sulcus-direct":
        if not args.api_key:
            print("Error: --api-key or SULCUS_API_KEY environment variable required for sulcus-direct.")
            sys.exit(1)
        adapter = SulcusDirectAdapter(api_key=args.api_key, base_url=args.base_url)
    elif args.adapter == "agy-agent":
        adapter = AgyAgentAdapter()
    else:
        print(f"Unknown adapter {args.adapter}")
        sys.exit(1)

    all_results: dict[str, Any] = {"adapter": adapter.name, "timestamp": time.time()}

    # ─────────────────────────────────────────────────────────────────────────
    # 1. Google NIAH (Needle in a Haystack)
    # ─────────────────────────────────────────────────────────────────────────
    if args.benchmark in ["all", "niah"]:
        print("\n[1/3] Running Google Multi-Needle in a Haystack (NIAH)...")
        token_sizes = [1000, 3000, 6000] if args.quick else [1000, 3000, 6000, 10000]
        depths = [0.0, 0.5, 1.0] if args.quick else [0.0, 0.25, 0.50, 0.75, 1.0]

        niah_results = run_niah_suite(
            adapter,
            token_horizons=token_sizes,
            depths=depths,
            include_multi=True,
            include_adversarial=True,
        )

        passed_count = sum(1 for r in niah_results if r.passed)
        avg_score = sum(r.score for r in niah_results) / len(niah_results) if niah_results else 0.0

        print(f"NIAH Complete: {passed_count}/{len(niah_results)} passed ({avg_score * 100:.1f}%)")
        print(render_niah_heatmap_ascii(niah_results))

        all_results["niah"] = {
            "total": len(niah_results),
            "passed": passed_count,
            "avg_score": avg_score,
            "results": [
                {
                    "test_id": r.test_id,
                    "tokens": r.tokens,
                    "depth": r.depth,
                    "score": r.score,
                    "passed": r.passed,
                    "latency_ms": r.latency_ms,
                }
                for r in niah_results
            ],
        }

    # ─────────────────────────────────────────────────────────────────────────
    # 2. Google DeepMind Evo-Memory
    # ─────────────────────────────────────────────────────────────────────────
    if args.benchmark in ["all", "evo-memory"]:
        print("\n[2/3] Running Google DeepMind Evo-Memory & Reasoning Streams...")
        evo_results = run_evo_memory_suite(adapter)

        passed_count = sum(1 for r in evo_results if r.passed)
        avg_score = sum(r.score for r in evo_results) / len(evo_results) if evo_results else 0.0

        for r in evo_results:
            status = "✓" if r.passed else "✗"
            print(f"  {status} [{r.category}] {r.name}: score={r.score:.2f} ({r.latency_ms}ms)")

        print(f"Evo-Memory Complete: {passed_count}/{len(evo_results)} passed ({avg_score * 100:.1f}%)")

        all_results["evo_memory"] = {
            "total": len(evo_results),
            "passed": passed_count,
            "avg_score": avg_score,
            "results": [
                {
                    "stream_id": r.stream_id,
                    "name": r.name,
                    "category": r.category,
                    "score": r.score,
                    "passed": r.passed,
                    "latency_ms": r.latency_ms,
                }
                for r in evo_results
            ],
        }

    # ─────────────────────────────────────────────────────────────────────────
    # 3. BABILong Multi-Hop Reasoning
    # ─────────────────────────────────────────────────────────────────────────
    if args.benchmark in ["all", "babilong"]:
        print("\n[3/3] Running BABILong Multi-Hop Reasoning Tasks...")
        babi_results = run_babilong_suite(adapter)

        passed_count = sum(1 for r in babi_results if r.passed)
        avg_score = sum(r.score for r in babi_results) / len(babi_results) if babi_results else 0.0

        for r in babi_results:
            status = "✓" if r.passed else "✗"
            print(f"  {status} [{r.category}] {r.task_name}: score={r.score:.2f} ({r.latency_ms}ms)")

        print(f"BABILong Complete: {passed_count}/{len(babi_results)} passed ({avg_score * 100:.1f}%)")

        all_results["babilong"] = {
            "total": len(babi_results),
            "passed": passed_count,
            "avg_score": avg_score,
            "results": [
                {
                    "task_id": r.task_id,
                    "task_name": r.task_name,
                    "category": r.category,
                    "score": r.score,
                    "passed": r.passed,
                    "latency_ms": r.latency_ms,
                }
                for r in babi_results
            ],
        }

    # Summary
    print("\n" + "=" * 65)
    print("  GOOGLE BENCHMARK SUITE SUMMARY")
    print("=" * 65)
    total_tests = 0
    total_passed = 0
    weighted_scores = []

    for suite_name in ["niah", "evo_memory", "babilong"]:
        if suite_name in all_results:
            s = all_results[suite_name]
            total_tests += s["total"]
            total_passed += s["passed"]
            weighted_scores.append(s["avg_score"])
            print(f"  {suite_name.upper():<15}: {s['passed']:>2}/{s['total']:<2} passed ({s['avg_score'] * 100:>5.1f}%)")

    composite = (sum(weighted_scores) / len(weighted_scores)) * 100 if weighted_scores else 0.0
    print("-" * 65)
    print(f"  COMPOSITE SCORE : {composite:.1f}% ({total_passed}/{total_tests} tasks)")
    print("=" * 65 + "\n")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(all_results, f, indent=2)
        print(f"Results written to {args.output}")


if __name__ == "__main__":
    main()
