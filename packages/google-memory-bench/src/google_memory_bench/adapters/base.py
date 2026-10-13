"""Base adapter interface for Google Memory Benchmarks."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BaseAdapter(ABC):
    """Abstract base adapter for memory systems."""

    name: str = "base"

    @abstractmethod
    def reset(self, namespace: str | None = None) -> None:
        """Reset or clear state for the benchmark run."""
        pass

    @abstractmethod
    def store(
        self,
        content: str,
        memory_type: str = "episodic",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Store a single memory item. Returns memory ID."""
        pass

    @abstractmethod
    def query(self, query_text: str, top_k: int = 10) -> str:
        """Query memory and return answer/context text."""
        pass

    def store_batch(
        self,
        items: list[str],
        memory_type: str = "episodic",
    ) -> list[str]:
        """Store multiple memory items. Default falls back to sequential store."""
        return [self.store(item, memory_type) for item in items]

