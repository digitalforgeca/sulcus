"""MemBench baseline adapter — keeps everything in a list (no memory system).

This is the control group: raw conversation stored in order, returned in full.
Represents the "just stuff it in the context window" approach.
"""

from __future__ import annotations

from ..adapter import MemoryAdapter, Message, MemoryStats


class BaselineAdapter(MemoryAdapter):
    """Baseline: stores all messages, returns all of them on query.

    This simulates the "no memory system" approach where you just
    keep the full conversation in the context window.
    """

    def __init__(self):
        self._messages: list[str] = []

    @property
    def name(self) -> str:
        return "Baseline (Full Context)"

    @property
    def version(self) -> str:
        return "1.0.0"

    def reset(self) -> None:
        self._messages = []

    def ingest(self, messages: list[Message]) -> None:
        for msg in messages:
            self._messages.append(f"[{msg.role}] {msg.content}")

    def query(self, question: str) -> str:
        """Return all stored messages as context."""
        return "\n".join(self._messages)

    def get_stats(self) -> MemoryStats:
        total = sum(len(m.encode()) for m in self._messages)
        return MemoryStats(
            context_bytes=total,
            node_count=len(self._messages),
        )
