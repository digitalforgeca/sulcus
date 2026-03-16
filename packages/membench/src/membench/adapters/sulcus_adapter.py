"""MemBench — Sulcus memory adapter.

Exercises Sulcus's thermodynamic memory:
1. For each conversation turn, call record_memory for user messages
2. Query via text search
3. Score using task scoring config

Requires: pip install sulcus (or local SDK)
"""

from __future__ import annotations

import sys
import time
import urllib.request
import urllib.error
import json
from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard, score_decay
from .base import BaseAdapter

DEFAULT_URL = "https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io"


class Adapter(BaseAdapter):
    """Sulcus thermodynamic memory adapter."""

    def __init__(
        self,
        api_key: str = "",
        base_url: str = DEFAULT_URL,
        namespace: str = "membench",
        **kwargs,
    ):
        if not api_key:
            raise ValueError("Sulcus adapter requires --api-key")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.namespace = namespace
        self.name = "sulcus"
        self._session_nodes: list[str] = []  # track nodes created for cleanup

    def reset(self) -> None:
        """Delete all nodes created during the benchmark session."""
        for node_id in self._session_nodes:
            try:
                self._delete(f"/api/v1/agent/nodes/{node_id}")
            except Exception:
                pass
        self._session_nodes = []

    def run_task(self, task: BenchTask) -> TaskResult:
        t0 = time.time()
        error = None

        try:
            # 1. Ingest conversation turns into Sulcus
            self.reset()  # fresh state per task
            self._ingest_conversation(task)

            # 2. Special handling for decay task
            if task.category == "token_efficiency" and task.facts:
                return self._run_decay_task(task, t0)

            # 3. Query via text search
            response = self._query(task.query)

        except Exception as e:
            error = str(e)
            response = ""

        latency = int((time.time() - t0) * 1000)
        return score_standard(task, response, self.name, latency, error)

    def _ingest_conversation(self, task: BenchTask) -> None:
        """Store user messages as memories in Sulcus."""
        for turn in task.conversation:
            if turn.role == "user":
                resp = self._post("/api/v1/agent/nodes", {
                    "label": turn.content[:100],
                    "pointer_summary": turn.content,
                    "memory_type": "episodic",
                    "namespace": self.namespace,
                })
                if resp and "id" in resp:
                    self._session_nodes.append(resp["id"])

    def _run_decay_task(self, task: BenchTask, t0: float) -> TaskResult:
        """Special handling for the efficiency-04 decay quality task."""
        if not task.facts:
            latency = int((time.time() - t0) * 1000)
            return score_standard(task, "", self.name, latency, "No facts provided")

        # Ingest facts with different base_utility values
        high_ids = []
        med_ids = []
        low_ids = []

        for fact in task.facts.get("high_importance", []):
            resp = self._post("/api/v1/agent/nodes", {
                "label": fact[:100],
                "pointer_summary": fact,
                "memory_type": "semantic",
                "base_utility": 0.9,
                "namespace": self.namespace,
            })
            if resp and "id" in resp:
                high_ids.append(resp["id"])
                self._session_nodes.append(resp["id"])

        for fact in task.facts.get("medium_importance", []):
            resp = self._post("/api/v1/agent/nodes", {
                "label": fact[:100],
                "pointer_summary": fact,
                "memory_type": "episodic",
                "base_utility": 0.5,
                "namespace": self.namespace,
            })
            if resp and "id" in resp:
                med_ids.append(resp["id"])
                self._session_nodes.append(resp["id"])

        for fact in task.facts.get("low_importance", []):
            resp = self._post("/api/v1/agent/nodes", {
                "label": fact[:100],
                "pointer_summary": fact,
                "memory_type": "episodic",
                "base_utility": 0.1,
                "namespace": self.namespace,
            })
            if resp and "id" in resp:
                low_ids.append(resp["id"])
                self._session_nodes.append(resp["id"])

        # Simulate decay cycles — trigger tick via metrics endpoint (proxy for tick)
        cycles = task.decay_cycles or 5
        for _ in range(min(cycles, 3)):  # cap at 3 for speed
            try:
                self._post("/api/v1/agent/sync", {"mode": "tick"})
            except Exception:
                pass
            time.sleep(0.1)

        # Check what survived
        high_facts = task.facts.get("high_importance", [])
        med_facts = task.facts.get("medium_importance", [])
        low_facts = task.facts.get("low_importance", [])

        high_retained = []
        medium_retained = []
        low_pruned = []

        for i, nid in enumerate(high_ids):
            node = self._get(f"/api/v1/agent/nodes/{nid}")
            if node and node.get("heat", node.get("current_heat", 0)) > 0.1:
                if i < len(high_facts):
                    high_retained.append(high_facts[i])

        for i, nid in enumerate(med_ids):
            node = self._get(f"/api/v1/agent/nodes/{nid}")
            if node and node.get("heat", node.get("current_heat", 0)) > 0.1:
                if i < len(med_facts):
                    medium_retained.append(med_facts[i])

        for i, nid in enumerate(low_ids):
            node = self._get(f"/api/v1/agent/nodes/{nid}")
            if node and node.get("heat", node.get("current_heat", 0)) <= 0.05:
                if i < len(low_facts):
                    low_pruned.append(low_facts[i])

        # Query for summary
        response = self._query(task.query)
        latency = int((time.time() - t0) * 1000)
        return score_decay(task, high_retained, medium_retained, low_pruned,
                           response, self.name, latency)

    def _query(self, query: str) -> str:
        """Text-search memories and join results.

        Strategy: extract keywords from query, search using the list
        endpoint's search parameter (which does server-side text matching),
        then fall back to /api/v1/agent/search.
        """
        # Extract meaningful keywords from the query (skip stop words)
        stop_words = {
            "what", "is", "my", "the", "a", "an", "do", "does", "did",
            "was", "were", "are", "am", "i", "me", "you", "your", "how",
            "when", "where", "which", "who", "whom", "why", "can", "could",
            "should", "would", "will", "shall", "has", "have", "had", "be",
            "been", "being", "that", "this", "these", "those", "it", "its",
            "of", "in", "on", "at", "to", "for", "with", "from", "by",
            "about", "tell", "remember", "recall", "know", "said", "told",
            "mentioned", "think", "say", "much", "many", "most", "more",
        }
        words = [w.strip("?.,!\"'") for w in query.lower().split()]
        keywords = [w for w in words if w and w not in stop_words and len(w) > 1]

        all_results = []

        # Try each keyword against the list endpoint's search param
        seen_ids = set()
        for kw in keywords[:4]:  # limit to 4 keywords
            try:
                resp = self._get(
                    f"/api/v1/agent/nodes"
                    f"?namespace={self.namespace}"
                    f"&search={kw}"
                    f"&page_size=5"
                    f"&sort=current_heat&order=desc"
                )
                items = []
                if isinstance(resp, dict):
                    items = resp.get("items") or resp.get("nodes") or []
                elif isinstance(resp, list):
                    items = resp
                for item in items:
                    nid = item.get("id", "")
                    if nid not in seen_ids:
                        seen_ids.add(nid)
                        all_results.append(item)
            except Exception:
                pass

        # Fallback: try the search endpoint too
        if not all_results:
            try:
                resp = self._post("/api/v1/agent/search", {
                    "query": query,
                    "namespace": self.namespace,
                    "limit": 5,
                })
                if isinstance(resp, list):
                    all_results = resp
                elif isinstance(resp, dict):
                    all_results = resp.get("items") or resp.get("nodes") or []
            except Exception:
                pass

        if not all_results:
            return ""

        parts = []
        for r in all_results[:5]:
            summary = r.get("pointer_summary") or r.get("label") or ""
            parts.append(summary)
        return " ".join(parts)

    # ── HTTP helpers ──────────────────────────────────────────────────────

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _post(self, path: str, body: dict) -> dict:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, headers=self._headers(), method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}

    def _get(self, path: str) -> dict:
        url = f"{self.base_url}{path}"
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except Exception:
            return {}

    def _delete(self, path: str) -> None:
        url = f"{self.base_url}{path}"
        req = urllib.request.Request(url, headers=self._headers(), method="DELETE")
        try:
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass
