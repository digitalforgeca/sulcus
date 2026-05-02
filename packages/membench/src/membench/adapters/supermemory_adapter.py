"""MemBench — Supermemory adapter.

Uses Supermemory's v3/v4 Cloud API for memory storage and retrieval.

API surface (verified 2026-03-16):
  - POST /v4/conversations: Ingest conversation turns (async, returns 200+queued)
  - POST /v3/search: Semantic search over stored documents/memories
  - DELETE /v3/container-tags/{tag}: Delete all data for a container tag

Auth: Bearer token via Authorization header.
containerTag scopes data per user/task (like Mem0's user_id).

Requires: pip install httpx (or uses stdlib urllib)
Set: SUPERMEMORY_API_KEY environment variable
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


# Supermemory processes asynchronously; wait for indexing
INGEST_WAIT_SECS = 8
POLL_INTERVAL = 2


class Adapter(BaseAdapter):
    """Supermemory Cloud memory adapter."""

    def __init__(
        self,
        api_key: str = "",
        base_url: str = "https://api.supermemory.ai",
        **kwargs,
    ):
        key = api_key or os.environ.get("SUPERMEMORY_API_KEY", "")
        if not key:
            raise ValueError("Supermemory adapter requires SUPERMEMORY_API_KEY or --api-key")

        self._base = base_url.rstrip("/")
        self._api_key = key
        self.name = "supermemory"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _post(self, path: str, body: dict) -> dict:
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

    def _delete(self, path: str) -> bool:
        url = f"{self._base}{path}"
        req = urllib.request.Request(url, headers=self._headers(), method="DELETE")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status < 400
        except Exception:
            return False

    def reset(self) -> None:
        """No-op — we use per-task container tags and clean up after."""
        pass

    def run_task(self, task: BenchTask) -> TaskResult:
        t0 = time.time()
        error = None

        # Unique container tag per task for isolation
        tag = f"membench-{task.id}-{uuid.uuid4().hex[:6]}"

        try:
            # 1. Ingest conversation via v4/conversations endpoint
            messages = self._extract_messages(task)
            if not messages:
                raise ValueError("No conversation turns in task")

            conv_id = f"bench-{task.id}-{uuid.uuid4().hex[:6]}"
            self._post("/v4/conversations", {
                "conversationId": conv_id,
                "messages": messages,
                "containerTags": [tag],
            })

            # 2. Wait for async processing
            response = self._poll_and_search(tag, task.query, max_wait=INGEST_WAIT_SECS)

        except Exception as e:
            error = str(e)
            response = ""
        finally:
            # Cleanup: delete container tag
            try:
                self._delete(f"/v3/container-tags/{tag}")
            except Exception:
                pass

        latency = int((time.time() - t0) * 1000)
        return score_standard(task, response, self.name, latency, error)

    def _extract_messages(self, task: BenchTask) -> list[dict]:
        """Extract messages from task, handling multi-session format."""
        if task.conversation:
            return [
                {"role": t.role, "content": t.content}
                for t in task.conversation
            ]

        # Multi-session tasks: try to load raw JSON
        raw = self._load_task_file(task.id)
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

    def _load_task_file(self, task_id: str) -> dict | None:
        """Try to load the raw task JSON."""
        import glob
        for path in glob.glob("/Users/dv00003-00/dev/sulcus/packages/membench/tasks/*.json"):
            try:
                with open(path) as f:
                    d = json.load(f)
                if d.get("id") == task_id:
                    return d
            except Exception:
                continue
        return None

    def _poll_and_search(self, tag: str, query: str, max_wait: int = INGEST_WAIT_SECS) -> str:
        """Poll search until results appear or timeout."""
        start = time.time()
        last_results = []

        while time.time() - start < max_wait:
            try:
                resp = self._post("/v3/search", {
                    "q": query,
                    "containerTags": [tag],
                    "limit": 10,
                })
                results = resp.get("results", [])
                if results:
                    last_results = results
                    break
            except Exception:
                pass
            time.sleep(POLL_INTERVAL)

        if not last_results:
            # One final attempt
            try:
                resp = self._post("/v3/search", {
                    "q": query,
                    "containerTags": [tag],
                    "limit": 10,
                })
                last_results = resp.get("results", [])
            except Exception:
                pass

        if not last_results:
            return ""

        # Extract content from results
        parts = []
        for r in last_results:
            # Documents have chunks
            chunks = r.get("chunks", [])
            for chunk in chunks:
                content = chunk.get("content", "")
                if content and chunk.get("isRelevant", True):
                    parts.append(content)
            # Also check top-level fields
            title = r.get("title", "")
            if title and title not in parts:
                parts.append(title)
            # Memory field (from memory search)
            memory = r.get("memory", "")
            if memory and memory not in parts:
                parts.append(memory)

        return " ".join(parts) if parts else ""
