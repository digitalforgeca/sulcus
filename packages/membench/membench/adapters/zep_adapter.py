"""MemBench adapter for Zep.

Requires: pip install membench[zep]
"""

from __future__ import annotations

import os
import uuid

from ..adapter import MemoryAdapter, Message, MemoryStats


class ZepAdapter(MemoryAdapter):
    """Adapter for Zep (https://getzep.com)."""

    def __init__(self, api_key: str | None = None):
        try:
            from zep_cloud.client import Zep
        except ImportError:
            raise ImportError("Zep adapter requires: pip install zep-cloud")

        self.api_key = api_key or os.environ.get("ZEP_API_KEY", "")
        self._client = Zep(api_key=self.api_key)
        self._session_id = f"membench-{uuid.uuid4().hex[:8]}"
        self._user_id = "membench-user"

    @property
    def name(self) -> str:
        return "Zep"

    @property
    def version(self) -> str:
        try:
            import zep_cloud
            return getattr(zep_cloud, "__version__", "unknown")
        except Exception:
            return "unknown"

    def reset(self) -> None:
        self._session_id = f"membench-{uuid.uuid4().hex[:8]}"

    def ingest(self, messages: list[Message]) -> None:
        from zep_cloud.types import Message as ZepMessage

        zep_messages = [
            ZepMessage(role=msg.role, role_type=msg.role, content=msg.content)
            for msg in messages
        ]
        try:
            self._client.memory.add(self._session_id, messages=zep_messages)
        except Exception:
            # Session might need creation first
            self._client.memory.add_session(
                session_id=self._session_id,
                user_id=self._user_id,
            )
            self._client.memory.add(self._session_id, messages=zep_messages)

    def query(self, question: str) -> str:
        results = self._client.memory.search(
            self._session_id,
            text=question,
            limit=20,
        )
        if hasattr(results, "results"):
            return "\n".join(r.message.content for r in results.results if r.message)
        return str(results)

    def get_stats(self) -> MemoryStats:
        try:
            memory = self._client.memory.get(self._session_id)
            if memory and memory.messages:
                total_bytes = sum(len(m.content.encode()) for m in memory.messages if m.content)
                return MemoryStats(context_bytes=total_bytes, node_count=len(memory.messages))
        except Exception:
            pass
        return MemoryStats()
