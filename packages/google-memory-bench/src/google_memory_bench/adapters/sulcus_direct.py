"""Sulcus Direct API Adapter for Google Memory Benchmarks.

Communicates directly with Sulcus API (e.g. https://api.sulcus.ca)
without requiring an LLM in the loop.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
import uuid
from typing import Any

from .base import BaseAdapter

DEFAULT_URL = "https://api.sulcus.ca"


class SulcusDirectAdapter(BaseAdapter):
    """Direct HTTP adapter for Sulcus memory service."""

    name: str = "sulcus-direct"

    def __init__(
        self,
        api_key: str = "",
        base_url: str = DEFAULT_URL,
        namespace: str = "",
        settle_delay: float = 0.4,
    ):
        self.api_key = api_key or os.environ.get("SULCUS_API_KEY", "")
        if not self.api_key:
            raise ValueError("SulcusDirectAdapter requires api_key or SULCUS_API_KEY env var")
        self.base_url = base_url.rstrip("/")
        self.namespace = namespace or f"googlebench-{uuid.uuid4().hex[:8]}"
        self.settle_delay = settle_delay
        self._stored_ids: list[str] = []

    def reset(self, namespace: str | None = None) -> None:
        """Create a fresh isolated namespace for the test."""
        self.namespace = namespace or f"googlebench-{uuid.uuid4().hex[:8]}"
        self._stored_ids = []

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8")
        for attempt in range(6):
            try:
                req = urllib.request.Request(
                    url, data=data, headers=self._headers(), method="POST"
                )
                with urllib.request.urlopen(req, timeout=25) as resp:
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 5:
                    retry_after = e.headers.get("Retry-After")
                    try:
                        wait_sec = float(retry_after) if retry_after else (2.0 * (1.5 ** attempt))
                    except ValueError:
                        wait_sec = 2.0 * (1.5 ** attempt)
                    time.sleep(min(wait_sec, 15.0))
                    continue
                if e.code == 409:
                    return {"status": "duplicate"}
                raise
            except Exception:
                if attempt < 5:
                    time.sleep(1.0)
                    continue
                raise
        return {}

    def store(
        self,
        content: str,
        memory_type: str = "episodic",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Store a single memory turn/fact into Sulcus."""
        payload = {
            "label": content[:2000],
            "pointer_summary": content,
            "memory_type": memory_type,
            "namespace": self.namespace,
        }
        if metadata:
            if "confidence" in metadata:
                payload["confidence"] = metadata["confidence"]
            if "tags" in metadata:
                payload["tags"] = metadata["tags"]

        resp = self._post("/api/v1/agent/nodes", payload)
        node_id = resp.get("id", "")
        if node_id:
            self._stored_ids.append(node_id)
        return node_id

    def store_batch(
        self,
        items: list[str],
        memory_type: str = "episodic",
    ) -> list[str]:
        """Bulk ingest memory items using /api/v1/agent/nodes/batch in chunks of 80."""
        created_ids: list[str] = []
        chunk_size = 80
        for i in range(0, len(items), chunk_size):
            chunk = items[i : i + chunk_size]
            batch_nodes = [
                {
                    "label": text[:2000],
                    "memory_type": memory_type,
                    "namespace": self.namespace,
                }
                for text in chunk
            ]
            resp = self._post("/api/v1/agent/nodes/batch", {"nodes": batch_nodes})
            results = resp.get("results", []) if isinstance(resp, dict) else []
            for r in results:
                nid = r.get("id")
                if nid:
                    created_ids.append(nid)
                    self._stored_ids.append(nid)
            # Small pace between batches to protect server resources
            if i + chunk_size < len(items):
                time.sleep(0.2)
        return created_ids

    def settle(self) -> None:
        """Allow server asynchronous embedding generation to finish."""
        if self.settle_delay > 0:
            time.sleep(self.settle_delay)

    def query(self, query_text: str, top_k: int = 10) -> str:
        """Query Sulcus text search endpoint and format retrieved facts."""
        import re

        self.settle()

        sub_queries = [query_text]
        if "," in query_text or " and " in query_text:
            raw_parts = re.split(r'[,?]|\band\b', query_text)
            for p in raw_parts:
                p_clean = p.strip()
                if len(p_clean) > 5 and p_clean.lower() not in {"what is", "what are", "the", "user's", "my", "how do", "how does"}:
                    sub_queries.append(p_clean)

        all_results = []
        seen_ids = set()

        for sq in sub_queries:
            resp = self._post(
                "/api/v1/agent/search",
                {
                    "query": sq,
                    "namespace": self.namespace,
                    "limit": top_k,
                },
            )
            results = resp.get("results") or resp.get("items") or resp.get("nodes") or []
            if isinstance(resp, list):
                results = resp

            for r in results:
                nid = r.get("id") or r.get("pointer_summary")
                if nid and nid not in seen_ids:
                    seen_ids.add(nid)
                    all_results.append(r)

        parts = []
        for r in all_results:
            summary = r.get("pointer_summary") or r.get("label") or ""
            if summary:
                parts.append(summary)

        return "\n".join(parts)

    def query_results(self, query_text: str, top_k: int = 10) -> list[dict[str, Any]]:
        """Query Sulcus and return structured result objects with scores."""
        self.settle()
        resp = self._post(
            "/api/v1/agent/search",
            {
                "query": query_text,
                "namespace": self.namespace,
                "limit": top_k,
            },
        )
        results = resp.get("results") or resp.get("items") or resp.get("nodes") or []
        return results if isinstance(results, list) else []
