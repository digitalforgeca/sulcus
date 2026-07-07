"""Sulcus Cloud Memory Provider for Hermes Agent.

Persistent semantic recall, episodic storage, and knowledge graph
via api.sulcus.ca. Implements the full MemoryProvider lifecycle.

Bug fixes applied:
1. is_available() parses .env file, not just os.environ
2. Uses pointer_summary (not label) for recall display — _node_label() helper
3. Uses current_heat (not heat) — _node_heat() helper
4. Detects status: rejected on store responses, surfaces as tool error
5. Logs warning on auth failures instead of silently returning "No memories found"
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from agent.memory_provider import MemoryProvider

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_dotenv() -> Dict[str, str]:
    """Parse .env file from HERMES_HOME or cwd. Returns dict of key=value."""
    env_vars: Dict[str, str] = {}
    for candidate in [
        Path(os.environ.get("HERMES_HOME", "")) / ".env",
        Path.home() / ".hermes" / ".env",
        Path("/opt/data/.env"),
    ]:
        if candidate.is_file():
            try:
                for line in candidate.read_text().splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        env_vars[k.strip()] = v.strip().strip('"').strip("'")
            except Exception:
                pass
            break
    return env_vars


def _get_env(key: str) -> str:
    """Get env var — checks os.environ first, falls back to .env file."""
    val = os.environ.get(key, "")
    if val:
        return val
    return _load_dotenv().get(key, "")


def _node_label(node: dict) -> str:
    """Extract display label from a node — prefers pointer_summary over label."""
    return (
        node.get("pointer_summary")
        or node.get("label")
        or node.get("summary")
        or "(untitled)"
    )


def _node_heat(node: dict) -> float:
    """Extract heat value — API returns current_heat, not heat."""
    return float(node.get("current_heat", node.get("heat", 0.0)))


def _truncate(text: str, max_len: int = 300) -> str:
    """Truncate text to max_len chars with ellipsis."""
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


# ---------------------------------------------------------------------------
# API Client
# ---------------------------------------------------------------------------

class SulcusClient:
    """Lightweight REST client for Sulcus Cloud API."""

    def __init__(self, base_url: str, api_key: str, namespace: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.namespace = namespace
        self._lock = threading.Lock()

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[dict] = None,
        timeout: int = 30,
    ) -> dict:
        """Make an authenticated API request."""
        url = f"{self.base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Namespace": self.namespace,
        }
        data = json.dumps(body).encode() if body else None
        req = Request(url, data=data, headers=headers, method=method)

        try:
            with urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode()
                if not raw:
                    return {}
                parsed = json.loads(raw)
                # Some endpoints return lists directly
                return parsed
        except HTTPError as e:
            body_text = ""
            try:
                body_text = e.read().decode()
            except Exception:
                pass
            if e.code == 401:
                logger.warning(
                    "Sulcus auth failed (401) — check SULCUS_API_KEY. Response: %s",
                    body_text[:200],
                )
                raise
            if e.code == 403:
                logger.warning(
                    "Sulcus forbidden (403) — namespace '%s' may not be authorized. Response: %s",
                    self.namespace,
                    body_text[:200],
                )
                raise
            logger.warning("Sulcus API error %d on %s %s: %s", e.code, method, path, body_text[:200])
            raise
        except URLError as e:
            logger.warning("Sulcus connection error on %s %s: %s", method, path, e.reason)
            raise

    # -- Search / Recall --

    def search(self, query: str, limit: int = 10, tier: str = "all") -> List[dict]:
        """Semantic search across memories."""
        body = {
            "query": query,
            "limit": limit,
            "namespace": self.namespace,
        }
        if tier:
            body["tier"] = tier
        try:
            result = self._request("POST", "/api/v1/agent/search", body)
            if isinstance(result, list):
                return result
            return result.get("results", result.get("nodes", []))
        except Exception as e:
            logger.warning("Sulcus search failed: %s", e)
            return []

    def hot_nodes(self, limit: int = 20) -> List[dict]:
        """Get hottest nodes."""
        try:
            result = self._request(
                "GET",
                f"/api/v1/agent/hot_nodes?namespace={self.namespace}&limit={limit}",
            )
            # API returns a list directly, not a dict wrapper
            if isinstance(result, list):
                return result
            return result.get("nodes", result.get("results", []))
        except Exception as e:
            logger.warning("Sulcus hot_nodes failed: %s", e)
            return []

    # -- Store --

    def store(
        self,
        label: str,
        pointer_summary: str,
        memory_type: str = "episodic",
        raw_content: str = "",
        metadata: Optional[dict] = None,
    ) -> dict:
        """Store a new memory node."""
        body: Dict[str, Any] = {
            "label": label,
            "pointer_summary": pointer_summary,
            "namespace": self.namespace,
            "memory_type": memory_type,
        }
        if raw_content:
            body["raw_content"] = raw_content
        if metadata:
            body["metadata"] = metadata
        result = self._request("POST", "/api/v1/agent/nodes", body)

        # Bug fix #4: detect rejected stores
        if result.get("status") == "rejected":
            reason = result.get("reason", "unknown")
            logger.warning("Sulcus store rejected: %s", reason)
            raise ValueError(f"Memory store rejected: {reason}")

        return result

    # -- Get / Update --

    def get_node(self, node_id: str) -> Optional[dict]:
        """Get a node by ID."""
        try:
            return self._request("GET", f"/api/v1/agent/nodes/{node_id}")
        except Exception:
            return None

    def update_node(self, node_id: str, updates: dict) -> dict:
        """Update a node."""
        return self._request("PATCH", f"/api/v1/agent/nodes/{node_id}", updates)

    def boost(self, node_id: str, strength: float = 0.3) -> dict:
        """Boost a node's heat."""
        return self._request(
            "POST",
            f"/api/v1/agent/nodes/{node_id}/boost",
            {"strength": strength},
        )

    def deprecate(self, node_id: str, reason: str = "") -> dict:
        """Deprecate a node."""
        body: Dict[str, Any] = {}
        if reason:
            body["reason"] = reason
        return self._request(
            "POST",
            f"/api/v1/agent/nodes/{node_id}/deprecate",
            body,
        )

    def feedback(self, node_id: str, signal: str) -> dict:
        """Send feedback on a node (useful, outdated, irrelevant, etc)."""
        return self._request(
            "POST",
            f"/api/v1/agent/nodes/{node_id}/feedback",
            {"signal": signal},
        )

    # -- Build context --

    def build_context(self, prompt: str, token_budget: int = 2000) -> str:
        """Get context block for system prompt."""
        try:
            result = self._request(
                "POST",
                "/api/v1/agent/context",
                {
                    "prompt": prompt,
                    "token_budget": token_budget,
                    "namespace": self.namespace,
                },
            )
            return result.get("context", "")
        except Exception:
            return ""


# ---------------------------------------------------------------------------
# MemoryProvider Implementation
# ---------------------------------------------------------------------------

class SulcusProvider(MemoryProvider):
    """Sulcus Cloud memory provider for Hermes Agent."""

    def __init__(self):
        self._client: Optional[SulcusClient] = None
        self._session_id = ""
        self._turn_counter = 0
        self._prefetch_cache: str = ""
        self._prefetch_lock = threading.Lock()
        self._agent_context = "primary"
        self._platform = "cli"
        self._hermes_home = ""
        self._initialized = False

    @property
    def name(self) -> str:
        return "sulcus"

    # -- Core lifecycle -------------------------------------------------------

    def is_available(self) -> bool:
        """Check if Sulcus is configured. Parses .env as fallback (bug fix #1)."""
        api_key = _get_env("SULCUS_API_KEY")
        server_url = _get_env("SULCUS_SERVER_URL")
        namespace = _get_env("SULCUS_NAMESPACE")
        return bool(api_key and server_url and namespace)

    def initialize(self, session_id: str, **kwargs) -> None:
        """Initialize the Sulcus client for this session."""
        self._session_id = session_id
        self._agent_context = kwargs.get("agent_context", "primary")
        self._platform = kwargs.get("platform", "cli")
        self._hermes_home = kwargs.get("hermes_home", "")
        self._turn_counter = 0
        self._prefetch_cache = ""

        api_key = _get_env("SULCUS_API_KEY")
        server_url = _get_env("SULCUS_SERVER_URL")
        namespace = _get_env("SULCUS_NAMESPACE")

        if not all([api_key, server_url, namespace]):
            logger.warning("Sulcus not fully configured — missing env vars")
            return

        self._client = SulcusClient(server_url, api_key, namespace)
        self._initialized = True
        logger.info(
            "Sulcus provider initialized (namespace=%s, session=%s, context=%s)",
            namespace,
            session_id[:12],
            self._agent_context,
        )

    def system_prompt_block(self) -> str:
        """Return static system prompt text about Sulcus availability."""
        if not self._initialized:
            return ""
        return (
            "\n## Sulcus Memory\n"
            "You have persistent cross-session memory via Sulcus Cloud. "
            "Use sulcus_recall to search past context, sulcus_store to save important "
            "information, and sulcus_pin to protect critical memories from decay. "
            "Sulcus memories persist across sessions and agent restarts.\n"
        )

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Return cached recall context for this turn."""
        with self._prefetch_lock:
            result = self._prefetch_cache
            self._prefetch_cache = ""
            return result

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        """Background recall for the next turn."""
        if not self._client or not query.strip():
            return

        def _do_prefetch():
            try:
                nodes = self._client.search(query, limit=5, tier="all")
                if not nodes:
                    return
                lines = ["## Sulcus Recall (auto-retrieved)"]
                for n in nodes:
                    label = _node_label(n)
                    heat = _node_heat(n)
                    mtype = n.get("memory_type", "unknown")
                    lines.append(f"- [{mtype} | heat:{heat:.2f}] {_truncate(label)}")
                with self._prefetch_lock:
                    self._prefetch_cache = "\n".join(lines) + "\n"
            except Exception as e:
                logger.debug("Sulcus prefetch failed: %s", e)

        threading.Thread(target=_do_prefetch, daemon=True).start()

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """Store turn as episodic memory. Skip non-primary contexts."""
        if self._agent_context != "primary":
            return
        if not self._client:
            return
        if not user_content or not user_content.strip():
            return

        self._turn_counter += 1

        def _do_sync():
            try:
                # Classify the turn
                mtype = self._classify_turn(user_content)

                # Store user turn (verbatim — MemPalace philosophy)
                label = _truncate(user_content, 100)
                self._client.store(
                    label=label,
                    pointer_summary=user_content,
                    memory_type=mtype,
                    raw_content=user_content,
                    metadata={
                        "session_id": session_id or self._session_id,
                        "turn": self._turn_counter,
                        "source": "user",
                    },
                )

                # Store assistant turn at lower utility
                if assistant_content and assistant_content.strip():
                    asst_label = f"[asst] {_truncate(assistant_content, 80)}"
                    self._client.store(
                        label=asst_label,
                        pointer_summary=f"[asst] {assistant_content}",
                        memory_type="episodic",
                        raw_content=f"[asst] {assistant_content}",
                        metadata={
                            "session_id": session_id or self._session_id,
                            "turn": self._turn_counter,
                            "source": "assistant",
                            "base_utility": 0.5,
                        },
                    )
            except Exception as e:
                logger.debug("Sulcus sync_turn failed: %s", e)

        threading.Thread(target=_do_sync, daemon=True).start()

    def shutdown(self) -> None:
        """Clean shutdown."""
        self._initialized = False
        logger.info("Sulcus provider shut down")

    # -- Tool schemas ---------------------------------------------------------

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """Return tool schemas for Sulcus operations."""
        return [
            {
                "name": "sulcus_recall",
                "description": (
                    "Search Sulcus cross-session memory for relevant past context. "
                    "Use when you need to recall something from a previous session, "
                    "a user preference, a past decision, or any stored knowledge."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "What to search for in memory",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Max results (default 5)",
                            "default": 5,
                        },
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "sulcus_store",
                "description": (
                    "Store an important piece of information in Sulcus cross-session memory. "
                    "Use for facts, preferences, decisions, procedures, or insights that "
                    "should persist across sessions."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "The content to store",
                        },
                        "memory_type": {
                            "type": "string",
                            "enum": [
                                "episodic",
                                "semantic",
                                "preference",
                                "procedural",
                                "fact",
                            ],
                            "description": "Type of memory (affects decay rate)",
                            "default": "semantic",
                        },
                        "label": {
                            "type": "string",
                            "description": "Short label for the memory (auto-generated if omitted)",
                        },
                    },
                    "required": ["content"],
                },
            },
            {
                "name": "sulcus_get",
                "description": "Get a specific memory node by ID.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "node_id": {
                            "type": "string",
                            "description": "The node UUID to retrieve",
                        },
                    },
                    "required": ["node_id"],
                },
            },
            {
                "name": "sulcus_pin",
                "description": (
                    "Pin a memory to prevent it from decaying. Use for critical "
                    "preferences, identity info, and core procedures."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "node_id": {
                            "type": "string",
                            "description": "The node UUID to pin",
                        },
                    },
                    "required": ["node_id"],
                },
            },
            {
                "name": "sulcus_consolidate",
                "description": (
                    "Get hot nodes overview — see what's actively in Sulcus memory. "
                    "Use to understand current memory state and find nodes to manage."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "integer",
                            "description": "Max nodes to return (default 10)",
                            "default": 10,
                        },
                    },
                },
            },
        ]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        """Dispatch tool calls."""
        if not self._client:
            return json.dumps({"error": "Sulcus not initialized"})

        try:
            if tool_name == "sulcus_recall":
                return self._tool_recall(args)
            elif tool_name == "sulcus_store":
                return self._tool_store(args)
            elif tool_name == "sulcus_get":
                return self._tool_get(args)
            elif tool_name == "sulcus_pin":
                return self._tool_pin(args)
            elif tool_name == "sulcus_consolidate":
                return self._tool_consolidate(args)
            else:
                return json.dumps({"error": f"Unknown tool: {tool_name}"})
        except Exception as e:
            logger.warning("Sulcus tool %s failed: %s", tool_name, e)
            return json.dumps({"error": str(e)})

    # -- Tool implementations --

    def _tool_recall(self, args: dict) -> str:
        query = args.get("query", "")
        limit = args.get("limit", 5)
        nodes = self._client.search(query, limit=limit, tier="all")

        if not nodes:
            return json.dumps({"result": "No memories found matching your query."})

        results = []
        for n in nodes:
            results.append({
                "id": n.get("node_id", n.get("id", "")),
                "content": _node_label(n),
                "type": n.get("memory_type", "unknown"),
                "heat": _node_heat(n),
                "created": n.get("created_at", ""),
            })
        return json.dumps({"results": results, "count": len(results)})

    def _tool_store(self, args: dict) -> str:
        content = args.get("content", "")
        memory_type = args.get("memory_type", "semantic")
        label = args.get("label", _truncate(content, 100))

        result = self._client.store(
            label=label,
            pointer_summary=content,
            memory_type=memory_type,
            raw_content=content,
            metadata={
                "session_id": self._session_id,
                "source": "tool",
            },
        )
        node_id = result.get("node_id", result.get("id", "unknown"))
        return json.dumps({
            "stored": True,
            "node_id": node_id,
            "memory_type": memory_type,
        })

    def _tool_get(self, args: dict) -> str:
        node_id = args.get("node_id", "")
        node = self._client.get_node(node_id)
        if not node:
            return json.dumps({"error": f"Node {node_id} not found"})
        return json.dumps({
            "id": node.get("node_id", node.get("id", "")),
            "label": node.get("label", ""),
            "content": _node_label(node),
            "type": node.get("memory_type", ""),
            "heat": _node_heat(node),
            "pinned": node.get("is_pinned", False),
            "created": node.get("created_at", ""),
        })

    def _tool_pin(self, args: dict) -> str:
        node_id = args.get("node_id", "")
        result = self._client.update_node(node_id, {"is_pinned": True})
        return json.dumps({"pinned": True, "node_id": node_id})

    def _tool_consolidate(self, args: dict) -> str:
        limit = args.get("limit", 10)
        nodes = self._client.hot_nodes(limit=limit)
        results = []
        for n in nodes:
            results.append({
                "id": n.get("node_id", n.get("id", "")),
                "label": _truncate(_node_label(n), 80),
                "type": n.get("memory_type", "unknown"),
                "heat": _node_heat(n),
                "pinned": n.get("is_pinned", False),
            })
        return json.dumps({"hot_nodes": results, "count": len(results)})

    # -- Optional hooks -------------------------------------------------------

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        """Track turn count."""
        self._turn_counter = turn_number

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """Extract semantic facts from the full conversation at session end."""
        if self._agent_context != "primary":
            return
        if not self._client or not messages:
            return

        # Extract user messages for fact extraction
        user_msgs = [
            m.get("content", "")
            for m in messages
            if m.get("role") == "user" and m.get("content")
        ]
        if len(user_msgs) < 3:
            return  # Too short for meaningful extraction

        try:
            combined = "\n".join(user_msgs[-10:])  # Last 10 user messages
            self._client.store(
                label=f"Session summary ({self._session_id[:12]})",
                pointer_summary=f"Session topics: {_truncate(combined, 500)}",
                memory_type="episodic",
                metadata={
                    "session_id": self._session_id,
                    "source": "session_end",
                    "turn_count": self._turn_counter,
                },
            )
        except Exception as e:
            logger.debug("Sulcus on_session_end failed: %s", e)

    def on_session_switch(
        self,
        new_session_id: str,
        *,
        parent_session_id: str = "",
        reset: bool = False,
        rewound: bool = False,
        **kwargs,
    ) -> None:
        """Handle session switches — update internal state."""
        old_id = self._session_id
        self._session_id = new_session_id
        if reset:
            self._turn_counter = 0
            self._prefetch_cache = ""
        logger.debug(
            "Sulcus session switch: %s → %s (reset=%s)",
            old_id[:12] if old_id else "none",
            new_session_id[:12],
            reset,
        )

    def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
        """Extract insights from messages about to be compressed."""
        if not self._client or not messages:
            return ""

        user_msgs = [
            m.get("content", "")
            for m in messages
            if m.get("role") == "user" and m.get("content")
        ]
        if not user_msgs:
            return ""

        try:
            combined = "\n".join(user_msgs[-5:])
            self._client.store(
                label=f"Pre-compression rescue ({self._session_id[:12]})",
                pointer_summary=combined,
                memory_type="episodic",
                metadata={
                    "session_id": self._session_id,
                    "source": "pre_compress",
                },
            )
        except Exception as e:
            logger.debug("Sulcus pre_compress store failed: %s", e)

        return ""  # Don't inject into compression prompt

    def on_memory_write(
        self,
        action: str,
        target: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Mirror built-in memory writes to Sulcus."""
        if not self._client or action == "remove":
            return

        def _do_mirror():
            try:
                mtype = "preference" if target == "user" else "semantic"
                label = f"[hermes:{target}] {_truncate(content, 80)}"
                self._client.store(
                    label=label,
                    pointer_summary=content,
                    memory_type=mtype,
                    metadata={
                        "session_id": self._session_id,
                        "source": f"memory_write:{action}:{target}",
                        **(metadata or {}),
                    },
                )
            except Exception as e:
                logger.debug("Sulcus memory mirror failed: %s", e)

        threading.Thread(target=_do_mirror, daemon=True).start()

    def on_delegation(self, task: str, result: str, *,
                      child_session_id: str = "", **kwargs) -> None:
        """Store subagent task/result as procedural memory."""
        if not self._client:
            return

        def _do_store():
            try:
                self._client.store(
                    label=f"[delegation] {_truncate(task, 80)}",
                    pointer_summary=f"Task: {task}\n\nResult: {_truncate(result, 400)}",
                    memory_type="procedural",
                    metadata={
                        "session_id": self._session_id,
                        "child_session_id": child_session_id,
                        "source": "delegation",
                    },
                )
            except Exception as e:
                logger.debug("Sulcus delegation store failed: %s", e)

        threading.Thread(target=_do_store, daemon=True).start()

    # -- Turn classification (MemPalace-inspired) ---

    _PREFERENCE_PATTERNS = [
        re.compile(r"\bi (?:prefer|like|want|need|always|never|hate)\b", re.I),
        re.compile(r"\b(?:don't|do not) (?:use|like|want)\b", re.I),
        re.compile(r"\bmy (?:name|email|phone|address|favorite|preferred)\b", re.I),
        re.compile(r"\bcall me\b", re.I),
        re.compile(r"\buse (?:tabs|spaces|dark mode|light mode)\b", re.I),
    ]

    _DECISION_PATTERNS = [
        re.compile(r"\blet'?s (?:go with|use|pick|choose|stick with)\b", re.I),
        re.compile(r"\bwe(?:'re| are) (?:going|using|switching)\b", re.I),
        re.compile(r"\bdecided to\b", re.I),
    ]

    _FACT_PATTERNS = [
        re.compile(r"\b(?:the|our) (?:server|api|database|repo|project|stack)\b", re.I),
        re.compile(r"\bwe use\b", re.I),
        re.compile(r"\b(?:running|deployed|hosted) (?:on|at|in)\b", re.I),
        re.compile(r"\bversion \d", re.I),
    ]

    def _classify_turn(self, text: str) -> str:
        """Classify a user turn into a memory type."""
        if any(p.search(text) for p in self._PREFERENCE_PATTERNS):
            return "preference"
        if any(p.search(text) for p in self._DECISION_PATTERNS):
            return "semantic"
        if any(p.search(text) for p in self._FACT_PATTERNS):
            return "fact"
        return "episodic"

    # -- Config schema for `hermes memory setup` ---

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {
                "key": "api_key",
                "description": "Sulcus API key (from app.sulcus.ca)",
                "secret": True,
                "required": True,
                "env_var": "SULCUS_API_KEY",
                "url": "https://app.sulcus.ca/settings/api-keys",
            },
            {
                "key": "server_url",
                "description": "Sulcus server URL",
                "secret": True,
                "required": True,
                "default": "https://api.sulcus.ca",
                "env_var": "SULCUS_SERVER_URL",
            },
            {
                "key": "namespace",
                "description": "Sulcus namespace (agent identity)",
                "secret": True,
                "required": True,
                "env_var": "SULCUS_NAMESPACE",
            },
        ]


# ---------------------------------------------------------------------------
# Plugin registration
# ---------------------------------------------------------------------------

def register(ctx):
    """Register the Sulcus memory provider with Hermes."""
    ctx.register_memory_provider(SulcusProvider())
