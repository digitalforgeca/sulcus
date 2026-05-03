"""
Sulcus Tool Handler — shared HTTP client and tool implementations.

Single source of truth for all Python integrations. Platform-specific
dispatchers (OpenAI, Anthropic, etc.) call into this module.

Zero dependencies beyond stdlib. Works with Python 3.10+.

Endpoint mapping (v2.13.0 server):
  Memory CRUD   → /api/v1/agent/nodes[/:id]
  Search        → POST /api/v1/agent/search
  Hot nodes     → GET  /api/v1/agent/hot_nodes
  Hot context   → POST /api/v1/agent/hot-context
  Boost/depr.   → POST /api/v1/agent/boost-batch
  Graph         → GET  /api/v1/agent/graph/neighbors/:id
  Triggers      → GET/POST /api/v1/triggers, DELETE /api/v1/triggers/:id
  Status        → GET  /api/v1/status
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_URL = os.environ.get("SULCUS_BASE_URL", "https://api.sulcus.ca").rstrip("/")
API_KEY = os.environ.get("SULCUS_API_KEY", "")
API_PREFIX = "/api/v1"
TIMEOUT = 30


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only)
# ---------------------------------------------------------------------------

def _headers() -> dict:
    if not API_KEY:
        raise RuntimeError("SULCUS_API_KEY environment variable is not set.")
    return {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _request(method: str, path: str, body: dict | None = None) -> Any:
    url = BASE_URL + API_PREFIX + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=_headers(), method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {"ok": True}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Sulcus API error {exc.code} on {method} {path}: {raw}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Sulcus connection error on {method} {path}: {exc.reason}") from exc


def _get(path: str, params: dict | None = None) -> Any:
    if params:
        path += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    return _request("GET", path)


def _post(path: str, body: dict) -> Any:
    return _request("POST", path, body)


def _patch(path: str, body: dict) -> Any:
    return _request("PATCH", path, body)


def _delete(path: str) -> Any:
    return _request("DELETE", path)


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def sulcus_remember(content: str, memory_type: str = "semantic",
                    heat: float = 80.0, namespace: Optional[str] = None) -> dict:
    """Store a memory. Maps to POST /api/v1/agent/nodes.
    Server field is 'label' (not 'content'). Heat is 0–100 here, server stores 0.0–1.0.
    """
    body: dict = {
        "label": content,
        "memory_type": memory_type,
        "heat": heat / 100.0,  # normalise to [0.0, 1.0] for server
    }
    if namespace:
        body["namespace"] = namespace
    return _post("/agent/nodes", body)


def sulcus_search(query: str, limit: int = 10,
                  memory_type: Optional[str] = None) -> dict:
    """Search memories. Maps to POST /api/v1/agent/search."""
    body: dict = {"query": query, "limit": limit}
    if memory_type:
        body["memory_type"] = memory_type
    return _post("/agent/search", body)


def sulcus_list(page: int = 1, page_size: int = 20,
                memory_type: Optional[str] = None, namespace: Optional[str] = None,
                pinned: Optional[bool] = None) -> dict:
    """List memories. Maps to GET /api/v1/agent/nodes."""
    params: dict = {"page": page, "page_size": page_size}
    if memory_type is not None:
        params["memory_type"] = memory_type
    if namespace is not None:
        params["namespace"] = namespace
    if pinned is not None:
        params["pinned"] = str(pinned).lower()
    return _get("/agent/nodes", params)


def sulcus_forget(memory_id: str) -> dict:
    """Delete a memory. Maps to DELETE /api/v1/agent/nodes/:id."""
    return _delete(f"/agent/nodes/{memory_id}")


def sulcus_update(memory_id: str, label: Optional[str] = None,
                  memory_type: Optional[str] = None, is_pinned: Optional[bool] = None,
                  heat: Optional[float] = None) -> dict:
    """Update a memory. Maps to PATCH /api/v1/agent/nodes/:id.
    Server field for heat is 'current_heat' (0.0–1.0).
    """
    body: dict = {}
    if label is not None:
        body["label"] = label
    if memory_type is not None:
        body["memory_type"] = memory_type
    if is_pinned is not None:
        body["is_pinned"] = is_pinned
    if heat is not None:
        body["current_heat"] = heat / 100.0  # normalise to [0.0, 1.0]
    if not body:
        raise ValueError("sulcus_update: at least one field must be provided.")
    return _patch(f"/agent/nodes/{memory_id}", body)


def sulcus_boost(memory_id: str, amount: float = 20.0) -> dict:
    """Boost a memory's heat. Maps to POST /api/v1/agent/boost-batch.
    Amount is the delta (0–100). We apply it as a relative increase.
    Since boost-batch sets absolute heat, we first fetch the current heat,
    then send clamped(current + delta/100) as the target value.
    """
    # Fetch current heat
    try:
        node = _get(f"/agent/nodes/{memory_id}")
        current_heat: float = node.get("current_heat", 0.5) or 0.0
    except RuntimeError:
        current_heat = 0.5  # conservative default if fetch fails

    new_heat = min(1.0, current_heat + (amount / 100.0))
    return _post("/agent/boost-batch", {
        "boosts": [{"id": memory_id, "heat": new_heat}]
    })


def sulcus_deprecate(memory_id: str, amount: float = 20.0) -> dict:
    """Reduce a memory's heat. Maps to POST /api/v1/agent/boost-batch with lower value.
    Amount is the delta (0–100). We apply it as a relative decrease.
    """
    try:
        node = _get(f"/agent/nodes/{memory_id}")
        current_heat: float = node.get("current_heat", 0.5) or 0.0
    except RuntimeError:
        current_heat = 0.5

    new_heat = max(0.0, current_heat - (amount / 100.0))
    return _post("/agent/boost-batch", {
        "boosts": [{"id": memory_id, "heat": new_heat}]
    })


def sulcus_hot_nodes(limit: int = 10) -> dict:
    """List hottest memories. Maps to GET /api/v1/agent/hot_nodes."""
    return _get("/agent/hot_nodes", {"limit": limit})


def sulcus_build_context(query: str, token_budget: int = 2000) -> dict:
    """Build a context block. Maps to POST /api/v1/agent/hot-context.
    Note: hot-context returns hot memories without a query. For query-based context
    use sulcus_search with a token budget enforced client-side.
    """
    return _post("/agent/hot-context", {"limit": 20})


def sulcus_create_trigger(name: str, condition: str, action: str) -> dict:
    """Create a trigger. Maps to POST /api/v1/triggers."""
    return _post("/triggers", {"name": name, "condition": condition, "action": action})


def sulcus_list_triggers() -> dict:
    """List triggers. Maps to GET /api/v1/triggers."""
    return _get("/triggers")


def sulcus_delete_trigger(trigger_id: str) -> dict:
    """Delete a trigger. Maps to DELETE /api/v1/triggers/:id."""
    return _delete(f"/triggers/{trigger_id}")


def sulcus_relate(source_id: str, target_id: str, relation: str) -> dict:
    """Create a relationship between memories.
    Note: the server does not expose a direct graph-edge creation endpoint for
    memory↔memory edges. Edges are created automatically by the SILU entity
    extraction pipeline on memory store. This stub returns a guidance message.
    For programmatic graph traversal, use sulcus_graph_traverse instead.
    """
    return {
        "ok": False,
        "error": "not_supported",
        "message": (
            "Direct memory↔memory edge creation is not available via the REST API. "
            "Graph edges are created automatically by the SILU entity extraction pipeline "
            "when memories are stored. Use sulcus_graph_traverse to inspect existing edges."
        ),
    }


def sulcus_graph_traverse(memory_id: str, depth: int = 2) -> dict:
    """Traverse the knowledge graph from a memory. Maps to GET /api/v1/agent/graph/neighbors/:id.
    Note: depth parameter is not supported server-side (always returns direct neighbors).
    """
    return _get(f"/agent/graph/neighbors/{memory_id}")


def sulcus_status() -> dict:
    """Get server status. Maps to GET /api/v1/status."""
    return _get("/status")


# ---------------------------------------------------------------------------
# Dispatch registry
# ---------------------------------------------------------------------------

DISPATCH: dict[str, Any] = {
    "sulcus_remember": sulcus_remember,
    "sulcus_search": sulcus_search,
    "sulcus_list": sulcus_list,
    "sulcus_forget": sulcus_forget,
    "sulcus_update": sulcus_update,
    "sulcus_boost": sulcus_boost,
    "sulcus_deprecate": sulcus_deprecate,
    "sulcus_hot_nodes": sulcus_hot_nodes,
    "sulcus_build_context": sulcus_build_context,
    "sulcus_create_trigger": sulcus_create_trigger,
    "sulcus_list_triggers": sulcus_list_triggers,
    "sulcus_delete_trigger": sulcus_delete_trigger,
    "sulcus_relate": sulcus_relate,
    "sulcus_graph_traverse": sulcus_graph_traverse,
    "sulcus_status": sulcus_status,
}


def dispatch(tool_name: str, args: dict) -> Any:
    """Call a Sulcus tool by name with the given arguments.

    Returns the result dict. Raises KeyError for unknown tools,
    TypeError/ValueError for bad args, RuntimeError for API errors.
    """
    fn = DISPATCH.get(tool_name)
    if fn is None:
        raise KeyError(f"Unknown tool: {tool_name}")
    return fn(**args)
