"""
BEAM Benchmark — Sulcus backend
================================

Runs the BEAM benchmark using Sulcus as the memory backend.
This is a thin shim: it patches ``Mem0Client`` in the beam runner
to use ``SulcusClient`` transparently, so all scoring, judging, and
output logic runs unchanged.

BEAM is the largest benchmark: 100 conversations × 4 size buckets (100K–10M tokens),
2000+ questions across 10 memory ability types. Start small.

Usage:
    # Small test — 100K bucket, first 2 conversations, predict-only
    python -m benchmarks.beam.run_sulcus \\
        --project-name sulcus-beam-test \\
        --sulcus-api-key $SULCUS_API_KEY \\
        --chat-sizes 100K --conversations 0-1 --predict-only

    # Full 100K bucket run
    python -m benchmarks.beam.run_sulcus \\
        --project-name sulcus-beam-100k \\
        --sulcus-api-key $SULCUS_API_KEY \\
        --chat-sizes 100K

    # Resume a previous run
    python -m benchmarks.beam.run_sulcus \\
        --project-name sulcus-beam-100k \\
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
# Step 1: Patch Mem0Client → SulcusClient BEFORE the beam runner imports it.
# ---------------------------------------------------------------------------
import benchmarks.common.mem0_client as _mem0_mod
from benchmarks.common.sulcus_client import SulcusClient, format_search_results

_original_sulcus_init = SulcusClient.__init__


class _SulcusClientMem0Compat(SulcusClient):
    """SulcusClient accepting Mem0Client constructor kwargs transparently."""

    def __init__(
        self,
        mode: str = "oss",       # ignored
        host: str | None = None,  # ignored — Sulcus uses SULCUS_BASE_URL
        api_key: str | None = None,
        rpm: int = 60,
        **kwargs,
    ):
        _original_sulcus_init(
            self,
            api_key=os.environ.get("SULCUS_API_KEY"),
            base_url=os.environ.get("SULCUS_BASE_URL"),
            rpm=min(rpm, 120),
            **{k: v for k, v in kwargs.items() if k not in ("mode", "host", "api_key", "tenant_id")},
        )


_mem0_mod.Mem0Client = _SulcusClientMem0Compat  # type: ignore[attr-defined]
_mem0_mod.format_search_results = format_search_results  # type: ignore[attr-defined]

# ---------------------------------------------------------------------------
# Step 2: Import beam runner (now sees patched Mem0Client)
# ---------------------------------------------------------------------------
import benchmarks.beam.run as _beam_run  # noqa: E402


# ---------------------------------------------------------------------------
# Step 3: Arg parser — extends beam args with Sulcus-specific ones
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="BEAM benchmark with Sulcus memory backend",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    # Mirror beam args
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--answerer-model", default="gpt-4o")
    parser.add_argument("--judge-model", default="gpt-4o")
    parser.add_argument("--provider", default="openai", choices=["openai", "anthropic", "azure"])
    parser.add_argument("--judge-provider", default=None)
    parser.add_argument("--chat-sizes", default="100K",
                        help="Comma-separated size buckets: 100K,500K,1M,5M,10M")
    parser.add_argument("--conversations", default="0-9",
                        help="Conversation range or indices: '0-9', '0,1,2', 'all'")
    parser.add_argument("--top-k", type=int, default=200)
    parser.add_argument("--top-k-cutoffs", default="10,50,200")
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--output-dir", default="results/sulcus-beam")
    parser.add_argument("--predict-only", action="store_true")
    parser.add_argument("--evaluate-only", action="store_true")
    parser.add_argument("--rejudge", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--score-debug", action="store_true")
    parser.add_argument("--dataset-path", default=None)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--max-questions", type=int, default=None)
    parser.add_argument("--rpm", type=int, default=60)
    parser.add_argument("--hf-token", default=None,
                        help="HuggingFace token for BEAM dataset download")

    # Sulcus-specific
    parser.add_argument("--sulcus-api-key", default=None,
                        help="Sulcus API key (or SULCUS_API_KEY env var)")
    parser.add_argument("--sulcus-host", default=None,
                        help="Sulcus server URL (or SULCUS_BASE_URL env var)")

    # Mem0 compat stubs (prevent argparse errors if passed)
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

    # Patch beam's parse_args to return our already-parsed args
    _beam_run.parse_args = lambda: args  # type: ignore[attr-defined]

    print("🧠 BEAM benchmark — Sulcus backend")
    print(f"   API: {os.environ.get('SULCUS_BASE_URL', 'https://api.sulcus.ca')}")
    print(f"   Sizes: {args.chat_sizes}")

    await _beam_run.async_main()


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
