"""MemBench — Zep adapter.

Uses Zep's session-based memory API.
Requires: pip install zep-python
Set: ZEP_API_KEY environment variable
"""

from __future__ import annotations

import os
import time
import uuid
from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard
from .base import BaseAdapter


class Adapter(BaseAdapter):
    """Zep session memory adapter."""

    def __init__(
        self,
        api_key: str = "",
        base_url: str = "https://api.getzep.com",
        **kwargs,
    ):
        try:
            from zep_python import ZepClient
        except ImportError:
            raise ImportError("zep adapter requires: pip install zep-python")

        key = api_key or os.environ.get("ZEP_API_KEY", "")
        if not key:
            raise ValueError("Zep adapter requires ZEP_API_KEY or --api-key")

        from zep_python import ZepClient as _ZC
        self.client = _ZC(api_key=key, base_url=base_url)
        self.name = "zep"
        self._session_id: str = ""

    def reset(self) -> None:
        """Create a new session ID to isolate tasks."""
        self._session_id = f"membench-{uuid.uuid4().hex[:8]}"

    def run_task(self, task: BenchTask) -> TaskResult:
        t0 = time.time()
        error = None
        self.reset()

        try:
            from zep_python.memory import Memory, Message, Session

            # Create session
            self.client.memory.add_session(
                Session(session_id=self._session_id, metadata={"task": task.id})
            )

            # Add messages
            msgs = [
                Message(role=t.role, content=t.content)
                for t in task.conversation
            ]
            self.client.memory.add_memory(
                self._session_id,
                Memory(messages=msgs),
            )

            # Wait briefly for Zep to process
            time.sleep(0.5)

            # Search
            results = self.client.memory.search_memory(
                self._session_id, task.query, limit=5
            )
            parts = []
            for r in (results or []):
                if hasattr(r, "message"):
                    parts.append(r.message.content or "")
                elif hasattr(r, "summary"):
                    parts.append(r.summary or "")
            response = " ".join(parts) if parts else ""

        except Exception as e:
            error = str(e)
            response = ""

        latency = int((time.time() - t0) * 1000)
        return score_standard(task, response, self.name, latency, error)
