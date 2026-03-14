"""MemBench — Mem0 adapter.

Uses Mem0's managed memory API.
Requires: pip install mem0ai
Set: MEM0_API_KEY environment variable
"""

from __future__ import annotations

import os
import time
from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard
from .base import BaseAdapter


class Adapter(BaseAdapter):
    """Mem0 managed memory adapter."""

    def __init__(
        self,
        api_key: str = "",
        user_id: str = "membench-user",
        **kwargs,
    ):
        try:
            from mem0 import MemoryClient
        except ImportError:
            raise ImportError("mem0 adapter requires: pip install mem0ai")

        key = api_key or os.environ.get("MEM0_API_KEY", "")
        if not key:
            raise ValueError("Mem0 adapter requires MEM0_API_KEY or --api-key")

        from mem0 import MemoryClient as _MC
        self.client = _MC(api_key=key)
        self.user_id = user_id
        self.name = "mem0"

    def reset(self) -> None:
        """Delete all memories for the test user."""
        try:
            self.client.delete_all(user_id=self.user_id)
        except Exception:
            pass

    def run_task(self, task: BenchTask) -> TaskResult:
        t0 = time.time()
        error = None
        self.reset()

        try:
            # Ingest conversation
            messages = [
                {"role": t.role, "content": t.content}
                for t in task.conversation
            ]
            self.client.add(messages, user_id=self.user_id)

            # Search
            results = self.client.search(task.query, user_id=self.user_id, limit=5)
            parts = []
            for r in (results or []):
                if isinstance(r, dict):
                    parts.append(r.get("memory", r.get("text", "")))
            response = " ".join(parts) if parts else ""

        except Exception as e:
            error = str(e)
            response = ""

        latency = int((time.time() - t0) * 1000)
        return score_standard(task, response, self.name, latency, error)
