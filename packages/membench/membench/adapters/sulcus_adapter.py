"""MemBench adapter for Sulcus."""

from __future__ import annotations

import json
import os
import time
import urllib.request
import urllib.error

from ..adapter import MemoryAdapter, Message, MemoryStats


class SulcusAdapter(MemoryAdapter):
    """Adapter for Sulcus thermodynamic memory."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
    ):
        self.api_key = api_key or os.environ.get("SULCUS_API_KEY", "")
        self.base_url = (base_url or os.environ.get("SULCUS_URL", "https://server.sulcus.dforge.ca")).rstrip("/")
        self._node_ids: list[str] = []

    @property
    def name(self) -> str:
        return "Sulcus"

    @property
    def version(self) -> str:
        return "0.1.0"

    def reset(self) -> None:
        """Delete all nodes created during this benchmark run."""
        for nid in self._node_ids:
            try:
                self._request("DELETE", f"/api/v1/agent/nodes/{nid}")
            except Exception:
                pass
        self._node_ids = []

    def ingest(self, messages: list[Message]) -> None:
        """Store each user message as a memory node."""
        for msg in messages:
            if msg.role == "user":
                # Determine memory type heuristic
                content = msg.content
                memory_type = "episodic"

                body = {
                    "label": content,
                    "memory_type": memory_type,
                    "heat": 0.8,
                    "namespace": f"membench-session-{msg.session_id}",
                }
                try:
                    data = self._request("POST", "/api/v1/agent/nodes", body)
                    if data and "id" in data:
                        self._node_ids.append(data["id"])
                except Exception as e:
                    print(f"  [sulcus] ingest error: {e}")

    def query(self, question: str) -> str:
        """Search Sulcus for relevant memories and return them as context."""
        try:
            data = self._request("POST", "/api/v1/agent/search", {
                "query": question,
                "limit": 20,
            })
            if isinstance(data, list):
                return "\n".join(
                    d.get("pointer_summary", d.get("label", ""))
                    for d in data
                )
            return str(data)
        except Exception as e:
            return f"[error: {e}]"

    def get_stats(self) -> MemoryStats:
        """Return memory stats."""
        try:
            data = self._request("POST", "/api/v1/agent/search", {
                "query": "*",
                "limit": 100,
            })
            nodes = data if isinstance(data, list) else []
            total_bytes = sum(
                len((n.get("pointer_summary") or n.get("label", "")).encode())
                for n in nodes
            )
            return MemoryStats(
                context_bytes=total_bytes,
                node_count=len(nodes),
            )
        except Exception:
            return MemoryStats()

    def decay(self, cycles: int = 1) -> None:
        """Sulcus decay happens server-side via the tick endpoint."""
        # Note: cloud Sulcus runs decay automatically.
        # For benchmarking, we'd ideally call the MCP tick tool.
        pass

    def end_session(self) -> None:
        """No-op — Sulcus uses namespaces for session isolation."""
        pass

    def _request(self, method: str, path: str, body: dict | None = None):
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body else None
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            body_text = e.read().decode() if e.fp else ""
            raise RuntimeError(f"HTTP {e.code}: {body_text}")
