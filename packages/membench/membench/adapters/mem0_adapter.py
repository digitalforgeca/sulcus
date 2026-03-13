"""MemBench adapter for Mem0.

Requires: pip install membench[mem0]
"""

from __future__ import annotations

import os

from ..adapter import MemoryAdapter, Message, MemoryStats


class Mem0Adapter(MemoryAdapter):
    """Adapter for Mem0 (https://mem0.ai)."""

    def __init__(self, api_key: str | None = None):
        try:
            from mem0 import MemoryClient
        except ImportError:
            raise ImportError("Mem0 adapter requires: pip install mem0ai")

        self.api_key = api_key or os.environ.get("MEM0_API_KEY", "")
        self._client = MemoryClient(api_key=self.api_key)
        self._user_id = "membench-test"

    @property
    def name(self) -> str:
        return "Mem0"

    @property
    def version(self) -> str:
        try:
            import mem0
            return getattr(mem0, "__version__", "unknown")
        except Exception:
            return "unknown"

    def reset(self) -> None:
        try:
            self._client.delete_all(user_id=self._user_id)
        except Exception:
            pass

    def ingest(self, messages: list[Message]) -> None:
        conversation = [
            {"role": msg.role, "content": msg.content}
            for msg in messages
        ]
        self._client.add(conversation, user_id=self._user_id)

    def query(self, question: str) -> str:
        results = self._client.search(question, user_id=self._user_id, limit=20)
        if isinstance(results, list):
            return "\n".join(r.get("memory", "") for r in results)
        return str(results)

    def get_stats(self) -> MemoryStats:
        try:
            memories = self._client.get_all(user_id=self._user_id)
            if isinstance(memories, list):
                total_bytes = sum(len(m.get("memory", "").encode()) for m in memories)
                return MemoryStats(context_bytes=total_bytes, node_count=len(memories))
        except Exception:
            pass
        return MemoryStats()
