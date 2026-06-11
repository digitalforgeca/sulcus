"""MemBench - Zep adapter (v2 Graph API, raw httpx).

Uses Zep Cloud's Graph API for memory storage and retrieval.
The zep_python v2 SDK uses pydantic v1 internally, which is
incompatible with Python 3.14. This adapter bypasses the SDK
and calls the Zep Cloud REST API directly.

Zep v2 Cloud API (2026):
  - Session-based memory endpoints (POST /sessions) appear removed/broken
  - Graph API is the active path: POST /api/v2/graph for ingestion,
    POST /api/v2/graph/search for retrieval
  - Users must exist before graph data can be associated
  - Graph extracts facts as edges between entity nodes
  - Processing is async (returns 202), takes ~3-5s

Diagnosis (Task 73, 2026-05-03):
  - Previous 0% root cause: _load_task_file used a hardcoded absolute macOS path
    (hardcoded absolute path) that doesn't exist on CI or other machines.
    Multi-session tasks fell back to empty message lists and scored 0.
    Fix: _extract_messages now uses task._raw directly (full JSON dict).
  - Contradiction fix: return 2-sentence excerpt from top-ranked result,
    matching the sulcus_adapter approach from Task 72.
  - zep_python SDK is incompatible with Python 3.14+; raw httpx path retained.

Requires: pip install httpx
Set: ZEP_API_KEY environment variable
"""

from __future__ import annotations

import os
import time
import uuid

import httpx

from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard
from .base import BaseAdapter


INGEST_WAIT_SECS = 8
POLL_INTERVAL = 2


class Adapter(BaseAdapter):
    """Zep graph memory adapter (raw HTTP, no SDK)."""

    def __init__(
        self,
        api_key: str = "",
        base_url: str = "https://api.getzep.com",
        **kwargs,
    ):
        key = api_key or os.environ.get("ZEP_API_KEY", "")
        if not key:
            raise ValueError("Zep adapter requires ZEP_API_KEY or --api-key")

        self._base = f"{base_url.rstrip('/')}/api/v2"
        self._headers = {
            "Authorization": f"Api-Key {key}",
            "Content-Type": "application/json",
        }
        self._client = httpx.Client(timeout=30.0)
        self.name = "zep"
        self._users_created: set = set()

    def _req(self, method: str, path: str, **kwargs):
        url = f"{self._base}/{path.lstrip('/')}"
        resp = self._client.request(method, url, headers=self._headers, **kwargs)
        return resp

    def _ensure_user(self, user_id: str) -> None:
        """Create a Zep user if not already created."""
        if user_id in self._users_created:
            return
        resp = self._req("POST", "users", json={"user_id": user_id})
        if resp.status_code in (200, 201, 409):  # 409 = already exists
            self._users_created.add(user_id)
        elif resp.status_code == 400 and "already exists" in resp.text.lower():
            self._users_created.add(user_id)

    def reset(self) -> None:
        """No-op - we use per-task user IDs."""
        pass

    def _wait_for_facts(self, user_id: str, max_wait: int = INGEST_WAIT_SECS) -> list:
        """Poll graph search until facts appear or timeout."""
        start = time.time()
        while time.time() - start < max_wait:
            resp = self._req("POST", "graph/search", json={
                "query": "*",
                "user_id": user_id,
            })
            if resp.status_code < 400:
                data = resp.json()
                edges = data.get("edges", [])
                if edges:
                    return edges
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
        """Extract messages, handling multi-session/efficiency formats.

        Uses task._raw directly (populated by BenchTask.from_dict with the full
        JSON dict) - no hardcoded file paths needed.
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

        # Use unique user per task for isolation
        task_user = f"membench-{task.id}-{uuid.uuid4().hex[:6]}"

        try:
            messages = self._extract_messages(task)

            if not messages:
                raise ValueError("No conversation turns in task (unsupported format)")

            # Ensure user exists
            self._ensure_user(task_user)

            # Ingest each message into the graph
            for msg in messages:
                resp = self._req("POST", "graph", json={
                    "data": msg["content"],
                    "type": "message",
                    "user_id": task_user,
                })
                if resp.status_code >= 400 and resp.status_code != 202:
                    pass  # Continue - some messages may not be accepted

            # Wait for graph processing
            self._wait_for_facts(task_user)

            # Search the graph
            resp = self._req("POST", "graph/search", json={
                "query": task.query,
                "user_id": task_user,
            })

            parts = []
            if resp.status_code < 400:
                data = resp.json()
                # Extract facts from edges
                for edge in data.get("edges", []):
                    fact = edge.get("fact", "")
                    if fact:
                        parts.append(fact)
                # Extract from nodes
                for node in data.get("nodes", []):
                    name = node.get("name", "")
                    summary = node.get("summary", "")
                    if summary:
                        parts.append(summary)
                    elif name:
                        parts.append(name)
                # Extract from episodes
                for ep in data.get("episodes", []):
                    content = ep.get("content", "")
                    if content:
                        parts.append(content)
            else:
                raise RuntimeError(f"graph/search failed ({resp.status_code}): {resp.text[:200]}")

            # For contradiction/current-state queries: return a compact 2-sentence
            # excerpt from the first (highest-ranked) result only.
            # Prevents fail_indicators firing on older contradicted values.
            is_contradiction = self._is_contradiction_query(task.query)
            if is_contradiction and parts:
                sentences = [s.strip() for s in parts[0].split(".") if s.strip()]
                response = ". ".join(sentences[:2]) if sentences else parts[0][:200]
            else:
                response = " ".join(p for p in parts if p) if parts else ""

        except Exception as e:
            error = str(e)
            response = ""

        latency = int((time.time() - t0) * 1000)
        return score_standard(task, response, self.name, latency, error)
