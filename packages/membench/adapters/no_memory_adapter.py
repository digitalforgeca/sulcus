"""MemBench — No-memory baseline adapter.

Simulates a system with zero persistent memory.
Always responds "I don't have that information" — the floor baseline.
Useful for sanity-checking that tests actually require memory.
"""

from __future__ import annotations

import time
from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard
from .base import BaseAdapter


class Adapter(BaseAdapter):
    """No-memory baseline: always returns an empty/failure response."""

    def __init__(self, **kwargs):
        self.name = "no-memory"

    def reset(self) -> None:
        pass

    def run_task(self, task: BenchTask) -> TaskResult:
        t0 = time.time()
        # Simulate a system that has no persistent memory
        response = "I don't have that information stored. Could you remind me?"
        latency = int((time.time() - t0) * 1000)
        return score_standard(task, response, self.name, latency)
