"""
LongMemEval Benchmark — Sulcus backend
========================================

Runs the LongMemEval benchmark (500 questions, 6 question types) using
Sulcus as the memory backend instead of Mem0.

Usage:
    # Full run (requires OPENAI_API_KEY for answerer/judge)
    python -m benchmarks.longmemeval.run_sulcus \\
        --project-name sulcus-lme-01 \\
        --sulcus-api-key $SULCUS_API_KEY \\
        --all-questions

    # Quick test: 5 questions per type (30 total), search-only
    python -m benchmarks.longmemeval.run_sulcus \\
        --project-name sulcus-test \\
        --sulcus-api-key $SULCUS_API_KEY \\
        --per-type 5 --predict-only

    # Specific question types
    python -m benchmarks.longmemeval.run_sulcus \\
        --project-name sulcus-temporal \\
        --sulcus-api-key $SULCUS_API_KEY \\
        --question-types temporal-reasoning,knowledge-update \\
        --predict-only

Environment variables:
    SULCUS_API_KEY   — Sulcus API key
    SULCUS_BASE_URL  — Override server URL (default: https://api.sulcus.ca)
    OPENAI_API_KEY   — Required for answerer/judge LLMs
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

# ---------------------------------------------------------------------------
# Patch Mem0Client → SulcusClient before importing longmemeval runner
# ---------------------------------------------------------------------------
import benchmarks.common.mem0_client as _mem0_mod
from benchmarks.common.sulcus_client import SulcusClient, format_search_results

_original_sulcus_init = SulcusClient.__init__


class _SulcusClientMem0Compat(SulcusClient):
    """SulcusClient accepting Mem0Client constructor kwargs transparently."""

    def __init__(
        self,
        mode: str = "oss",
        host: str | None = None,
        api_key: str | None = None,
        rpm: int = 60,
        **kwargs,
    ):
        _original_sulcus_init(
            self,
            api_key=os.environ.get("SULCUS_API_KEY"),
            base_url=os.environ.get("SULCUS_BASE_URL"),
            rpm=min(rpm, 120),
            **{k: v for k, v in kwargs.items() if k not in ("mode", "host", "api_key")},
        )


_mem0_mod.Mem0Client = _SulcusClientMem0Compat  # type: ignore[attr-defined]
_mem0_mod.format_search_results = format_search_results  # type: ignore[attr-defined]

# Now import the longmemeval runner
import benchmarks.longmemeval.run as _lme_run  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="LongMemEval benchmark with Sulcus memory backend",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    # Mirror all longmemeval args
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--answerer-model", default="gpt-4o")
    parser.add_argument("--judge-model", default="gpt-4o")
    parser.add_argument("--provider", default="openai", choices=["openai", "anthropic", "azure"])
    parser.add_argument("--judge-provider", default=None)
    parser.add_argument("--mode", default="answerer", choices=["retrieval", "answerer"])
    parser.add_argument("--top-k", type=int, default=200)
    parser.add_argument("--top-k-cutoffs", default="10,50,200")
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--output-dir", default="results/sulcus-longmemeval")
    parser.add_argument("--predict-only", action="store_true")
    parser.add_argument("--evaluate-only", action="store_true")
    parser.add_argument("--rejudge", action="store_true")
    parser.add_argument("--resume", action="store_true", default=True)
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--score-debug", action="store_true")
    parser.add_argument("--dataset-path", default=None)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--all-questions", action="store_true")
    parser.add_argument("--per-type", type=int, default=5)
    parser.add_argument("--question-types", default=None)
    parser.add_argument("--user-profile", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--rpm", type=int, default=60)

    # Sulcus-specific
    parser.add_argument("--sulcus-api-key", default=None,
                        help="Sulcus API key (or SULCUS_API_KEY env var)")
    parser.add_argument("--sulcus-host", default=None,
                        help="Sulcus server URL (or SULCUS_BASE_URL env var)")

    # Mem0 compat stubs
    parser.add_argument("--backend", default="oss", help=argparse.SUPPRESS)
    parser.add_argument("--mem0-host", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--mem0-api-key", default=None, help=argparse.SUPPRESS)

    return parser.parse_args()


async def async_main() -> None:
    args = parse_args()

    if args.sulcus_api_key:
        os.environ["SULCUS_API_KEY"] = args.sulcus_api_key
    if args.sulcus_host:
        os.environ["SULCUS_BASE_URL"] = args.sulcus_host

    if not os.environ.get("SULCUS_API_KEY"):
        print("ERROR: Sulcus API key required. Use --sulcus-api-key or set SULCUS_API_KEY.")
        sys.exit(1)

    # Patch longmemeval's parse_args to return our pre-parsed namespace
    _lme_run.parse_args = lambda: args  # type: ignore[attr-defined]

    print("🧠 LongMemEval benchmark — Sulcus backend")
    print(f"   API: {os.environ.get('SULCUS_BASE_URL', 'https://api.sulcus.ca')}")

    await _lme_run.async_main()


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
