"""Base adapter interface for memory systems under test."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class Message:
    """A single conversation message."""
    role: str  # "user" or "assistant"
    content: str
    session_id: int = 1
    timestamp: str | None = None


@dataclass
class MemoryStats:
    """Stats reported by the adapter after ingestion."""
    context_bytes: int = 0
    node_count: int = 0
    latency_ms: float = 0.0
    extra: dict[str, Any] | None = None


class MemoryAdapter(ABC):
    """Interface that each memory system must implement.

    Adapters are thin wrappers that translate MemBench operations
    into the target system's API. Keep them honest — no special
    optimizations that a real user wouldn't have.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable name of the memory system."""
        ...

    @property
    @abstractmethod
    def version(self) -> str:
        """Version of the memory system being tested."""
        ...

    @abstractmethod
    def reset(self) -> None:
        """Clear all stored memories. Called before each task."""
        ...

    @abstractmethod
    def ingest(self, messages: list[Message]) -> None:
        """Ingest a conversation into the memory system.

        For multi-session tasks, messages will have different session_ids.
        The adapter should handle session boundaries appropriately.
        """
        ...

    @abstractmethod
    def query(self, question: str) -> str:
        """Query the memory system and return the answer.

        This should return what the memory system would inject into
        an LLM's context, or the direct answer if the system produces one.
        """
        ...

    @abstractmethod
    def get_stats(self) -> MemoryStats:
        """Return current memory statistics.

        context_bytes: Total bytes the system would inject into LLM context
        node_count: Number of memory nodes/entries stored
        latency_ms: Average query latency in milliseconds
        """
        ...

    def decay(self, cycles: int = 1) -> None:
        """Run decay/maintenance cycles if the system supports them.

        Default: no-op for systems without decay.
        """
        pass

    def end_session(self) -> None:
        """Signal the end of a session for multi-session tasks.

        Default: no-op for systems without session awareness.
        """
        pass
