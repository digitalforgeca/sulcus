"""
Sulcus Tool Handler — OpenAI function calling dispatch.

Self-contained: only stdlib + optional httpx. No Sulcus SDK required.

Usage:
    import json
    from handler import handle_tool_call

    # tool_call is the object from response.choices[0].message.tool_calls[i]
    result = handle_tool_call(tool_call)
    # result is a JSON-serializable dict to pass back as the tool message
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

BASE_URL = os.environ.get("SULCUS_BASE_URL", "https://server.sulcus.dforge.ca").rstrip("/")
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
    """Make an authenticated HTTP request to the Sulcus server.

    Returns the parsed JSON response body.
    Raises RuntimeError with a descriptive message on failure.
    """
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
    heat: float = 80.0,
    namespace: str | None = None,
) -> dict:
    """Store a memory via POST /memories."""
    body: dict = {
        "content": content,
        "memory_type": memory_type,
        "heat": heat,
    }
    if namespace:
        body["namespace"] = namespace
    return _post("/memories", body)


def sulcus_search(
    query: str,
    limit: int = 10,
    memory_type: str | None = None,
) -> dict:
    """Search memories via POST /memories/search."""
    body: dict = {"query": query, "limit": limit}
    if memory_type:
        body["memory_type"] = memory_type
    return _post("/memories/search", body)


def sulcus_list(
    page: int = 1,
    page_size: int = 20,
    memory_type: str | None = None,
    namespace: str | None = None,
    pinned: bool | None = None,
) -> dict:
    """List memories via GET /memories."""
    params: dict = {"page": page, "page_size": page_size}
    if memory_type is not None:
        params["memory_type"] = memory_type
    if namespace is not None:
        params["namespace"] = namespace
    if pinned is not None:
        params["pinned"] = str(pinned).lower()
    return _get("/memories", params)


def sulcus_forget(memory_id: str) -> dict:
    """Permanently delete a memory via DELETE /memories/{id}."""
    return _delete(f"/memories/{memory_id}")


def sulcus_update(
    memory_id: str,
    label: str | None = None,
    memory_type: str | None = None,
    is_pinned: bool | None = None,
    heat: float | None = None,
) -> dict:
    """Update a memory via PATCH /memories/{id}."""
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
    return _patch(f"/memories/{memory_id}", body)


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


def handle_tool_call(tool_call) -> str:
    """Dispatch an OpenAI tool_call object to the appropriate Sulcus function.

    Accepts either an openai.types.chat.ChatCompletionMessageToolCall object
    or a plain dict with keys {"id", "type", "function": {"name", "arguments"}}.

    Returns a JSON string — ready to use as the 'content' of a 'tool' message.

    Example:
        tool_msg = {
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": handle_tool_call(tool_call),
        }
    """
    # Normalise to dict for both SDK objects and plain dicts
    if hasattr(tool_call, "function"):
        name = tool_call.function.name
        raw_args = tool_call.function.arguments
    elif isinstance(tool_call, dict):
        name = tool_call["function"]["name"]
        raw_args = tool_call["function"]["arguments"]
    else:
        return json.dumps({"error": f"Unrecognised tool_call format: {type(tool_call)}"})

    fn = _DISPATCH.get(name)
    if fn is None:
        return json.dumps({"error": f"Unknown tool: {name}"})

    try:
        args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        result = fn(**args)
        return json.dumps(result)
    except (TypeError, ValueError) as exc:
        return json.dumps({"error": f"Bad arguments for {name}: {exc}"})
    except RuntimeError as exc:
        return json.dumps({"error": str(exc)})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": f"Unexpected error in {name}: {exc}"})
