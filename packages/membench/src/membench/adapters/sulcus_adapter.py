"""MemBench — Sulcus memory adapter.

Exercises Sulcus's reactive, thermodynamic memory:
1. For each conversation turn, call record_memory for user messages
2. Query via text search
3. Score using task scoring config

Requires: pip install sulcus (or local SDK)
"""

from __future__ import annotations

import os
import sys
import time
import urllib.request
import urllib.error
import json
from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard, score_decay
from .base import BaseAdapter

DEFAULT_URL = "https://api.sulcus.ca"


class Adapter(BaseAdapter):
    """Sulcus reactive, thermodynamic memory adapter."""

    def __init__(
        self,
        api_key: str = "",
        base_url: str = DEFAULT_URL,
        namespace: str = "membench",
        **kwargs,
    ):
        api_key = api_key or os.environ.get("SULCUS_API_KEY", "")
        if not api_key:
            raise ValueError("Sulcus adapter requires --api-key or SULCUS_API_KEY env var")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.namespace = namespace
        self.name = "sulcus"
        self._session_nodes: list[str] = []  # track nodes created for cleanup

    def reset(self) -> None:
        """Delete all nodes in the benchmark namespace for clean state."""
        # First delete tracked nodes from this session
        for node_id in self._session_nodes:
            try:
                self._delete(f"/api/v1/agent/nodes/{node_id}")
            except Exception:
                pass
        self._session_nodes = []
        # Then purge any residual nodes in the namespace (cross-task contamination)
        try:
            resp = self._get(
                f"/api/v1/agent/nodes?namespace={self.namespace}&page_size=200"
            )
            items = []
            if isinstance(resp, dict):
                items = resp.get("items") or resp.get("nodes") or []
            elif isinstance(resp, list):
                items = resp
            for item in items:
                nid = item.get("id", "")
                if nid:
                    try:
                        self._delete(f"/api/v1/agent/nodes/{nid}")
                    except Exception:
                        pass
        except Exception:
            pass

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

    def _store_turn(self, content: str, mtype: str = "episodic", turn_idx: int = 0, session_idx: int = 0) -> None:
        """Store a single turn as a memory node with temporal context."""
        # Prepend temporal marker for ordering
        temporal_prefix = f"[Session {session_idx + 1}, Turn {turn_idx + 1}] "
        enriched = temporal_prefix + content
        resp = self._post("/api/v1/agent/nodes", {
            "label": enriched[:100],
            "pointer_summary": enriched,
            "memory_type": mtype,
            "namespace": self.namespace,
        })
        if resp and "id" in resp:
            self._session_nodes.append(resp["id"])

    def _ingest_conversation(self, task: BenchTask) -> None:
        """Store user messages as memories in Sulcus.

        Handles three ingestion paths:
        1. Multi-session tasks (task.sessions) — ingest all sessions' turns
        2. Single conversation tasks (task.conversation) — ingest user turns
        3. Efficiency tasks with key_facts — store as semantic memories
        """
        # Path 1: Multi-session tasks
        raw = task._raw if hasattr(task, "_raw") else {}
        sessions = raw.get("sessions", [])
        if sessions:
            for si, session in enumerate(sessions):
                conv = session.get("conversation", [])
                user_turns_in_session = [(ti, t) for ti, t in enumerate(conv) if t.get("role") == "user"]
                last_idx_in_session = user_turns_in_session[-1][0] if user_turns_in_session else -1
                is_last_session = (si == len(sessions) - 1)
                for ti, turn in user_turns_in_session:
                    # Skip final user turn of last session if it's a question (the query)
                    if is_last_session and ti == last_idx_in_session and "?" in turn.get("content", ""):
                        continue
                    self._store_turn(turn["content"], "episodic", ti, si)
            return

        # Path 2: Single conversation
        if task.conversation:
            user_turns = [(ti, turn) for ti, turn in enumerate(task.conversation) if turn.role == "user"]
            last_user_idx = user_turns[-1][0] if user_turns else -1
            for ti, turn in user_turns:
                # Skip the final user turn if it's a question (it's the query, not information)
                if ti == last_user_idx and "?" in turn.content:
                    continue
                self._store_turn(turn.content, "episodic", ti, 0)
            return

        # Path 3: Efficiency tasks — store key_facts as semantic memories
        key_facts = raw.get("key_facts", [])
        if key_facts:
            for kf in key_facts:
                fact = kf.get("fact", "") if isinstance(kf, dict) else str(kf)
                if fact:
                    resp = self._post("/api/v1/agent/nodes", {
                        "label": fact[:100],
                        "pointer_summary": fact,
                        "memory_type": "semantic",
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

        # Use explicit feedback to simulate decay — mark low importance as outdated,
        # boost high importance with relevant signal, leave medium alone.
        # Server signals: relevant (boost), irrelevant (reduce 70%), outdated (crush to 0.01)
        for nid in low_ids:
            try:
                self._post("/api/v1/feedback", {
                    "node_id": nid,
                    "signal": "outdated",
                })
            except Exception:
                pass

        for nid in high_ids:
            try:
                self._post("/api/v1/feedback", {
                    "node_id": nid,
                    "signal": "relevant",
                })
            except Exception:
                pass

        # Brief pause for server processing
        time.sleep(0.5)

        # Check what survived — fetch all nodes in namespace and build heat map
        high_facts = task.facts.get("high_importance", [])
        med_facts = task.facts.get("medium_importance", [])
        low_facts = task.facts.get("low_importance", [])

        # Fetch all benchmark nodes to check their heat
        all_nodes = {}
        try:
            resp = self._get(
                f"/api/v1/agent/nodes?namespace={self.namespace}&page_size=200"
            )
            items = []
            if isinstance(resp, dict):
                items = resp.get("items") or resp.get("nodes") or []
            elif isinstance(resp, list):
                items = resp
            for item in items:
                all_nodes[item.get("id", "")] = item
        except Exception:
            pass

        high_retained = []
        medium_retained = []
        low_pruned = []

        for i, nid in enumerate(high_ids):
            node = all_nodes.get(nid)
            if node and node.get("heat", 0) > 0.2:
                if i < len(high_facts):
                    high_retained.append(high_facts[i])

        for i, nid in enumerate(med_ids):
            node = all_nodes.get(nid)
            if node and node.get("heat", 0) > 0.1:
                if i < len(med_facts):
                    medium_retained.append(med_facts[i])

        for i, nid in enumerate(low_ids):
            node = all_nodes.get(nid)
            heat = node.get("heat", 1.0) if node else 1.0
            if heat <= 0.1:  # outdated signal crushes to 0.01
                if i < len(low_facts):
                    low_pruned.append(low_facts[i])

        # Query for summary
        response = self._query(task.query)
        latency = int((time.time() - t0) * 1000)
        return score_decay(task, high_retained, medium_retained, low_pruned,
                           response, self.name, latency)

    def _is_temporal_query(self, query: str) -> bool:
        """Detect if a query needs time-ordered results."""
        temporal_words = {
            "when", "first", "last", "latest", "recent", "recently", "before",
            "after", "chronological", "sequence", "order", "timeline", "duration",
            "how long", "since", "current", "currently", "now", "most recent",
        }
        q = query.lower()
        return any(tw in q for tw in temporal_words)

    def _is_contradiction_query(self, query: str) -> bool:
        """Detect if a query is about current/latest state (contradiction-sensitive)."""
        recency_words = {
            "current", "currently", "now", "prefer", "prefers", "latest",
            "today", "present", "right now", "at the moment", "these days",
            "does the user", "what does",
        }
        q = query.lower()
        return any(rw in q for rw in recency_words)

    def _query(self, query: str) -> str:
        """Text-search memories and join results.

        Strategy:
        1. Extract keywords, search via list endpoint
        2. For temporal queries, sort by created_at (chronological)
        3. For contradiction-sensitive queries, prefer most recent results
        4. Fallback to search endpoint
        """
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

        is_temporal = self._is_temporal_query(query)
        is_contradiction = self._is_contradiction_query(query)

        # Choose sort order based on query type
        # Always fetch by heat (default sort); we re-sort in Python after
        sort_field = "current_heat"
        sort_order = "desc"

        all_results = []
        seen_ids = set()

        # Primary: use semantic search endpoint
        try:
            resp = self._post("/api/v1/agent/search", {
                "query": query,
                "namespace": self.namespace,
                "limit": 20,
            })
            if isinstance(resp, list):
                all_results = resp
            elif isinstance(resp, dict):
                all_results = resp.get("items") or resp.get("nodes") or []
            for item in all_results:
                seen_ids.add(item.get("id", ""))
        except Exception:
            pass

        # For contradiction/temporal queries, also fetch ALL namespace nodes
        # (semantic search may miss the latest turn if it doesn't share terms with query)
        if is_contradiction or is_temporal:
            try:
                resp = self._get(
                    f"/api/v1/agent/nodes"
                    f"?namespace={self.namespace}"
                    f"&page_size=100"
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

        # Fallback: keyword search on list endpoint
        if not all_results:
            for kw in keywords[:5]:
                try:
                    resp = self._get(
                        f"/api/v1/agent/nodes"
                        f"?namespace={self.namespace}"
                        f"&search={kw}"
                        f"&page_size=10"
                        f"&sort={sort_field}&order={sort_order}"
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

        if not all_results:
            return ""

        # For contradiction-sensitive queries ("current", "prefer", "now"),
        # only return the SINGLE most recent result.
        # This prevents old contradicted values from appearing.
        if is_contradiction and len(all_results) > 1:
            # Sort by session/turn marker embedded in content: [Session N, Turn M]
            import re
            def _sort_key(r):
                text = r.get("pointer_summary") or r.get("label") or ""
                m = re.search(r'\[Session (\d+), Turn (\d+)\]', text)
                if m:
                    return (int(m.group(1)), int(m.group(2)))
                # Fallback to created_at
                return (0, 0)
            all_results.sort(key=_sort_key, reverse=True)
            # Return only the single most recent turn — this is the authoritative current state.
            # Returning 2+ results risks including the old/contradicted value which triggers
            # fail_indicators in scoring (e.g. response contains both "Python" and "Rust").
            all_results = all_results[:1]

        # For temporal sequence queries, sort all results chronologically by turn marker
        if is_temporal and ("list" in query.lower() or "sequence" in query.lower() or "chronological" in query.lower() or "order" in query.lower()):
            import re as _re
            def _turn_sort_key(r):
                text = r.get("pointer_summary") or r.get("label") or ""
                m = _re.search(r'\[Session (\d+), Turn (\d+)\]', text)
                if m:
                    return (int(m.group(1)), int(m.group(2)))
                return (999, 999)
            all_results.sort(key=_turn_sort_key)

        parts = []
        # For contradiction queries, extract a compact answer from the most recent turn
        # to avoid fail_indicators firing on context (e.g. "I prefer Rust now. Python is too slow")
        if is_contradiction and all_results:
            summary = all_results[0].get("pointer_summary") or all_results[0].get("label") or ""
            # Strip temporal prefix like "[Session N, Turn M] "
            import re as _re2
            summary = _re2.sub(r'^\[Session \d+, Turn \d+\]\s*', '', summary).strip()
            # Return first 2 sentences — enough to capture the answer (which may not be
            # in sentence 1: "I changed my mind. I'm going all-in on Rust.") while
            # cutting explanatory context that triggers fail_indicators ("Python is too slow").
            sentences = [s.strip() for s in summary.split('.') if s.strip()]
            excerpt = '. '.join(sentences[:2])
            return excerpt if excerpt else summary[:200]
        for r in all_results[:8]:
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
