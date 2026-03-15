"""Sulcus Python SDK — zero-dependency client for the Sulcus Memory API.

Uses only urllib from the standard library. Install `httpx` for async support.
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class Memory:
    """A single memory node from the Sulcus golden index."""
    id: str
    pointer_summary: str
    memory_type: str = "episodic"
    current_heat: float = 0.0
    base_utility: float = 0.0
    is_pinned: bool = False
    modality: str = "text"
    namespace: str = "default"

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Memory":
        # Handle both field name variants across endpoints
        summary = d.get("pointer_summary") or d.get("label", "")
        heat = d.get("current_heat") or d.get("heat") or 0.0
        return cls(
            id=str(d.get("id", "")),
            pointer_summary=summary,
            memory_type=d.get("memory_type", "episodic"),
            current_heat=float(heat),
            base_utility=float(d.get("base_utility", 0)),
            is_pinned=bool(d.get("is_pinned", False)),
            modality=d.get("modality", "text"),
            namespace=d.get("namespace", "default"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SulcusError(Exception):
    """Raised when the Sulcus API returns an error."""
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(f"SulcusError({status}): {message}")


# ---------------------------------------------------------------------------
# Sync Client (stdlib only — zero dependencies)
# ---------------------------------------------------------------------------

class Sulcus:
    """Synchronous Sulcus client. Uses only urllib (stdlib).

    Args:
        api_key: Sulcus API key (sk-... format or legacy token).
        base_url: Server URL. Defaults to Sulcus Cloud.
        namespace: Default namespace for operations.
        timeout: HTTP timeout in seconds.
    """

    DEFAULT_URL = "https://server.sulcus.dforge.ca"

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_URL,
        namespace: str = "default",
        timeout: int = 30,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.namespace = namespace
        self.timeout = timeout

    # -- Core API ----------------------------------------------------------

    def remember(
        self,
        content: str,
        *,
        memory_type: str = "episodic",
        heat: float = 0.8,
        namespace: Optional[str] = None,
        decay_class: Optional[str] = None,
        is_pinned: bool = False,
        min_heat: Optional[float] = None,
        key_points: Optional[List[str]] = None,
    ) -> Memory:
        """Store a memory. Returns the created Memory node.

        Args:
            content: The text to remember. Supports Markdown formatting —
                use headers, lists, and emphasis to structure key points.
            memory_type: One of 'episodic', 'semantic', 'preference',
                'procedural', 'moment'.
            heat: Initial heat (0.0–1.0). Higher = more accessible.
            namespace: Override the default namespace.
            decay_class: Decay speed override — 'fast', 'normal', 'slow',
                'glacial'. Overrides the default for the memory_type.
            is_pinned: Pin to prevent decay entirely.
            min_heat: Floor heat value (0.0–1.0). Memory never decays below this.
            key_points: Key takeaways as a list of strings. Stored as
                structured metadata for better recall and context building.
        """
        body: Dict[str, Any] = {
            "label": content,
            "memory_type": memory_type,
            "heat": heat,
            "namespace": namespace or self.namespace,
        }
        if decay_class is not None:
            body["decay_class"] = decay_class
        if is_pinned:
            body["is_pinned"] = True
        if min_heat is not None:
            body["min_heat"] = min_heat
        if key_points:
            body["key_points"] = key_points
        data = self._post("/api/v1/agent/nodes", body)
        return Memory.from_dict(data)

    def search(
        self,
        query: str,
        *,
        limit: int = 20,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> List[Memory]:
        """Search memories by text. Returns matching nodes sorted by heat.

        Args:
            query: Search text (case-insensitive substring match).
            limit: Max results (1–100).
            memory_type: Filter by type.
            namespace: Filter by namespace.
        """
        body: Dict[str, Any] = {"query": query, "limit": limit}
        if memory_type:
            body["memory_type"] = memory_type
        if namespace:
            body["namespace"] = namespace
        data = self._post("/api/v1/agent/search", body)
        return [Memory.from_dict(m) for m in data]

    def list(
        self,
        *,
        page: int = 1,
        page_size: int = 25,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
        pinned: Optional[bool] = None,
        search: Optional[str] = None,
        sort: str = "current_heat",
        order: str = "desc",
    ) -> List[Memory]:
        """List memories with pagination and filters.

        Args:
            page: Page number (1-indexed).
            page_size: Results per page (1–100).
            memory_type: Filter by type.
            namespace: Filter by namespace.
            pinned: Filter by pinned status.
            search: Text search within pointer_summary.
            sort: Sort field (current_heat, updated_at, memory_type).
            order: Sort order (asc, desc).
        """
        params = f"?page={page}&page_size={page_size}&sort={sort}&order={order}"
        if memory_type:
            params += f"&memory_type={memory_type}"
        if namespace:
            params += f"&namespace={namespace}"
        if pinned is not None:
            params += f"&pinned={'true' if pinned else 'false'}"
        if search:
            params += f"&search={search}"
        data = self._get(f"/api/v1/agent/nodes{params}")
        nodes = data if isinstance(data, list) else (data.get("nodes") or data.get("items") or [])
        return [Memory.from_dict(m) for m in nodes]

    def get(self, memory_id: str) -> Memory:
        """Get a single memory by ID."""
        data = self._get(f"/api/v1/agent/nodes/{memory_id}")
        return Memory.from_dict(data)

    def update(
        self,
        memory_id: str,
        *,
        label: Optional[str] = None,
        memory_type: Optional[str] = None,
        is_pinned: Optional[bool] = None,
        namespace: Optional[str] = None,
        heat: Optional[float] = None,
    ) -> Memory:
        """Update a memory node. Only provided fields are changed."""
        body: Dict[str, Any] = {}
        if label is not None:
            body["label"] = label
        if memory_type is not None:
            body["memory_type"] = memory_type
        if is_pinned is not None:
            body["is_pinned"] = is_pinned
        if namespace is not None:
            body["namespace"] = namespace
        if heat is not None:
            body["current_heat"] = heat
        data = self._patch(f"/api/v1/agent/nodes/{memory_id}", body)
        if data:
            return Memory.from_dict(data)
        # Server may return empty 200; re-fetch the node
        return self.get(memory_id)

    def forget(self, memory_id: str) -> bool:
        """Delete a memory permanently. Returns True on success."""
        self._delete(f"/api/v1/agent/nodes/{memory_id}")
        return True

    def pin(self, memory_id: str) -> Memory:
        """Pin a memory (prevents heat decay)."""
        return self.update(memory_id, is_pinned=True)

    def unpin(self, memory_id: str) -> Memory:
        """Unpin a memory (resumes heat decay)."""
        return self.update(memory_id, is_pinned=False)

    def bulk_update(
        self,
        ids: List[str],
        *,
        label: Optional[str] = None,
        memory_type: Optional[str] = None,
        is_pinned: Optional[bool] = None,
        namespace: Optional[str] = None,
        heat: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Apply the same update to multiple memories at once.

        Args:
            ids: List of memory UUIDs to update.
            label: New label/summary (applied to all).
            memory_type: New type (applied to all).
            is_pinned: Pin/unpin all.
            namespace: Move all to this namespace.
            heat: Set heat on all (0.0–1.0).

        Returns:
            Dict with 'updated' count and any 'errors'.
        """
        body: Dict[str, Any] = {"ids": ids}
        if label is not None:
            body["label"] = label
        if memory_type is not None:
            body["memory_type"] = memory_type
        if is_pinned is not None:
            body["is_pinned"] = is_pinned
        if namespace is not None:
            body["namespace"] = namespace
        if heat is not None:
            body["current_heat"] = heat
        return self._post("/api/v1/agent/nodes/bulk-patch", body)

    # -- Account -----------------------------------------------------------

    def whoami(self) -> Dict[str, Any]:
        """Get tenant/org info for the current API key."""
        return self._get("/api/v1/org")

    def metrics(self) -> Dict[str, Any]:
        """Get storage and health metrics."""
        return self._get("/api/v1/metrics")

    # -- Thermodynamic Engine ----------------------------------------------

    def get_thermo_config(self) -> Dict[str, Any]:
        """Get the current thermodynamic engine configuration.

        Returns the per-tenant config (or defaults if no custom config set),
        plus the default values for reference.
        """
        return self._get("/api/v1/settings/thermo")

    def set_thermo_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Update the thermodynamic engine configuration.

        Args:
            config: Full ThermoConfig object with decay_profiles, resonance,
                    tick, consolidation, active_index, reinforcement sections.

        Returns:
            The saved config.
        """
        return self._patch("/api/v1/settings/thermo", config)

    def feedback(
        self,
        memory_id: str,
        signal: str,
    ) -> Dict[str, Any]:
        """Send recall quality feedback for a memory node.

        Args:
            memory_id: UUID of the memory node.
            signal: One of 'relevant', 'irrelevant', 'outdated'.
                - relevant: boosts heat + stability (spaced repetition)
                - irrelevant: reduces heat/stability, accelerates decay
                - outdated: nearly kills the memory, sets valid_until=now()

        Returns:
            Dict with heat_before, heat_after, stability_before, stability_after.
        """
        return self._post("/api/v1/feedback", {
            "node_id": memory_id,
            "signal": signal,
        })

    def recall_analytics(self, period: str = "30d") -> Dict[str, Any]:
        """Get recall quality analytics with tuning suggestions.

        Returns per-type stats (relevance ratio, signal counts) and
        suggestions for half-life adjustments based on feedback patterns.
        """
        return self._get("/api/v1/analytics/recall")

    # -- HTTP primitives ---------------------------------------------------

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": f"sulcus-python/0.1.0",
        }

    def _request(self, method: str, path: str, body: Optional[Dict] = None) -> Any:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(url, data=data, headers=self._headers(), method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode()
                if not raw:
                    return {}
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            body_text = e.read().decode() if e.fp else str(e)
            raise SulcusError(e.code, body_text) from e
        except urllib.error.URLError as e:
            raise SulcusError(0, f"Connection failed: {e.reason}") from e

    def _get(self, path: str) -> Any:
        return self._request("GET", path)

    def _post(self, path: str, body: Dict) -> Any:
        return self._request("POST", path, body)

    def _patch(self, path: str, body: Dict) -> Any:
        return self._request("PATCH", path, body)

    def _delete(self, path: str) -> Any:
        return self._request("DELETE", path)


# ---------------------------------------------------------------------------
# Async Client (requires httpx — optional dependency)
# ---------------------------------------------------------------------------

class AsyncSulcus:
    """Async Sulcus client. Requires `httpx` (pip install sulcus[async]).

    Same API as Sulcus but all methods are async.
    """

    DEFAULT_URL = "https://server.sulcus.dforge.ca"

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_URL,
        namespace: str = "default",
        timeout: int = 30,
    ):
        try:
            import httpx
        except ImportError:
            raise ImportError(
                "AsyncSulcus requires httpx. Install with: pip install sulcus[async]"
            )
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.namespace = namespace
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "sulcus-python/0.1.0",
            },
            timeout=timeout,
        )

    async def remember(
        self,
        content: str,
        *,
        memory_type: str = "episodic",
        heat: float = 0.8,
        namespace: Optional[str] = None,
        decay_class: Optional[str] = None,
        is_pinned: bool = False,
        min_heat: Optional[float] = None,
        key_points: Optional[List[str]] = None,
    ) -> Memory:
        body: Dict[str, Any] = {
            "label": content,
            "memory_type": memory_type,
            "heat": heat,
            "namespace": namespace or self.namespace,
        }
        if decay_class is not None:
            body["decay_class"] = decay_class
        if is_pinned:
            body["is_pinned"] = True
        if min_heat is not None:
            body["min_heat"] = min_heat
        if key_points:
            body["key_points"] = key_points
        resp = await self._client.post("/api/v1/agent/nodes", json=body)
        resp.raise_for_status()
        return Memory.from_dict(resp.json())

    async def search(
        self,
        query: str,
        *,
        limit: int = 20,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> List[Memory]:
        body: Dict[str, Any] = {"query": query, "limit": limit}
        if memory_type:
            body["memory_type"] = memory_type
        if namespace:
            body["namespace"] = namespace
        resp = await self._client.post("/api/v1/agent/search", json=body)
        resp.raise_for_status()
        return [Memory.from_dict(m) for m in resp.json()]

    async def list(
        self,
        *,
        page: int = 1,
        page_size: int = 25,
        memory_type: Optional[str] = None,
        namespace: Optional[str] = None,
        pinned: Optional[bool] = None,
        search: Optional[str] = None,
        sort: str = "current_heat",
        order: str = "desc",
    ) -> List[Memory]:
        params: Dict[str, Any] = {
            "page": page, "page_size": page_size,
            "sort": sort, "order": order,
        }
        if memory_type:
            params["memory_type"] = memory_type
        if namespace:
            params["namespace"] = namespace
        if pinned is not None:
            params["pinned"] = str(pinned).lower()
        if search:
            params["search"] = search
        resp = await self._client.get("/api/v1/agent/nodes", params=params)
        resp.raise_for_status()
        data = resp.json()
        nodes = data if isinstance(data, list) else (data.get("nodes") or data.get("items") or [])
        return [Memory.from_dict(m) for m in nodes]

    async def get(self, memory_id: str) -> Memory:
        resp = await self._client.get(f"/api/v1/agent/nodes/{memory_id}")
        resp.raise_for_status()
        return Memory.from_dict(resp.json())

    async def update(
        self,
        memory_id: str,
        *,
        label: Optional[str] = None,
        memory_type: Optional[str] = None,
        is_pinned: Optional[bool] = None,
        namespace: Optional[str] = None,
        heat: Optional[float] = None,
    ) -> Memory:
        body: Dict[str, Any] = {}
        if label is not None:
            body["label"] = label
        if memory_type is not None:
            body["memory_type"] = memory_type
        if is_pinned is not None:
            body["is_pinned"] = is_pinned
        if namespace is not None:
            body["namespace"] = namespace
        if heat is not None:
            body["current_heat"] = heat
        resp = await self._client.patch(f"/api/v1/agent/nodes/{memory_id}", json=body)
        resp.raise_for_status()
        return Memory.from_dict(resp.json())

    async def forget(self, memory_id: str) -> bool:
        resp = await self._client.delete(f"/api/v1/agent/nodes/{memory_id}")
        resp.raise_for_status()
        return True

    async def pin(self, memory_id: str) -> Memory:
        return await self.update(memory_id, is_pinned=True)

    async def unpin(self, memory_id: str) -> Memory:
        return await self.update(memory_id, is_pinned=False)

    async def bulk_update(
        self,
        ids: List[str],
        *,
        label: Optional[str] = None,
        memory_type: Optional[str] = None,
        is_pinned: Optional[bool] = None,
        namespace: Optional[str] = None,
        heat: Optional[float] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"ids": ids}
        if label is not None:
            body["label"] = label
        if memory_type is not None:
            body["memory_type"] = memory_type
        if is_pinned is not None:
            body["is_pinned"] = is_pinned
        if namespace is not None:
            body["namespace"] = namespace
        if heat is not None:
            body["current_heat"] = heat
        resp = await self._client.post("/api/v1/agent/nodes/bulk-patch", json=body)
        resp.raise_for_status()
        return resp.json()

    async def whoami(self) -> Dict[str, Any]:
        resp = await self._client.get("/api/v1/org")
        resp.raise_for_status()
        return resp.json()

    async def metrics(self) -> Dict[str, Any]:
        resp = await self._client.get("/api/v1/metrics")
        resp.raise_for_status()
        return resp.json()

    async def get_thermo_config(self) -> Dict[str, Any]:
        resp = await self._client.get("/api/v1/settings/thermo")
        resp.raise_for_status()
        return resp.json()

    async def set_thermo_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        resp = await self._client.patch("/api/v1/settings/thermo", json=config)
        resp.raise_for_status()
        return resp.json()

    async def feedback(self, memory_id: str, signal: str) -> Dict[str, Any]:
        resp = await self._client.post("/api/v1/feedback", json={
            "node_id": memory_id,
            "signal": signal,
        })
        resp.raise_for_status()
        return resp.json()

    async def recall_analytics(self) -> Dict[str, Any]:
        resp = await self._client.get("/api/v1/analytics/recall")
        resp.raise_for_status()
        return resp.json()

    async def close(self):
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()
