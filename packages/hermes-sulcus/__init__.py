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
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from agent.memory_provider import MemoryProvider

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# MCP Client (subprocess stdio JSON-RPC)
# ---------------------------------------------------------------------------

_MCP_BINARY = "/usr/local/bin/sulcus"
_MCP_CALL_TIMEOUT = 10  # seconds for individual tool calls
_MCP_INIT_TIMEOUT = 5   # seconds for initialize handshake


class SulcusMCPClient:
    """Lightweight MCP client over subprocess stdio.

    Spawns `sulcus mcp stdio` once, communicates via JSON-RPC 2.0 over
    stdin/stdout. Thread-safe: all reads/writes are serialized behind a lock.
    """

    def __init__(self, binary: str = _MCP_BINARY):
        self._binary = binary
        self._proc: Optional[Any] = None
        self._lock = threading.Lock()
        self._next_id = 1
        self._alive = False

    def connect(self, timeout: int = _MCP_INIT_TIMEOUT) -> bool:
        """Spawn the MCP subprocess and perform the initialize handshake.

        Returns True if successful, False otherwise.
        """
        import subprocess as _sp

        with self._lock:
            if self._alive and self._proc and self._proc.poll() is None:
                return True

            try:
                self._proc = _sp.Popen(
                    [self._binary, "mcp", "stdio"],
                    stdin=_sp.PIPE,
                    stdout=_sp.PIPE,
                    stderr=_sp.PIPE,
                    text=True,
                    bufsize=1,  # line-buffered
                )
            except FileNotFoundError:
                logger.warning("MCP binary not found at %s", self._binary)
                return False
            except Exception as e:
                logger.warning("MCP subprocess spawn failed: %s", e)
                return False

            # Initialize handshake
            try:
                resp = self._send_recv_locked(
                    "initialize",
                    {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "hermes-sulcus", "version": "1.0"},
                    },
                    timeout=timeout,
                )
                if not resp or "result" not in resp:
                    logger.warning("MCP initialize failed: %s", resp)
                    self._kill_locked()
                    return False

                # Send initialized notification
                self._write_locked({
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized",
                })
                self._alive = True
                server = resp.get("result", {}).get("serverInfo", {})
                logger.info(
                    "MCP client connected: %s v%s",
                    server.get("name", "?"),
                    server.get("version", "?"),
                )
                return True
            except Exception as e:
                logger.warning("MCP initialize handshake failed: %s", e)
                self._kill_locked()
                return False

    def call(
        self, tool_name: str, arguments: dict, timeout: int = _MCP_CALL_TIMEOUT
    ) -> Optional[str]:
        """Call an MCP tool. Returns the text content or None on error.

        Thread-safe: acquires the lock for the full send/recv cycle.
        """
        with self._lock:
            if not self._alive or not self._proc or self._proc.poll() is not None:
                self._alive = False
                return None

            try:
                resp = self._send_recv_locked(
                    "tools/call",
                    {"name": tool_name, "arguments": arguments},
                    timeout=timeout,
                )
                if not resp:
                    return None
                if "error" in resp:
                    logger.debug("MCP tool %s error: %s", tool_name, resp["error"])
                    return None
                # MCP tools/call returns: result.content[{type, text}]
                content = resp.get("result", {}).get("content", [])
                if content and isinstance(content, list):
                    return content[0].get("text", "")
                return None
            except Exception as e:
                logger.debug("MCP call %s failed: %s", tool_name, e)
                return None

    def close(self) -> None:
        """Terminate the MCP subprocess."""
        with self._lock:
            self._kill_locked()

    @property
    def is_connected(self) -> bool:
        """Check if the MCP subprocess is alive."""
        with self._lock:
            if self._alive and self._proc and self._proc.poll() is None:
                return True
            self._alive = False
            return False

    # -- Internal (must hold lock) --

    def _write_locked(self, msg: dict) -> None:
        """Write a JSON-RPC message to the subprocess stdin. Caller holds lock."""
        if not self._proc or not self._proc.stdin:
            return
        self._proc.stdin.write(json.dumps(msg) + "\n")
        self._proc.stdin.flush()

    def _read_locked(self, timeout: int) -> Optional[dict]:
        """Read one JSON-RPC response from subprocess stdout. Caller holds lock."""
        if not self._proc or not self._proc.stdout:
            return None

        import select
        ready, _, _ = select.select([self._proc.stdout], [], [], timeout)
        if not ready:
            logger.debug("MCP read timeout after %ds", timeout)
            return None

        line = self._proc.stdout.readline().strip()
        if not line:
            return None
        try:
            return json.loads(line)
        except json.JSONDecodeError as e:
            logger.debug("MCP JSON decode error: %s (line: %s)", e, line[:200])
            return None

    def _send_recv_locked(
        self, method: str, params: dict, timeout: int = _MCP_CALL_TIMEOUT
    ) -> Optional[dict]:
        """Send a JSON-RPC request and read the response. Caller holds lock."""
        msg_id = self._next_id
        self._next_id += 1
        self._write_locked({
            "jsonrpc": "2.0",
            "id": msg_id,
            "method": method,
            "params": params,
        })
        return self._read_locked(timeout)

    def _kill_locked(self) -> None:
        """Kill the subprocess. Caller holds lock."""
        self._alive = False
        if self._proc:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=3)
            except Exception:
                try:
                    self._proc.kill()
                except Exception:
                    pass
            self._proc = None


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


# Stop words for keyword extraction — common filler words to strip
_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "must",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "it",
    "they", "them", "his", "her", "its", "this", "that", "these", "those",
    "what", "which", "who", "whom", "where", "when", "why", "how",
    "and", "or", "but", "if", "then", "so", "not", "no", "nor",
    "at", "by", "for", "from", "in", "of", "on", "to", "with", "about",
    "up", "out", "off", "over", "into", "through", "between",
    "just", "also", "very", "too", "really", "quite", "much",
    "please", "thanks", "thank", "ok", "okay", "yes", "yeah", "no",
    "hi", "hello", "hey", "well", "right", "like", "know", "think",
    "want", "get", "got", "go", "going", "let", "make", "thing",
    "some", "any", "all", "each", "every", "both", "few", "more",
    "other", "another", "such", "only", "same", "than", "own",
    "here", "there", "now", "then", "still", "already", "again",
    "back", "even", "also", "just", "about", "been", "being",
})


def _extract_keywords(text: str, max_keywords: int = 6) -> List[str]:
    """Extract meaningful keywords from text by removing stop words and filler.

    Returns a list of unique keywords, preserving order of first occurrence.
    Compound terms (e.g. 'dark mode') are kept together when adjacent
    non-stop words appear.
    """
    # Tokenize: split on non-alphanumeric (keep hyphens within words)
    tokens = re.findall(r"[a-zA-Z][\w-]*", text.lower())

    # Filter: remove stop words and very short tokens
    meaningful = [t for t in tokens if t not in _STOP_WORDS and len(t) > 1]

    # Deduplicate while preserving order
    seen: set = set()
    unique: List[str] = []
    for t in meaningful:
        if t not in seen:
            seen.add(t)
            unique.append(t)

    return unique[:max_keywords]


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
        self._mcp: Optional[SulcusMCPClient] = None
        self._session_id = ""
        self._turn_counter = 0
        self._prefetch_cache: str = ""
        self._prefetch_lock = threading.Lock()
        self._agent_context = "primary"
        self._platform = "cli"
        self._hermes_home = ""
        self._initialized = False
        self._identity_context: str = ""  # Cached pinned + preference nodes

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
        """Initialize the Sulcus client and fetch identity context."""
        self._session_id = session_id
        self._agent_context = kwargs.get("agent_context", "primary")
        self._platform = kwargs.get("platform", "cli")
        self._hermes_home = kwargs.get("hermes_home", "")
        self._turn_counter = 0
        self._prefetch_cache = ""
        self._identity_context = ""

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

        # Spawn MCP client for smart recall (graph hops, hot nodes, token budgets).
        # Falls back to REST search if the binary is missing or handshake fails.
        self._mcp = SulcusMCPClient()
        if self._mcp.connect():
            logger.info("Sulcus MCP client connected — smart recall enabled")
        else:
            logger.info("Sulcus MCP client unavailable — falling back to REST recall")
            self._mcp = None

        # Fetch identity context: pinned nodes + top preference nodes
        self._refresh_identity_context()

    def system_prompt_block(self) -> str:
        """Return system prompt with identity context from pinned/preference memories."""
        if not self._initialized:
            return ""

        lines = [
            "\n## Sulcus Memory",
            "You have persistent cross-session memory via Sulcus Cloud. "
            "Use sulcus_recall to search past context, sulcus_store to save important "
            "information, and sulcus_pin to protect critical memories from decay. "
            "Sulcus memories persist across sessions and agent restarts.",
        ]

        if self._identity_context:
            lines.append("")
            lines.append(self._identity_context)

        return "\n".join(lines) + "\n"

    def _refresh_identity_context(self) -> None:
        """Fetch identity context for the system prompt.

        Strategy:
        1. If MCP is available, use build_context with identity query — the engine
           handles search, ranking, token budgeting, and formatting.
        2. Fall back to REST: fetch hot_nodes + preference search, format manually.

        Called at initialize() and on session switch with reset=True.
        This is a blocking call — acceptable at session start (~200ms).
        """
        if not self._client:
            return

        # Try MCP path first — engine handles everything
        if self._mcp and self._mcp.is_connected:
            try:
                t0 = time.monotonic()
                result = self._mcp.call(
                    "sulcus_build_context",
                    {"query": "user identity preferences pinned memories", "token_budget": 500},
                    timeout=5,
                )
                if result:
                    # Parse the JSON response from MCP
                    try:
                        data = json.loads(result)
                        context = data.get("context", result) if isinstance(data, dict) else result
                    except (json.JSONDecodeError, TypeError):
                        context = result

                    if context and isinstance(context, str) and len(context.strip()) > 10:
                        self._identity_context = context.strip()
                        elapsed = time.monotonic() - t0
                        logger.debug(
                            "Sulcus identity context via MCP: %d chars in %.3fs",
                            len(self._identity_context), elapsed,
                        )
                        return
            except Exception as e:
                logger.debug("Sulcus MCP identity context failed, falling back to REST: %s", e)

        # REST fallback — manual hot_nodes + search + format
        self._refresh_identity_context_rest()

    def _refresh_identity_context_rest(self) -> None:
        """REST fallback for identity context: hot_nodes + preference search."""
        if not self._client:
            return

        try:
            t0 = time.monotonic()
            # Fetch hot nodes — these include pinned and high-heat nodes
            hot = self._client.hot_nodes(limit=20)

            # Separate pinned and preference nodes
            pinned: List[dict] = []
            preferences: List[dict] = []

            for node in hot:
                if node.get("is_pinned"):
                    pinned.append(node)
                elif node.get("memory_type", "").lower() == "preference":
                    preferences.append(node)

            # Also do a targeted preference search if we didn't get enough
            if len(preferences) < 3:
                try:
                    pref_results = self._client.search(
                        "user preferences identity", limit=5, tier="all"
                    )
                    for n in pref_results:
                        nid = n.get("node_id", n.get("id", ""))
                        existing_ids = {
                            p.get("node_id", p.get("id", ""))
                            for p in pinned + preferences
                        }
                        if nid not in existing_ids and n.get("memory_type", "").lower() == "preference":
                            preferences.append(n)
                except Exception:
                    pass

            # Format identity context
            sections: List[str] = []
            if pinned:
                lines = ["### Pinned Memories"]
                for n in pinned[:10]:
                    label = _node_label(n)
                    mtype = n.get("memory_type", "unknown")
                    lines.append(f"- [{mtype}] {_truncate(label, 200)}")
                sections.append("\n".join(lines))

            if preferences:
                lines = ["### User Preferences"]
                for n in preferences[:5]:
                    label = _node_label(n)
                    lines.append(f"- {_truncate(label, 200)}")
                sections.append("\n".join(lines))

            self._identity_context = "\n\n".join(sections) if sections else ""

            elapsed = time.monotonic() - t0
            logger.debug(
                "Sulcus identity context: %d pinned, %d preferences in %.3fs",
                len(pinned), len(preferences), elapsed,
            )
        except Exception as e:
            logger.debug("Sulcus identity context fetch failed: %s", e)
            self._identity_context = ""

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Return cached recall context for this turn.

        On the first turn (turn_counter <= 1) when the cache is empty,
        performs a synchronous blocking recall so context is available
        immediately — eliminates the one-turn-late problem.

        Strategy:
        1. Return cached results from queue_prefetch() if available.
        2. MCP path: sulcus_build_context (engine handles search + graph + ranking).
        3. REST fallback: multi-query fan-out with manual merge and rank.
        """
        with self._prefetch_lock:
            cached = self._prefetch_cache
            self._prefetch_cache = ""

        # If we have cached results from a previous queue_prefetch, use them
        if cached:
            return cached

        # Synchronous first-turn recall when cache is empty
        if not query.strip() or self._turn_counter > 1:
            return ""

        # Try MCP path first — single call, engine handles everything
        if self._mcp and self._mcp.is_connected:
            try:
                t0 = time.monotonic()
                result = self._mcp.call(
                    "sulcus_build_context",
                    {"query": query, "token_budget": 1500},
                    timeout=5,
                )
                if result:
                    try:
                        data = json.loads(result)
                        context = data.get("context", result) if isinstance(data, dict) else result
                    except (json.JSONDecodeError, TypeError):
                        context = result

                    if context and isinstance(context, str) and len(context.strip()) > 10:
                        elapsed = time.monotonic() - t0
                        logger.debug(
                            "Sulcus first-turn MCP prefetch: %d chars in %.3fs",
                            len(context), elapsed,
                        )
                        return context.strip()
            except Exception as e:
                logger.debug("Sulcus MCP prefetch failed, trying REST: %s", e)

        # REST fallback: multi-query fan-out
        if self._client:
            try:
                t0 = time.monotonic()
                keywords = _extract_keywords(query)
                keyword_str = " ".join(keywords) if keywords else query

                # Build parallel queries
                queries = [("semantic", query, 10)]
                if keywords:
                    queries.append(("procedural", f"procedure: {keyword_str}", 5))
                    queries.append(("preference", f"preference: {keyword_str}", 3))

                all_nodes: List[dict] = []
                with ThreadPoolExecutor(max_workers=3) as executor:
                    futures = {
                        executor.submit(
                            self._client.search, q, limit=lim, tier="all"
                        ): label
                        for label, q, lim in queries
                    }
                    for future in as_completed(futures, timeout=5):
                        try:
                            nodes = future.result(timeout=2)
                            if nodes:
                                all_nodes.extend(nodes)
                        except Exception:
                            pass

                elapsed = time.monotonic() - t0
                if all_nodes:
                    merged = self._merge_and_rank(all_nodes, limit=10)
                    logger.debug(
                        "Sulcus first-turn REST prefetch: %d results in %.3fs (%d queries)",
                        len(merged), elapsed, len(queries),
                    )
                    return self._format_prefetch_results(merged)
                else:
                    logger.debug(
                        "Sulcus first-turn REST prefetch: 0 results in %.3fs",
                        elapsed,
                    )
            except Exception as e:
                logger.debug("Sulcus first-turn prefetch failed: %s", e)

        return ""

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        """Background recall for the next turn.

        Strategy:
        1. MCP path: sulcus_auto_recall (graph hops + hot nodes + semantic search).
        2. REST fallback: multi-query fan-out with manual merge and rank.

        Results are cached for the next prefetch() call.
        """
        if not query.strip():
            return
        if not self._client and not (self._mcp and self._mcp.is_connected):
            return

        def _do_prefetch():
            try:
                # Try MCP path first
                if self._mcp and self._mcp.is_connected:
                    try:
                        t0 = time.monotonic()
                        result = self._mcp.call(
                            "sulcus_auto_recall",
                            {"query": query, "token_budget": 1500, "graph_hops": True},
                            timeout=5,
                        )
                        if result:
                            try:
                                data = json.loads(result)
                                context = data.get("context", result) if isinstance(data, dict) else result
                            except (json.JSONDecodeError, TypeError):
                                context = result

                            if context and isinstance(context, str) and len(context.strip()) > 10:
                                elapsed = time.monotonic() - t0
                                logger.debug(
                                    "Sulcus MCP queue_prefetch: %d chars in %.3fs",
                                    len(context), elapsed,
                                )
                                with self._prefetch_lock:
                                    self._prefetch_cache = context.strip()
                                return
                    except Exception as e:
                        logger.debug("Sulcus MCP queue_prefetch failed, trying REST: %s", e)

                # REST fallback
                if not self._client:
                    return

                t0 = time.monotonic()
                keywords = _extract_keywords(query)
                keyword_str = " ".join(keywords) if keywords else query

                # Define parallel queries
                queries = [
                    ("semantic", query, 10),
                ]
                if keywords:
                    queries.append(("procedural", f"procedure: {keyword_str}", 5))
                    queries.append(("preference", f"preference: {keyword_str}", 3))

                all_nodes: List[dict] = []

                with ThreadPoolExecutor(max_workers=3) as executor:
                    futures = {
                        executor.submit(
                            self._client.search, q, limit=lim, tier="all"
                        ): label
                        for label, q, lim in queries
                    }
                    for future in as_completed(futures, timeout=5):
                        label = futures[future]
                        try:
                            nodes = future.result(timeout=2)
                            if nodes:
                                all_nodes.extend(nodes)
                        except Exception as e:
                            logger.debug("Sulcus prefetch query '%s' failed: %s", label, e)

                if not all_nodes:
                    return

                # Deduplicate and rank
                merged = self._merge_and_rank(all_nodes, limit=10)
                formatted = self._format_prefetch_results(merged)

                elapsed = time.monotonic() - t0
                logger.debug(
                    "Sulcus multi-query prefetch: %d unique results in %.3fs (%d queries)",
                    len(merged), elapsed, len(queries),
                )

                with self._prefetch_lock:
                    self._prefetch_cache = formatted
            except Exception as e:
                logger.debug("Sulcus prefetch failed: %s", e)

        threading.Thread(target=_do_prefetch, daemon=True).start()

    @staticmethod
    def _merge_and_rank(nodes: List[dict], limit: int = 10) -> List[dict]:
        """Deduplicate nodes by ID and rank by relevance_score × heat.

        Returns the top `limit` nodes.
        """
        seen: Dict[str, dict] = {}
        for n in nodes:
            nid = n.get("node_id", n.get("id", ""))
            if not nid or nid in seen:
                continue
            # Compute composite score: relevance (from search) × heat
            relevance = float(n.get("relevance_score", n.get("score", 0.5)))
            heat = _node_heat(n)
            n["_composite_score"] = relevance * max(heat, 0.01)
            seen[nid] = n

        ranked = sorted(seen.values(), key=lambda x: x.get("_composite_score", 0), reverse=True)
        return ranked[:limit]

    @staticmethod
    def _format_prefetch_results(
        nodes: List[dict], token_budget: int = 2000
    ) -> str:
        """Format search result nodes into structured context blocks.

        Groups results by memory type with priority ordering:
          1. Procedures (instructions the agent should follow)
          2. Preferences (user identity / style directives)
          3. Facts & Config (semantic knowledge)
          4. Recent Context (episodic history)

        Token budget enforcement: estimates tokens as chars/4, truncates
        from the bottom sections (episodic first) to stay within budget.
        Procedures and preferences are never truncated.
        """
        if not nodes:
            return ""

        # Group nodes by type category
        procedures: List[str] = []
        preferences: List[str] = []
        facts: List[str] = []
        history: List[str] = []

        for n in nodes:
            mtype = n.get("memory_type", "unknown").lower()
            label = _node_label(n)
            heat = _node_heat(n)
            line = f"- [{mtype} | heat:{heat:.1f}] {_truncate(label)}"

            if mtype == "procedural":
                procedures.append(line)
            elif mtype == "preference":
                preferences.append(line)
            elif mtype in ("semantic", "fact", "synthesis"):
                facts.append(line)
            else:
                # episodic, unknown, and everything else
                history.append(line)

        # Build sections in priority order
        sections: List[str] = []
        if procedures:
            sections.append("### Procedures\n" + "\n".join(procedures))
        if preferences:
            sections.append("### Preferences\n" + "\n".join(preferences))
        if facts:
            sections.append("### Facts & Config\n" + "\n".join(facts))
        if history:
            sections.append("### Recent Context\n" + "\n".join(history))

        if not sections:
            return ""

        # Assemble with header
        header = "## Sulcus Recall (auto-retrieved)"
        full = header + "\n" + "\n\n".join(sections) + "\n"

        # Token budget enforcement (estimate: 1 token ≈ 4 chars)
        char_budget = token_budget * 4
        if len(full) <= char_budget:
            return full

        # Truncate from the bottom: remove history first, then facts
        # Never truncate procedures or preferences
        protected = header + "\n"
        if procedures:
            protected += "### Procedures\n" + "\n".join(procedures) + "\n\n"
        if preferences:
            protected += "### Preferences\n" + "\n".join(preferences) + "\n\n"

        remaining_budget = char_budget - len(protected)
        if remaining_budget <= 0:
            return protected.rstrip() + "\n"

        # Try to fit facts
        if facts:
            facts_block = "### Facts & Config\n" + "\n".join(facts) + "\n\n"
            if len(facts_block) <= remaining_budget:
                protected += facts_block
                remaining_budget -= len(facts_block)
            else:
                # Fit as many fact lines as possible
                partial = "### Facts & Config\n"
                for line in facts:
                    candidate = partial + line + "\n"
                    if len(candidate) + 2 <= remaining_budget:
                        partial = candidate
                    else:
                        break
                if partial != "### Facts & Config\n":
                    protected += partial + "\n"
                    remaining_budget -= len(partial) + 1

        # Try to fit history
        if history and remaining_budget > 50:
            history_block = "### Recent Context\n" + "\n".join(history) + "\n"
            if len(history_block) <= remaining_budget:
                protected += history_block
            else:
                partial = "### Recent Context\n"
                for line in history:
                    candidate = partial + line + "\n"
                    if len(candidate) + 2 <= remaining_budget:
                        partial = candidate
                    else:
                        break
                if partial != "### Recent Context\n":
                    protected += partial

        return protected.rstrip() + "\n"

    # -- Storage filters (Phase 4) --

    # Minimum message length to store (skip greetings, "ok", "thanks")
    _MIN_STORE_LENGTH = 20

    # Rate limit: minimum seconds between stores
    _STORE_COOLDOWN = 10.0

    # Patterns indicating tool invocation wrapper noise
    _TOOL_NOISE_PATTERNS = [
        re.compile(r"^\[Replying to:", re.I),
        re.compile(r"^\[Tool call:", re.I),
        re.compile(r"^\[Function:", re.I),
    ]

    # Patterns indicating assistant filler (not worth storing)
    _ASST_FILLER_PATTERNS = [
        re.compile(r"^(?:let me |i(?:'ll| will) (?:check|look|search|find|see))", re.I),
        re.compile(r"^(?:sure|okay|alright|got it|understood),?\s", re.I),
        re.compile(r"^(?:here(?:'s| is) (?:the|what|a))", re.I),
        re.compile(r"^(?:I'm (?:looking|checking|searching|working))", re.I),
    ]

    # Patterns indicating assistant content worth storing (decisions, facts, procedures)
    _ASST_VALUABLE_PATTERNS = [
        re.compile(r"\b(?:decided|decision|chose|choosing|picked|selected)\b", re.I),
        re.compile(r"\b(?:created|deployed|configured|installed|set up|fixed|resolved)\b", re.I),
        re.compile(r"\b(?:the (?:issue|problem|bug|error) (?:is|was))\b", re.I),
        re.compile(r"\b(?:step \d|first,|then,|finally,|to do this)\b", re.I),
        re.compile(r"\b(?:note:|important:|remember:|fyi:)", re.I),
        re.compile(r"\b(?:commit|push|deploy|merge|release)\b.*\b(?:done|complete|success)\b", re.I),
    ]

    def _should_store_user(self, text: str) -> bool:
        """Decide if a user message is worth storing."""
        stripped = text.strip()
        # Always store preferences and facts regardless of length
        mtype = self._classify_turn(stripped)
        if mtype in ("preference", "fact"):
            return True
        if len(stripped) < self._MIN_STORE_LENGTH:
            return False
        if any(p.search(stripped) for p in self._TOOL_NOISE_PATTERNS):
            return False
        return True

    def _should_store_assistant(self, text: str) -> bool:
        """Decide if an assistant message is worth storing.

        Stores if it contains decisions, facts, or procedures.
        Skips filler like "Let me check..." or "Here's what I found:".
        """
        stripped = text.strip()
        if len(stripped) < self._MIN_STORE_LENGTH:
            return False
        # Check for valuable content first
        if any(p.search(stripped) for p in self._ASST_VALUABLE_PATTERNS):
            return True
        # Check for filler
        if any(p.search(stripped) for p in self._ASST_FILLER_PATTERNS):
            return False
        # Default: store if it's long enough to be substantive (>100 chars)
        return len(stripped) > 100

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """Store turn as memory. Fire-and-forget to REST, engine handles quality gating.

        The engine's SIU pipeline handles classification, quality filtering, and
        rejection of junk. The plugin just passes raw content and gets out of the way.

        Only client-side filtering: skip non-primary contexts, skip empty content,
        basic rate limiting to prevent flooding.
        """
        if self._agent_context != "primary":
            return
        if not self._client:
            return
        if not user_content or not user_content.strip():
            return

        self._turn_counter += 1

        # Rate limiting: skip if too soon after last store
        now = time.monotonic()
        if hasattr(self, "_last_store_time"):
            if now - self._last_store_time < self._STORE_COOLDOWN:
                logger.debug("Sulcus sync_turn: rate limited (%.1fs since last store)",
                             now - self._last_store_time)
                return

        def _do_sync():
            try:
                # Store user turn — let engine classify and quality-gate
                label = _truncate(user_content, 100)
                self._client.store(
                    label=label,
                    pointer_summary=user_content,
                    memory_type="episodic",  # Engine reclassifies via SIU
                    raw_content=user_content,
                    metadata={
                        "session_id": session_id or self._session_id,
                        "turn": self._turn_counter,
                        "source": "user",
                    },
                )

                # Store assistant turn if present
                if assistant_content and assistant_content.strip():
                    asst_label = f"[asst] {_truncate(assistant_content, 80)}"
                    self._client.store(
                        label=asst_label,
                        pointer_summary=f"[asst] {assistant_content}",
                        memory_type="episodic",  # Engine reclassifies via SIU
                        raw_content=f"[asst] {assistant_content}",
                        metadata={
                            "session_id": session_id or self._session_id,
                            "turn": self._turn_counter,
                            "source": "assistant",
                        },
                    )

                self._last_store_time = time.monotonic()

            except Exception as e:
                logger.debug("Sulcus sync_turn failed: %s", e)

        self._last_store_time = now  # Mark even before async to prevent double-fires
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
            # Refresh identity context for the new session
            self._refresh_identity_context()
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
