"""MemBench — Mem0 adapter.

Uses Mem0's managed memory API.
Requires: pip install mem0ai
Set: MEM0_API_KEY environment variable

Platform observations (2026-03-16, Hobby tier):
  - add() is async only (sync deprecated) — queues background processing
  - Memory processing takes 5-15s on free tier
  - Vector search (/v2/memories/search/) returns empty despite memories
    existing — appears to be a platform/indexing issue
  - get_all() with filters works reliably once memories are processed
  - We use unique user_id per task to avoid delete/recreate race conditions
  - Fall back to get_all + local keyword matching since vector search is broken
"""

from __future__ import annotations

import os
import time
import uuid
from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard
from .base import BaseAdapter


# How long to wait for Mem0's async memory processing
# Mem0 Hobby tier can take 8-18s to process; 20s gives safe margin
INGEST_WAIT_SECS = 20
POLL_INTERVAL = 2


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
        self.base_user_id = user_id
        self.name = "mem0"

    def reset(self) -> None:
        """No-op — we use per-task user IDs instead of deleting."""
        pass

    def _get_all_memories(self, user_id: str) -> list:
        """Get all memories for a user."""
        try:
            result = self.client.get_all(filters={"user_id": user_id})
            if isinstance(result, dict):
                return result.get("results", [])
            return result or []
        except Exception:
            return []

    def _local_search(self, memories: list, query: str, limit: int = 5) -> list:
        """Simple keyword-based local search as fallback."""
        query_lower = query.lower()
        query_words = set(w.strip("?.,!\"'") for w in query_lower.split())
        stop = {"what", "is", "my", "the", "a", "an", "do", "does",
                "did", "was", "how", "when", "where", "which", "who",
                "i", "me", "you", "your", "tell", "about", "can",
                "have", "has", "had", "been", "be", "are", "am",
                "to", "for", "with", "from", "of", "in", "on", "at"}
        query_words -= stop

        scored = []
        for mem in memories:
            text = mem.get("memory", mem.get("text", "")).lower()
            overlap = sum(1 for w in query_words if w in text)
            if overlap > 0:
                scored.append((overlap, mem))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [m for _, m in scored[:limit]]

    def _wait_for_memories(self, user_id: str, max_wait: int = INGEST_WAIT_SECS) -> list:
        """Poll until memories appear or timeout."""
        start = time.time()
        while time.time() - start < max_wait:
            mems = self._get_all_memories(user_id)
            if mems:
                return mems
            time.sleep(POLL_INTERVAL)
        return []

    def _load_task_file(self, task_id: str) -> dict | None:
        """Try to load the raw task JSON for multi-session/efficiency tasks."""
        import glob
        for pattern in [
            f"/Users/mcdoolz/dev/sulcus/packages/membench/tasks/*{task_id.replace('-', '_')}*.json",
            f"/Users/mcdoolz/dev/sulcus/packages/membench/tasks/*.json",
        ]:
            for path in glob.glob(pattern):
                try:
                    import json as _json
                    with open(path) as f:
                        d = _json.load(f)
                    if d.get("id") == task_id:
                        return d
                except Exception:
                    continue
        return None

    def _extract_messages(self, task: BenchTask) -> list[dict]:
        """Extract messages from task, handling multi-session format."""
        # Standard conversation format
        if task.conversation:
            return [
                {"role": t.role, "content": t.content}
                for t in task.conversation
            ]

        # Multi-session format: load raw task JSON
        raw = self._load_task_file(task.id)
        if raw and "sessions" in raw:
            msgs = []
            for session in raw["sessions"]:
                for turn in session.get("conversation", []):
                    msgs.append({"role": turn["role"], "content": turn["content"]})
            return msgs

        # Efficiency tasks with key_facts: synthesize conversation
        if raw and "key_facts" in raw:
            msgs = []
            for kf in raw["key_facts"]:
                msgs.append({"role": "user", "content": kf["fact"]})
            return msgs

        # Decay tasks with facts: synthesize from fact lists
        if raw and "facts" in raw:
            msgs = []
            for importance in ["high_importance", "medium_importance", "low_importance"]:
                for fact in raw["facts"].get(importance, []):
                    msgs.append({"role": "user", "content": fact})
            return msgs

        return []

    def run_task(self, task: BenchTask) -> TaskResult:
        t0 = time.time()
        error = None

        # Use a unique user_id per task to avoid delete/add race conditions
        task_user = f"{self.base_user_id}-{task.id}-{uuid.uuid4().hex[:6]}"

        try:
            messages = self._extract_messages(task)

            if not messages:
                raise ValueError("No conversation turns in task (unsupported format)")

            self.client.add(
                messages,
                user_id=task_user,
            )

            # Wait for async processing
            all_mems = self._wait_for_memories(task_user)

            # Try vector search first
            items = []
            try:
                results = self.client.search(
                    task.query,
                    filters={"user_id": task_user},
                    top_k=5,
                )
                if isinstance(results, dict):
                    items = results.get("results", [])
                elif isinstance(results, list):
                    items = results
            except Exception:
                pass

            # Fallback: get_all + local keyword matching
            if not items and all_mems:
                items = self._local_search(all_mems, task.query)

            # If still nothing, return all memories (Mem0 extracts facts
            # so even returning all is a fair test of what it stored)
            if not items and all_mems:
                items = all_mems[:5]

            parts = []
            for r in (items or []):
                if isinstance(r, dict):
                    parts.append(r.get("memory", r.get("text", "")))
            response = " ".join(parts) if parts else ""

        except Exception as e:
            error = str(e)
            response = ""
        finally:
            # Cleanup: delete task-specific memories
            try:
                self.client.delete_all(user_id=task_user)
            except Exception:
                pass

        latency = int((time.time() - t0) * 1000)
        return score_standard(task, response, self.name, latency, error)
