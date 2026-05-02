"""MemBench — In-context memory adapter.

The conversation history is the memory. Everything is kept in the prompt.
This is the "no dedicated memory system" baseline — just stuffing the 
full conversation window into a naive answer function.

Since MemBench doesn't call an LLM, this adapter simulates the ideal
in-context case: it scans the conversation for the expected answer
using simple string matching. This tests whether the answer is
*present in the conversation* — not whether an LLM can find it.

Scoring model:
- If the expected answer appears verbatim in the conversation → PASS
- If partial match keywords appear → partial credit
- If fail indicators appear → FAIL

This gives us the upper-bound for what any in-context system *could* do
without a separate memory layer.
"""

from __future__ import annotations

import time
from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard
from .base import BaseAdapter


class Adapter(BaseAdapter):
    """In-context baseline: scans conversation history for the answer."""

    def __init__(self, **kwargs):
        self.name = "in-context"

    def reset(self) -> None:
        pass

    def run_task(self, task: BenchTask) -> TaskResult:
        t0 = time.time()

        # Concatenate all conversation content as the "context"
        context = " ".join(t.content for t in task.conversation)

        # Simulate "recall": find the answer in the raw conversation text
        response = self._extract_answer(task, context)
        latency = int((time.time() - t0) * 1000)
        return score_standard(task, response, self.name, latency)

    def _extract_answer(self, task: BenchTask, context: str) -> str:
        """Naive extraction: return snippets containing the expected answer."""
        # Check for exact match first
        for exact in task.scoring.exact:
            if exact.lower() in context.lower():
                return f"Based on context: {exact}"

        # Check partial
        for partial in task.scoring.partial:
            if partial.lower() in context.lower():
                return f"Partial context match: {partial}"

        # Not found
        return "I don't have that information in my current context."
