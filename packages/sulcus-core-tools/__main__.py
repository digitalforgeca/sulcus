"""
Generate tool definitions for any platform.

Usage:
    python -m sulcus_core_tools --format openai
    python -m sulcus_core_tools --format anthropic
    python -m sulcus_core_tools --format gemini
    python -m sulcus_core_tools --format openai --categories memory heat
    python -m sulcus_core_tools --format openai --core-only
"""

import argparse
import sys


def main():
    parser = argparse.ArgumentParser(
        prog="sulcus-core-tools",
        description="Generate Sulcus tool definitions for any platform.",
    )
    parser.add_argument(
        "--format", "-f",
        choices=["openai", "anthropic", "gemini"],
        required=True,
        help="Output format",
    )
    parser.add_argument(
        "--categories", "-c",
        nargs="+",
        choices=["memory", "heat", "context", "trigger", "graph", "config", "sync"],
        help="Filter by tool categories",
    )
    parser.add_argument(
        "--core-only",
        action="store_true",
        help="Only include the 5 core memory tools",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="JSON indent level (default: 2)",
    )

    args = parser.parse_args()

    categories = args.categories
    if args.core_only:
        categories = ["memory"]

    if args.format == "openai":
        from .formatters.openai import to_json
    elif args.format == "anthropic":
        from .formatters.anthropic import to_json
    elif args.format == "gemini":
        from .formatters.gemini import to_json
    else:
        print(f"Unknown format: {args.format}", file=sys.stderr)
        sys.exit(1)

    print(to_json(categories=categories, indent=args.indent))


if __name__ == "__main__":
    main()
