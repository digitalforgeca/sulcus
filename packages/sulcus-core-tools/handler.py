"""
Sulcus Tool Handler — shared HTTP client and tool implementations.

Single source of truth for all Python integrations. Platform-specific
dispatchers (OpenAI, Anthropic, etc.) call into this module.

Zero dependencies beyond stdlib. Works with Python 3.10+.
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
    body: dict = {"content": content, "memory_type": memory_type, "heat": heat}
    if namespace:
        body["namespace"] = namespace
    return _post("/memories", body)


def sulcus_search(query: str, limit: int = 10,
                  memory_type: Optional[str] = None) -> dict:
    body: dict = {"query": query, "limit": limit}
    if memory_type:
        body["memory_type"] = memory_type
    return _post("/memories/search", body)


def sulcus_list(page: int = 1, page_size: int = 20,
                memory_type: Optional[str] = None, namespace: Optional[str] = None,
                pinned: Optional[bool] = None) -> dict:
    params: dict = {"page": page, "page_size": page_size}
    if memory_type is not None:
        params["memory_type"] = memory_type
    if namespace is not None:
        params["namespace"] = namespace
    if pinned is not None:
        params["pinned"] = str(pinned).lower()
    return _get("/memories", params)


def sulcus_forget(memory_id: str) -> dict:
    return _delete(f"/memories/{memory_id}")


def sulcus_update(memory_id: str, label: Optional[str] = None,
                  memory_type: Optional[str] = None, is_pinned: Optional[bool] = None,
                  heat: Optional[float] = None) -> dict:
    body: dict = {}
    if label is not None:
        body["label"] = label
    if memory_type is not None:
        body["memory_type"] = memory_type
    if is_pinned is not None:
        body["is_pinned"] = is_pinned
    if heat is not None:
        body["heat"] = heat
    if not body:
        raise ValueError("sulcus_update: at least one field must be provided.")
    return _patch(f"/memories/{memory_id}", body)


def sulcus_boost(memory_id: str, amount: float = 20.0) -> dict:
    return _post(f"/memories/{memory_id}/boost", {"amount": amount})


def sulcus_deprecate(memory_id: str, amount: float = 20.0) -> dict:
    return _post(f"/memories/{memory_id}/deprecate", {"amount": amount})


def sulcus_hot_nodes(limit: int = 10) -> dict:
    return _get("/memories/hot", {"limit": limit})


def sulcus_build_context(query: str, token_budget: int = 2000) -> dict:
    return _post("/memories/context", {"query": query, "token_budget": token_budget})


def sulcus_create_trigger(name: str, condition: str, action: str) -> dict:
    return _post("/triggers", {"name": name, "condition": condition, "action": action})


def sulcus_list_triggers() -> dict:
    return _get("/triggers")


def sulcus_delete_trigger(trigger_id: str) -> dict:
    return _delete(f"/triggers/{trigger_id}")


def sulcus_relate(source_id: str, target_id: str, relation: str) -> dict:
    return _post("/graph/relate", {"source_id": source_id, "target_id": target_id, "relation": relation})


def sulcus_graph_traverse(memory_id: str, depth: int = 2) -> dict:
    return _get(f"/graph/traverse/{memory_id}", {"depth": depth})


def sulcus_status() -> dict:
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
