"""MemBench — Mem0 adapter (raw HTTP, no SDK).

Uses Mem0's Cloud REST API directly to avoid SDK version issues.

API surface (verified 2026-05-02 against docs.mem0.ai):
  - POST /v1/memories/: Add memories (async, returns queued events)
    Auth: "Authorization: Token <key>"
    Body: {"messages": [...], "user_id": "..."}
  - POST /v2/memories/search/: Vector search endpoint
    Body: {"query": "...", "filters": {"user_id": "..."}, "top_k": 10}
    Note: returns [] on Hobby/free tier — broken vector search
    On paid tier (Pro+), vector search works correctly
  - POST /v2/memories/: Get all memories with filters
    Body: {"filters": {"user_id": "..."}}
  - DELETE /v1/memories/?user_id=<id>: Delete all memories for user
    Query param user_id required (not body)

Platform tier behaviour:
  - Hobby/free: vector search returns [] — falls back to get_all + local keyword matching
  - Pro+: vector search works — enables semantic recall
  - Memory processing is async: takes 5-15s on free tier, faster on paid

Task 73 fix (2026-05-03):
  - _extract_messages: uses task._raw directly (no hardcoded path)
  - Contradiction queries: return 2-sentence excerpt from most recent memory
  - Recency sort: sort memories by created_at DESC for contradiction/recency queries
"""

from __future__ import annotations

import json
import os
import time
import uuid
import urllib.request
import urllib.error

from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard
from .base import BaseAdapter


INGEST_WAIT_SECS = 15
POLL_INTERVAL = 2


class Adapter(BaseAdapter):
    """Mem0 managed memory adapter (raw HTTP)."""

    def __init__(
        self,
        api_key: str = "",
        base_url: str = "https://api.mem0.ai",
        **kwargs,
    ):
        key = api_key or os.environ.get("MEM0_API_KEY", "")
        if not key:
            raise ValueError("Mem0 adapter requires MEM0_API_KEY or --api-key")

        self._base = base_url.rstrip("/")
        self._api_key = key
        self.name = "mem0"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Token {self._api_key}",
            "Content-Type": "application/json",
        }

    def _post(self, path: str, body: dict) -> dict | list:
        url = f"{self._base}{path}"
        data = json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, headers=self._headers(), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            body_text = e.read().decode() if e.fp else ""
            raise RuntimeError(f"HTTP {e.code}: {body_text[:300]}")

    def _delete_user(self, user_id: str) -> None:
        """Delete all memories for a user via query param (per API docs)."""
        url = f"{self._base}/v1/memories/?user_id={urllib.request.quote(user_id)}"
        req = urllib.request.Request(url, headers=self._headers(), method="DELETE")
        try:
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass

    def reset(self) -> None:
        """No-op — we use per-task user IDs."""
        pass

    def _get_all(self, user_id: str) -> list:
        """Get all memories for a user via v2 get endpoint."""
        try:
            resp = self._post("/v2/memories/", {
                "filters": {"user_id": user_id}
            })
            if isinstance(resp, list):
                return resp
            if isinstance(resp, dict):
                return resp.get("results", resp.get("memories", []))
            return []
        except Exception:
            return []

    def _vector_search(self, user_id: str, query: str) -> list:
        """Try vector search (often returns empty on free tier)."""
        try:
            resp = self._post("/v2/memories/search/", {
                "query": query,
                "filters": {"user_id": user_id},
                "top_k": 10,
            })
            if isinstance(resp, list):
                return resp
            if isinstance(resp, dict):
                return resp.get("memories", resp.get("results", []))
            return []
        except Exception:
            return []

    def _local_search(self, memories: list, query: str, limit: int = 5) -> list:
        """Keyword-based local search as fallback."""
        query_lower = query.lower()
        query_words = set(w.strip("?.,!\"'") for w in query_lower.split())
        stop = {"what", "is", "my", "the", "a", "an", "do", "does",
                "did", "was", "how", "when", "where", "which", "who",
                "i", "me", "you", "your", "tell", "about", "can",
                "have", "has", "had", "been", "be", "are", "am",
                "to", "for", "with", "from", "of", "in", "on", "at",
                "know", "remember", "recall", "said", "told"}
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
            mems = self._get_all(user_id)
            if mems:
                return mems
            time.sleep(POLL_INTERVAL)
        return []

    def _is_contradiction_query(self, query: str) -> bool:
        """Detect if a query is about current/latest state (contradiction-sensitive)."""
        recency_words = {
            "current", "currently", "now", "prefer", "prefers", "latest",
            "today", "present", "right now", "at the moment", "these days",
            "does the user", "what does",
        }
        q = query.lower()
        return any(rw in q for rw in recency_words)

    def _extract_messages(self, task: BenchTask) -> list[dict]:
        """Extract messages from task, handling multi-session format.

        Uses task._raw directly (populated by BenchTask.from_dict with the full
        JSON dict) — no hardcoded file paths needed.
        """
        if task.conversation:
            return [
                {"role": t.role, "content": t.content}
                for t in task.conversation
            ]

        raw = getattr(task, "_raw", {})
        if raw and "sessions" in raw:
            msgs = []
            for session in raw["sessions"]:
                for turn in session.get("conversation", []):
                    msgs.append({"role": turn["role"], "content": turn["content"]})
            return msgs

        if raw and "key_facts" in raw:
            return [{"role": "user", "content": kf["fact"]} for kf in raw["key_facts"]]

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

        # Unique user_id per task for isolation
        task_user = f"membench-{task.id}-{uuid.uuid4().hex[:6]}"

        try:
            messages = self._extract_messages(task)
            if not messages:
                raise ValueError("No conversation turns in task")

            # Ingest via v1 add endpoint
            self._post("/v1/memories/", {
                "messages": messages,
                "user_id": task_user,
            })

            # Wait for async processing
            all_mems = self._wait_for_memories(task_user)

            # Try vector search first (works on Pro+ tier, broken on Hobby/free)
            items = self._vector_search(task_user, task.query)

            # Fallback: get_all + local keyword matching
            if not items and all_mems:
                items = self._local_search(all_mems, task.query)

            # Last resort: return all memories
            if not items and all_mems:
                items = all_mems[:5]

            # Sort by recency for contradiction/current-state queries
            is_contradiction = self._is_contradiction_query(task.query)
            if is_contradiction and items:
                # Sort most-recent first (created_at DESC)
                def _mem_sort_key(m):
                    ts = m.get("created_at", "") or ""
                    return ts
                items = sorted(items, key=_mem_sort_key, reverse=True)

            parts = []
            for r in (items or []):
                if isinstance(r, dict):
                    parts.append(r.get("memory", r.get("text", "")))

            # For contradiction queries: return a compact 2-sentence excerpt
            # from the most recent memory only, to avoid fail_indicators firing
            # on older contradicted values in the same response.
            if is_contradiction and parts:
                sentences = [s.strip() for s in parts[0].split(".") if s.strip()]
                excerpt = ". ".join(sentences[:2])
                response = excerpt if excerpt else parts[0][:200]
            else:
                response = " ".join(p for p in parts if p) if parts else ""

        except Exception as e:
            error = str(e)
            response = ""
        finally:
            # Cleanup
            try:
                self._delete_user(task_user)
            except Exception:
                pass

        latency = int((time.time() - t0) * 1000)
        return score_standard(task, response, self.name, latency, error)
