"""
Sulcus Tool Handler — Anthropic tool_use dispatch.

Self-contained: only stdlib + optional httpx. No Sulcus SDK required.

Usage:
    from handler import handle_tool_use

    # content_block is a ToolUseBlock from response.content
    result = handle_tool_use(content_block)
    # Returns a ToolResultBlockParam dict ready to add to messages
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_URL = os.environ.get("SULCUS_BASE_URL", "https://api.sulcus.ca").rstrip("/")
API_KEY = os.environ.get("SULCUS_API_KEY", "")
API_PREFIX = "/api/v1"
TIMEOUT = 30  # seconds


# ---------------------------------------------------------------------------
# Low-level HTTP helpers (stdlib only — no httpx required)
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
    """Make an authenticated HTTP request to the Sulcus server."""
    url = BASE_URL + API_PREFIX + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=_headers(), method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {"ok": True}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Sulcus API error {exc.code} on {method} {path}: {raw}"
        ) from exc
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

def sulcus_remember(
    content: str,
    memory_type: str = "semantic",
    heat: float = 0.8,
    namespace: str | None = None,
) -> dict:
    body: dict = {"label": content, "memory_type": memory_type, "heat": heat}
    if namespace:
        body["namespace"] = namespace
    return _post("/agent/nodes", body)


def sulcus_search(
    query: str,
    limit: int = 10,
    memory_type: str | None = None,
) -> dict:
    body: dict = {"query": query, "limit": limit}
    if memory_type:
        body["memory_type"] = memory_type
    return _post("/agent/search", body)


def sulcus_list(
    page: int = 1,
    page_size: int = 20,
    memory_type: str | None = None,
    namespace: str | None = None,
    pinned: bool | None = None,
) -> dict:
    params: dict = {"page": page, "page_size": page_size}
    if memory_type is not None:
        params["memory_type"] = memory_type
    if namespace is not None:
        params["namespace"] = namespace
    if pinned is not None:
        params["pinned"] = str(pinned).lower()
    return _get("/agent/nodes", params)


def sulcus_forget(memory_id: str) -> dict:
    return _delete(f"/agent/nodes/{memory_id}")


def sulcus_update(
    memory_id: str,
    label: str | None = None,
    memory_type: str | None = None,
    is_pinned: bool | None = None,
    heat: float | None = None,
) -> dict:
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
        raise ValueError("sulcus_update: at least one field to update must be provided.")
    return _patch(f"/agent/nodes/{memory_id}", body)


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

_DISPATCH = {
    "sulcus_remember": sulcus_remember,
    "sulcus_search": sulcus_search,
    "sulcus_list": sulcus_list,
    "sulcus_forget": sulcus_forget,
    "sulcus_update": sulcus_update,
}


def handle_tool_use(tool_use_block) -> dict:
    """Dispatch an Anthropic tool_use content block to the appropriate Sulcus function.

    Accepts either an anthropic.types.ToolUseBlock object or a plain dict
    with keys {"id", "type": "tool_use", "name", "input"}.

    Returns a ToolResultBlockParam dict:
        {
          "type": "tool_result",
          "tool_use_id": "<id>",
          "content": "<json-string>",
          "is_error": False,
        }

    This should be included in the next user message's content list.

    Example:
        for block in response.content:
            if block.type == "tool_use":
                tool_results.append(handle_tool_use(block))

        messages.append({
            "role": "user",
            "content": tool_results,
        })
    """
    # Normalise to primitives for both SDK objects and plain dicts
    if hasattr(tool_use_block, "id"):
        tool_id = tool_use_block.id
        name = tool_use_block.name
        args = tool_use_block.input  # already a dict for Anthropic SDK
    elif isinstance(tool_use_block, dict):
        tool_id = tool_use_block["id"]
        name = tool_use_block["name"]
        args = tool_use_block.get("input", {})
    else:
        return {
            "type": "tool_result",
            "tool_use_id": "unknown",
            "content": json.dumps({"error": f"Unrecognised tool_use format: {type(tool_use_block)}"}),
            "is_error": True,
        }

    fn = _DISPATCH.get(name)
    if fn is None:
        return {
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps({"error": f"Unknown tool: {name}"}),
            "is_error": True,
        }

    try:
        # Anthropic passes input as a dict (not a JSON string)
        if isinstance(args, str):
            args = json.loads(args)
        result = fn(**args)
        return {
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps(result),
            "is_error": False,
        }
    except (TypeError, ValueError) as exc:
        return {
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps({"error": f"Bad arguments for {name}: {exc}"}),
            "is_error": True,
        }
    except RuntimeError as exc:
        return {
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps({"error": str(exc)}),
            "is_error": True,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps({"error": f"Unexpected error in {name}: {exc}"}),
            "is_error": True,
        }
