"""MemBench CLI — run benchmarks from the command line.

Usage:
    membench run --adapter sulcus --output results/sulcus.json
    membench run --adapter mem0 --category recall
    membench run --adapter baseline
    membench compare results/*.json --output report.html
    membench list
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .runner import run_benchmark, load_tasks


def get_adapter(name: str):
    """Load an adapter by name."""
    if name == "sulcus":
        from .adapters.sulcus_adapter import SulcusAdapter
        return SulcusAdapter()
    elif name == "baseline":
        from .adapters.baseline_adapter import BaselineAdapter
        return BaselineAdapter()
    elif name == "mem0":
        from .adapters.mem0_adapter import Mem0Adapter
        return Mem0Adapter()
    elif name == "zep":
        from .adapters.zep_adapter import ZepAdapter
        return ZepAdapter()
    elif name == "langchain-buffer":
        from .adapters.langchain_adapter import LangChainBufferAdapter
        return LangChainBufferAdapter()
    elif name == "langchain-summary":
        from .adapters.langchain_adapter import LangChainSummaryAdapter
        return LangChainSummaryAdapter()
    else:
        print(f"Unknown adapter: {name}")
        print("Available: sulcus, baseline, mem0, zep, langchain-buffer, langchain-summary")
        sys.exit(1)


def cmd_run(args):
    """Run benchmark."""
    adapter = get_adapter(args.adapter)
    print(f"MemBench v0.1.0 — {adapter.name} v{adapter.version}")
    print(f"{'=' * 60}")

    result = run_benchmark(
        adapter,
        category=args.category,
        output_path=args.output,
    )

    print(f"\n{'=' * 60}")
    print(f"RESULTS: {adapter.name}")
    print(f"  Composite:  {result['summary']['composite']:.4f}")
    print(f"  Accuracy:   {result['summary']['accuracy']:.4f}")
    print(f"  Efficiency: {result['summary']['efficiency']:.4f}")
    print(f"  Latency:    {result['summary']['latency_ms']:.1f}ms avg")
    print(f"  Passed:     {result['summary']['tasks_passed']}/{result['summary']['tasks_run']}")

    if result["categories"]:
        print(f"\nPer-category:")
        for cat, scores in result["categories"].items():
            print(f"  {cat:20s}  acc={scores['accuracy']:.2f}  eff={scores['efficiency']:.2f}  composite={scores['composite']:.2f}")


def cmd_list(args):
    """List available tasks."""
    tasks = load_tasks(args.category)
    print(f"MemBench v0.1.0 — {len(tasks)} tasks")
    print(f"{'=' * 60}")
    for t in tasks:
        diff = t.get("difficulty", "?")
        print(f"  [{t['category']:18s}] {t['id']:25s} ({diff}) — {t.get('name', '')}")


def cmd_compare(args):
    """Compare results from multiple runs."""
    results = []
    for f in args.files:
        with open(f) as fh:
            results.append(json.load(fh))

    if not results:
        print("No result files provided.")
        return

    print(f"MemBench Comparison — {len(results)} systems")
    print(f"{'=' * 80}")

    # Header
    names = [r["system"] for r in results]
    header = f"{'Category':<20s}" + "".join(f"{n:>15s}" for n in names)
    print(header)
    print("-" * len(header))

    # Collect all categories
    all_cats = set()
    for r in results:
        all_cats.update(r.get("categories", {}).keys())

    for cat in sorted(all_cats):
        row = f"{cat:<20s}"
        for r in results:
            score = r.get("categories", {}).get(cat, {}).get("composite", 0)
            row += f"{score:>15.4f}"
        print(row)

    # Overall
    print("-" * len(header))
    row = f"{'COMPOSITE':<20s}"
    for r in results:
        row += f"{r['summary']['composite']:>15.4f}"
    print(row)

    if args.output:
        # TODO: Generate HTML report
        print(f"\n(HTML report generation coming in v0.2)")


def main():
    parser = argparse.ArgumentParser(description="MemBench — Open Memory Benchmark")
    sub = parser.add_subparsers(dest="command")

    # run
    run_p = sub.add_parser("run", help="Run benchmark against an adapter")
    run_p.add_argument("--adapter", required=True, help="Adapter name")
    run_p.add_argument("--category", help="Run only tasks in this category")
    run_p.add_argument("--output", "-o", help="Output JSON path")

    # list
    list_p = sub.add_parser("list", help="List available tasks")
    list_p.add_argument("--category", help="Filter by category")

    # compare
    cmp_p = sub.add_parser("compare", help="Compare results from multiple runs")
    cmp_p.add_argument("files", nargs="+", help="Result JSON files")
    cmp_p.add_argument("--output", "-o", help="Output HTML report path")

    args = parser.parse_args()

    if args.command == "run":
        cmd_run(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "compare":
        cmd_compare(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
