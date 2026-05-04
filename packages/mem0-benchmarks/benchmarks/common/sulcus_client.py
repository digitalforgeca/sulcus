"""
Sulcus Client — Drop-in replacement for Mem0Client in the memory-benchmarks harness.
======================================================================================

Implements the same async interface as Mem0Client:
    client.add(messages, user_id, ...)
    client.search(query, user_id, top_k=200, ...)
    client.delete_user(user_id)
    client.get_user_profile(user_id)   # stub — not used in scoring

How it maps Sulcus to the Mem0 benchmark protocol:

  - add(messages, user_id): Each message batch → POST /api/v1/agent/nodes
    One node per non-empty message, labelled with speaker role and temporal context.
    Sulcus handles thermodynamic heat + entity extraction automatically.

  - search(query, user_id): POST /api/v1/agent/search
    Returns normalised list of {memory, score, id} dicts sorted by score desc.

  - delete_user(user_id): Purge all nodes in namespace derived from user_id.
    Namespace = "bench-{safe_user_id}" (scoped per-user for isolation).

Namespace strategy: each benchmark user_id gets its own Sulcus namespace
  "bench-{user_id[:48]}" — keeps users isolated across parallel runs.

Usage:
    from benchmarks.common.sulcus_client import SulcusClient, format_search_results
    client = SulcusClient(api_key="sk-...", base_url="https://api.sulcus.ca")
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
import uuid
from typing import Any

import aiohttp
from aiolimiter import AsyncLimiter

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.sulcus.ca"


def _safe_namespace(user_id: str) -> str:
    """Convert benchmark user_id to a valid Sulcus namespace.

    Rules: lowercase, alphanumeric + hyphens, 3–64 chars.
    Prefix "bench-" to avoid collisions with production namespaces.
    """
    safe = re.sub(r"[^a-z0-9-]", "-", user_id.lower())
    safe = re.sub(r"-+", "-", safe).strip("-")
    safe = f"bench-{safe}"[:64]
    if len(safe) < 3:
        safe = f"bench-{uuid.uuid4().hex[:8]}"
    return safe


class SulcusClient:
    """Async Sulcus client that mirrors the Mem0Client interface.

    Args:
        api_key: Sulcus API key. Falls back to SULCUS_API_KEY env var.
        base_url: Sulcus server URL. Falls back to SULCUS_BASE_URL or api.sulcus.ca.
        max_retries: Maximum retry attempts per API call.
        retry_delay: Base delay (seconds) between retries — doubles each attempt.
        rpm: Requests per minute rate limit.
        timeout: HTTP request timeout in seconds.
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        max_retries: int = 5,
        retry_delay: float = 3.0,
        rpm: int = 120,
        timeout: float = 120.0,
        **kwargs: Any,
    ):
        self.api_key = api_key or os.getenv("SULCUS_API_KEY", "")
        if not self.api_key:
            raise ValueError(
                "SulcusClient requires --sulcus-api-key or SULCUS_API_KEY env var"
            )
        self.base_url = (
            base_url or os.getenv("SULCUS_BASE_URL", DEFAULT_BASE_URL)
        ).rstrip("/")
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.limiter = AsyncLimiter(rpm, 60)
        self._session: aiohttp.ClientSession | None = None

        # Namespace registry: user_id → sulcus namespace
        self._namespaces: dict[str, str] = {}

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "X-Namespace": "",  # overridden per-request
        }

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            connector = aiohttp.TCPConnector(limit=50)
            self._session = aiohttp.ClientSession(
                timeout=self.timeout,
                connector=connector,
            )
        return self._session

    def _ns(self, user_id: str) -> str:
        """Get or create the Sulcus namespace for a benchmark user."""
        if user_id not in self._namespaces:
            self._namespaces[user_id] = _safe_namespace(user_id)
        return self._namespaces[user_id]

    def _request_headers(self, namespace: str) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "X-Namespace": namespace,
        }

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def __aenter__(self) -> "SulcusClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    # =========================================================================
    # Add
    # =========================================================================

    async def add(
        self,
        messages: list[dict[str, str]],
        user_id: str,
        observation_date: str | None = None,
        timestamp: int | None = None,
        custom_instructions: str | None = None,
        metadata: dict | None = None,
    ) -> dict | None:
        """Ingest a batch of conversation messages into Sulcus.

        Each message becomes one memory node. Returns a dict with "results" key
        listing created node IDs (Mem0-compatible format).
        """
        namespace = self._ns(user_id)
        session = await self._get_session()
        results = []

        # Temporal context string for ordering
        ts_label = ""
        if timestamp:
            from datetime import datetime, timezone
            dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
            ts_label = f"[{dt.strftime('%Y-%m-%d')}] "

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "").strip()
            if not content:
                continue

            # Prefix with role and date for temporal context
            enriched = f"{ts_label}{role.capitalize()}: {content}"
            label = enriched[:120]
            memory_type = "episodic"  # conversations are episodic

            payload: dict[str, Any] = {
                "label": label,
                "pointer_summary": enriched,
                "memory_type": memory_type,
            }

            node_id = await self._create_node(session, namespace, payload)
            if node_id:
                results.append({"id": node_id, "event": "ADD", "memory": label})

        return {"results": results}

    async def _create_node(
        self,
        session: aiohttp.ClientSession,
        namespace: str,
        payload: dict[str, Any],
    ) -> str | None:
        """POST /api/v1/agent/nodes — create one memory node."""
        headers = self._request_headers(namespace)
        url = f"{self.base_url}/api/v1/agent/nodes"

        for attempt in range(self.max_retries):
            try:
                async with self.limiter:
                    async with session.post(url, json=payload, headers=headers) as resp:
                        if resp.status == 429:
                            retry_after = float(resp.headers.get("Retry-After", self.retry_delay * (attempt + 1)))
                            logger.warning("Rate limited — waiting %.1fs", retry_after)
                            await asyncio.sleep(retry_after)
                            continue
                        if resp.status >= 500:
                            raise aiohttp.ClientResponseError(
                                resp.request_info, resp.history, status=resp.status
                            )
                        resp.raise_for_status()
                        data = await resp.json()
                        return data.get("id") or data.get("node_id", "")
            except Exception as exc:
                logger.debug("Node create attempt %d/%d failed: %s", attempt + 1, self.max_retries, str(exc)[:120])
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                else:
                    logger.warning("Node create failed after %d attempts: %s", self.max_retries, str(exc)[:120])
                    return None
        return None

    # =========================================================================
    # Search
    # =========================================================================

    async def search(
        self,
        query: str,
        user_id: str,
        top_k: int = 200,
        rerank: bool = False,
        score_debug: bool = False,
    ) -> list[dict]:
        """Search Sulcus memories. Returns Mem0-compatible result list."""
        namespace = self._ns(user_id)
        session = await self._get_session()
        headers = self._request_headers(namespace)
        url = f"{self.base_url}/api/v1/agent/search"

        # Sulcus search payload
        payload: dict[str, Any] = {
            "query": query,
            "limit": min(top_k, 200),  # Sulcus max 200
        }

        for attempt in range(self.max_retries):
            try:
                async with self.limiter:
                    async with session.post(url, json=payload, headers=headers) as resp:
                        if resp.status == 429:
                            retry_after = float(resp.headers.get("Retry-After", self.retry_delay * (attempt + 1)))
                            await asyncio.sleep(retry_after)
                            continue
                        if resp.status >= 500:
                            raise aiohttp.ClientResponseError(
                                resp.request_info, resp.history, status=resp.status
                            )
                        resp.raise_for_status()
                        data = await resp.json()

                # Normalise Sulcus results to Mem0 format
                raw_items = []
                if isinstance(data, dict):
                    raw_items = data.get("items") or data.get("results") or data.get("nodes") or []
                elif isinstance(data, list):
                    raw_items = data

                normalised = []
                for item in raw_items:
                    # Sulcus returns: label, pointer_summary, current_heat, score/fused_score
                    content = (
                        item.get("pointer_summary")
                        or item.get("label")
                        or item.get("memory")
                        or item.get("content")
                        or ""
                    )
                    score = (
                        item.get("score")
                        or item.get("fused_score")
                        or item.get("current_heat")
                        or 0.0
                    )
                    entry: dict[str, Any] = {
                        "memory": content,
                        "score": float(score),
                        "id": item.get("id", ""),
                    }
                    if item.get("created_at"):
                        entry["created_at"] = item["created_at"]
                    if item.get("updated_at") or item.get("updated_at"):
                        entry["updated_at"] = item.get("updated_at", "")
                    normalised.append(entry)

                # Sort by score descending
                normalised.sort(key=lambda x: x.get("score", 0), reverse=True)
                return normalised[:top_k]

            except Exception as exc:
                logger.warning("SEARCH attempt %d/%d failed (user=%s): %s", attempt + 1, self.max_retries, user_id, str(exc)[:200])
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                else:
                    logger.error("SEARCH failed after %d attempts for user=%s", self.max_retries, user_id)
                    return []

        return []

    # =========================================================================
    # Delete
    # =========================================================================

    async def delete_user(self, user_id: str) -> bool:
        """Delete all memories for a benchmark user (purge namespace)."""
        namespace = self._ns(user_id)
        session = await self._get_session()
        headers = self._request_headers(namespace)

        # Fetch all nodes in the namespace, then delete each
        try:
            page_size = 200
            url = f"{self.base_url}/api/v1/agent/nodes"
            params = {"page_size": page_size}

            async with self.limiter:
                async with session.get(url, params=params, headers=headers) as resp:
                    if resp.status >= 400:
                        return True  # namespace may not exist yet — OK
                    data = await resp.json()

            items = []
            if isinstance(data, dict):
                items = data.get("items") or data.get("nodes") or []
            elif isinstance(data, list):
                items = data

            delete_tasks = []
            for item in items:
                node_id = item.get("id", "")
                if node_id:
                    delete_tasks.append(self._delete_node(session, namespace, node_id))

            if delete_tasks:
                await asyncio.gather(*delete_tasks, return_exceptions=True)

            logger.info("Deleted %d nodes for user=%s (ns=%s)", len(delete_tasks), user_id, namespace)
            return True

        except Exception as exc:
            logger.warning("delete_user failed for %s: %s", user_id, exc)
            return False

    async def _delete_node(
        self, session: aiohttp.ClientSession, namespace: str, node_id: str
    ) -> None:
        """DELETE /api/v1/agent/nodes/:id"""
        headers = self._request_headers(namespace)
        url = f"{self.base_url}/api/v1/agent/nodes/{node_id}"
        try:
            async with self.limiter:
                async with session.delete(url, headers=headers) as resp:
                    if resp.status not in (200, 204, 404):
                        logger.debug("Delete node %s returned %d", node_id, resp.status)
        except Exception as exc:
            logger.debug("Delete node %s failed: %s", node_id, exc)

    # =========================================================================
    # User profile (stub — Sulcus has no user profile API)
    # =========================================================================

    async def get_user_profile(self, user_id: str) -> dict | None:
        """Stub — returns None. Sulcus doesn't have a user profile endpoint."""
        return None


# ---------------------------------------------------------------------------
# Compatibility: same format_search_results as mem0_client
# ---------------------------------------------------------------------------


def format_search_results(search_results: list[dict]) -> tuple[list[dict], dict | None]:
    """Normalize Sulcus search results to Mem0-compatible format.

    Returns:
        Tuple of (formatted results list, query_debug dict or None).
    """
    if not search_results:
        return [], None

    query_debug = None
    if isinstance(search_results, dict):
        query_debug = search_results.get("query_debug")
        search_results = search_results.get("results", [])

    sorted_results = sorted(search_results, key=lambda x: x.get("score", 0), reverse=True)
    formatted = []
    for r in sorted_results:
        entry: dict[str, Any] = {
            "memory": r.get("memory", ""),
            "score": r.get("score", 0),
            "id": r.get("id", ""),
        }
        if r.get("created_at"):
            entry["created_at"] = r["created_at"]
        if r.get("updated_at"):
            entry["updated_at"] = r["updated_at"]
        if r.get("score_debug"):
            entry["score_debug"] = r["score_debug"]
        formatted.append(entry)
    return formatted, query_debug
