"""
LOCOMO Benchmark — Sulcus backend
==================================

Runs the LOCOMO-10 benchmark using Sulcus as the memory backend.
This is a thin shim: it patches ``Mem0Client`` in the locomo runner
to use ``SulcusClient`` transparently, so all scoring, judging, and
output logic runs unchanged.

Usage:
    # Full run (requires OPENAI_API_KEY for answerer/judge)
    python -m benchmarks.locomo.run_sulcus \\
        --project-name sulcus-locomo-01 \\
        --sulcus-api-key $SULCUS_API_KEY

    # Quick search-only test (no LLM keys needed for ingest/search phase)
    python -m benchmarks.locomo.run_sulcus \\
        --project-name sulcus-test \\
        --sulcus-api-key $SULCUS_API_KEY \\
        --max-questions 10 --predict-only

    # Resume a previous run
    python -m benchmarks.locomo.run_sulcus \\
        --project-name sulcus-locomo-01 \\
        --sulcus-api-key $SULCUS_API_KEY \\
        --resume

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
# Step 1: Patch Mem0Client → SulcusClient in the shared module BEFORE
# the locomo runner imports it. Python caches modules so this persists.
# ---------------------------------------------------------------------------
import benchmarks.common.mem0_client as _mem0_mod
from benchmarks.common.sulcus_client import SulcusClient, format_search_results

# Wrap SulcusClient to accept Mem0Client's constructor kwargs transparently
_original_sulcus_init = SulcusClient.__init__

class _SulcusClientMem0Compat(SulcusClient):
    """SulcusClient accepting Mem0Client constructor kwargs (mode, host, etc.)."""

    def __init__(
        self,
        mode: str = "oss",       # ignored
        host: str | None = None,  # ignored — Sulcus uses SULCUS_BASE_URL
        api_key: str | None = None,  # ignored for oss mode (Mem0 pattern)
        rpm: int = 60,
        **kwargs,
    ):
        # Always pull Sulcus credentials from env
        _original_sulcus_init(
            self,
            api_key=os.environ.get("SULCUS_API_KEY"),
            base_url=os.environ.get("SULCUS_BASE_URL"),
            rpm=min(rpm, 120),
            **{k: v for k, v in kwargs.items() if k not in ("mode", "host", "api_key")},
        )


_mem0_mod.Mem0Client = _SulcusClientMem0Compat  # type: ignore[attr-defined]
_mem0_mod.format_search_results = format_search_results  # type: ignore[attr-defined]

# ---------------------------------------------------------------------------
# Step 2: Import locomo runner (now sees patched Mem0Client)
# ---------------------------------------------------------------------------
import benchmarks.locomo.run as _locomo_run  # noqa: E402


# ---------------------------------------------------------------------------
# Step 3: Arg parser — extends locomo args with Sulcus-specific ones
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="LOCOMO-10 benchmark with Sulcus memory backend",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    # Mirror all locomo args so the runner is happy
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--answerer-model", default="gpt-4o")
    parser.add_argument("--judge-model", default="gpt-4o")
    parser.add_argument("--provider", default="openai", choices=["openai", "anthropic", "azure"])
    parser.add_argument("--judge-provider", default=None)
    parser.add_argument("--conversations", default="0,1,2,3,4,5,6,7,8,9")
    parser.add_argument("--top-k", type=int, default=200)
    parser.add_argument("--top-k-cutoffs", default="10,50,200")
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--output-dir", default="results/sulcus-locomo")
    parser.add_argument("--predict-only", action="store_true")
    parser.add_argument("--evaluate-only", action="store_true")
    parser.add_argument("--rejudge", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--score-debug", action="store_true")
    parser.add_argument("--dataset-path", default=None)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--categories", default="1,2,3,4")
    parser.add_argument("--with-evidence", action="store_true")
    parser.add_argument("--user-profile", action="store_true")
    parser.add_argument("--max-questions", type=int, default=None)
    parser.add_argument("--rpm", type=int, default=60)

    # Sulcus-specific (new)
    parser.add_argument("--sulcus-api-key", default=None,
                        help="Sulcus API key (or SULCUS_API_KEY env var)")
    parser.add_argument("--sulcus-host", default=None,
                        help="Sulcus server URL (or SULCUS_BASE_URL env var)")

    # Mem0 compat stubs (ignored — prevent argparse errors if passed)
    parser.add_argument("--backend", default="oss", help=argparse.SUPPRESS)
    parser.add_argument("--mem0-host", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--mem0-api-key", default=None, help=argparse.SUPPRESS)

    return parser.parse_args()


async def async_main() -> None:
    args = parse_args()

    # Inject Sulcus credentials
    if args.sulcus_api_key:
        os.environ["SULCUS_API_KEY"] = args.sulcus_api_key
    if args.sulcus_host:
        os.environ["SULCUS_BASE_URL"] = args.sulcus_host

    if not os.environ.get("SULCUS_API_KEY"):
        print("ERROR: Sulcus API key required. Use --sulcus-api-key or set SULCUS_API_KEY.")
        sys.exit(1)

    # In predict-only mode, the upstream runner still initializes LLMClient
    # which requires OPENAI_API_KEY. Set a dummy to avoid the error — it won't
    # be used because predict-only skips the answer/judge phases.
    if args.predict_only and not os.environ.get("OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = "sk-predict-only-dummy"

    # Patch locomo's parse_args to return our already-parsed args
    _locomo_run.parse_args = lambda: args  # type: ignore[attr-defined]

    print("🧠 LOCOMO benchmark — Sulcus backend")
    print(f"   API: {os.environ.get('SULCUS_BASE_URL', 'https://api.sulcus.ca')}")

    await _locomo_run.async_main()


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
