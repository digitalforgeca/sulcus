"""Heatmap & Visual Grid Reporter for Google Memory Benchmarks.

Renders Gemini-style depth vs context horizon grids in terminal ANSI and Markdown.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..benchmarks.niah.evaluator import NiahResult


def render_niah_heatmap_ascii(results: list[NiahResult]) -> str:
    """Render a Google Gemini-style terminal ASCII heatmap for NIAH results."""
    # Filter single needle results
    singles = [r for r in results if r.test_type == "single"]
    if not singles:
        return ""

    tokens = sorted(list({r.tokens for r in singles}))
    depths = sorted(list({r.depth for r in singles}))

    # Map (tokens, depth) -> score
    grid: dict[tuple[int, float], float] = {}
    for r in singles:
        grid[(r.tokens, r.depth)] = r.score

    lines = []
    lines.append("\n" + "=" * 65)
    lines.append("  Google NIAH Retrieval Heatmap (Context Horizon vs Depth)")
    lines.append("=" * 65)

    header = "Tokens  | " + " | ".join(f"{int(d * 100):>3}%" for d in depths)
    lines.append(header)
    lines.append("-" * len(header))

    for tok in tokens:
        row_str = f"{tok:>6}t | "
        cells = []
        for d in depths:
            score = grid.get((tok, d), 0.0)
            if score >= 0.99:
                # Green / solid block
                cells.append(" 100% ")
            elif score >= 0.5:
                cells.append(f"  {int(score * 100)}% ")
            else:
                cells.append("   0% ")
        row_str += " | ".join(cells)
        lines.append(row_str)

    lines.append("=" * 65 + "\n")
    return "\n".join(lines)


def render_niah_markdown_table(results: list[NiahResult]) -> str:
    """Render Markdown table for report artifacts."""
    singles = [r for r in results if r.test_type == "single"]
    if not singles:
        return ""

    tokens = sorted(list({r.tokens for r in singles}))
    depths = sorted(list({r.depth for r in singles}))

    grid: dict[tuple[int, float], float] = {}
    for r in singles:
        grid[(r.tokens, r.depth)] = r.score

    md = []
    header = "| Tokens | " + " | ".join(f"{int(d * 100)}% Depth" for d in depths) + " |"
    sep = "| --- | " + " | ".join("---" for _ in depths) + " |"
    md.append(header)
    md.append(sep)

    for tok in tokens:
        row = [f"{tok:,} tokens"]
        for d in depths:
            score = grid.get((tok, d), 0.0)
            icon = "🟢 1.00" if score >= 0.99 else (f"🟡 {score:.2f}" if score >= 0.5 else "🔴 0.00")
            row.append(icon)
        md.append("| " + " | ".join(row) + " |")

    return "\n".join(md)
