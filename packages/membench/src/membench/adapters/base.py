"""MemBench — Base adapter interface.

All adapters implement this interface. The runner calls:
    adapter = Adapter(**kwargs)
    result = adapter.run_task(task)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from ..runner.types import BenchTask, TaskResult


class BaseAdapter(ABC):
    """Abstract base class for all MemBench adapters."""

    @abstractmethod
    def run_task(self, task: BenchTask) -> TaskResult:
        """Execute a benchmark task and return a scored result.

        The adapter is responsible for:
        1. Ingesting the conversation turns into the memory system
        2. Querying the memory system with task.query
        3. Scoring the response using the task's scoring config
        4. Returning a TaskResult with score, response, and timing
        """
        ...

    @abstractmethod
    def reset(self) -> None:
        """Clear any state between tasks (session, memories, etc.)."""
        ...
