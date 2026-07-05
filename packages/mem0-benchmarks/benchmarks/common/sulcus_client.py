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

        Uses the batch endpoint (POST /api/v1/agent/nodes/batch) when available —
        sends up to 50 nodes per request instead of 1, cutting ingest time by ~50x.
        Falls back to per-node creation if batch endpoint returns 404.

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

        # Build node list — pair user+assistant turns into single nodes for
        # richer context.  A paired node gives semantic search a conversation
        # *exchange* rather than a single utterance, which dramatically
        # improves recall for questions about topics discussed in the chat.
        nodes = []
        # Pair consecutive user/assistant messages into one node when possible
        paired_messages = []
        i = 0
        while i < len(messages):
            msg = messages[i]
            role = msg.get("role", "user")
            content = msg.get("content", "").strip()
            if not content:
                i += 1
                continue
            # If this is a user message and next is assistant, pair them
            if role == "user" and i + 1 < len(messages):
                next_msg = messages[i + 1]
                next_role = next_msg.get("role", "")
                next_content = next_msg.get("content", "").strip()
                if next_role == "assistant" and next_content:
                    paired = (
                        f"{ts_label}User: {content}\n"
                        f"Assistant: {next_content}"
                    )
                    paired_messages.append(paired)
                    i += 2
                    continue
            # Single message (no pair available)
            enriched = f"{ts_label}{role.capitalize()}: {content}"
            paired_messages.append(enriched)
            i += 1

        for text in paired_messages:
            # Store full content (up to 4000 chars) — truncating to 120 chars
            # loses most of the conversation context and cripples FTS matching.
            label = text[:4000]
            nodes.append({"label": label, "memory_type": "episodic", "namespace": namespace})

        if not nodes:
            return {"results": []}

        # Try batch endpoint first (available in server v2.14.0+)
        batch_results = await self._create_nodes_batch(session, namespace, nodes)
        if batch_results is not None:
            return {"results": batch_results}

        # Fallback: per-node creation (server < v2.14.0)
        for node in nodes:
            node_id = await self._create_node(session, namespace, node)
            if node_id:
                results.append({"id": node_id, "event": "ADD", "memory": node["label"]})
        return {"results": results}

    async def _create_nodes_batch(
        self,
        session: aiohttp.ClientSession,
        namespace: str,
        nodes: list[dict[str, Any]],
        batch_size: int = 50,
    ) -> list[dict] | None:
        """POST /api/v1/agent/nodes/batch — create up to 50 nodes per request.

        Returns None if endpoint is unavailable (404), so caller can fall back.
        Returns list of {id, event, memory} dicts on success.
        """
        headers = self._request_headers(namespace)
        url = f"{self.base_url}/api/v1/agent/nodes/batch"
        results = []

        for chunk_start in range(0, len(nodes), batch_size):
            chunk = nodes[chunk_start : chunk_start + batch_size]
            payload = {"nodes": chunk}

            for attempt in range(self.max_retries):
                try:
                    async with self.limiter:
                        async with session.post(url, json=payload, headers=headers) as resp:
                            if resp.status == 404:
                                # Batch endpoint not available on this server version
                                return None
                            if resp.status == 429:
                                retry_after = float(
                                    resp.headers.get("Retry-After", self.retry_delay * (attempt + 1))
                                )
                                logger.warning("Batch rate limited — waiting %.1fs", retry_after)
                                await asyncio.sleep(retry_after)
                                continue
                            if resp.status >= 500:
                                raise aiohttp.ClientResponseError(
                                    resp.request_info, resp.history, status=resp.status
                                )
                            resp.raise_for_status()
                            data = await resp.json()
                            for item in data.get("results", []):
                                if item.get("status") == "created":
                                    results.append({
                                        "id": item.get("id", ""),
                                        "event": "ADD",
                                        "memory": item.get("label", ""),
                                    })
                            break
                except aiohttp.ClientResponseError as exc:
                    if exc.status == 404:
                        return None
                    logger.debug("Batch create attempt %d/%d failed: %s", attempt + 1, self.max_retries, str(exc)[:120])
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(self.retry_delay * (attempt + 1))
                    else:
                        logger.warning("Batch create failed after %d attempts", self.max_retries)
                except Exception as exc:
                    logger.debug("Batch create attempt %d/%d failed: %s", attempt + 1, self.max_retries, str(exc)[:120])
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(self.retry_delay * (attempt + 1))
                    else:
                        return None  # Fall back to per-node

        return results

    async def _create_node(
        self,
        session: aiohttp.ClientSession,
        namespace: str,
        payload: dict[str, Any],
    ) -> str | None:
        """POST /api/v1/agent/nodes — create one memory node."""
        headers = self._request_headers(namespace)
        url = f"{self.base_url}/api/v1/agent/nodes"
        # Ensure namespace is in the JSON body (server reads body, not header)
        payload = {**payload, "namespace": namespace}

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

    # ------------------------------------------------------------------
    # Keyword extraction for multi-query search
    # ------------------------------------------------------------------

    # Common stop words to filter out of search queries
    _STOP_WORDS = frozenset(
        "i me my myself we our ours ourselves you your yours yourself yourselves "
        "he him his himself she her hers herself it its itself they them their "
        "theirs themselves what which who whom this that these those am is are "
        "was were be been being have has had having do does did doing a an the "
        "and but if or because as until while of at by for with about against "
        "between through during before after above below to from up down in out "
        "on off over under again further then once here there when where why how "
        "all both each few more most other some such no nor not only own same so "
        "than too very s t can will just don should now d ll m o re ve y ain "
        "aren couldn didn doesn hadn hasn haven isn ma mightn mustn needn shan "
        "shouldn wasn weren won wouldn could would might must shall may "
        "also still already even much many quite really very just going got "
        "been think know want like would said get make go see come take find "
        "give tell well back look day way thing first last long great little "
        "right around any been did does ever since used able".split()
    )

    @staticmethod
    def _extract_keywords(query: str, max_keywords: int = 5) -> list[str]:
        """Extract content-bearing keywords from a natural-language question.

        Removes stop words, question words, short tokens, and returns the most
        likely content-bearing terms for FTS matching.
        """
        # Strip punctuation and lowercase
        cleaned = re.sub(r"[^\w\s]", " ", query.lower())
        tokens = cleaned.split()

        # Filter: remove stop words and very short tokens
        keywords = [
            t for t in tokens
            if t not in SulcusClient._STOP_WORDS and len(t) >= 3
        ]

        # Deduplicate while preserving order
        seen: set[str] = set()
        unique = []
        for k in keywords:
            if k not in seen:
                seen.add(k)
                unique.append(k)

        return unique[:max_keywords]

    # ------------------------------------------------------------------
    # Core search (single query)
    # ------------------------------------------------------------------

    async def _search_single(
        self,
        query: str,
        namespace: str,
        limit: int = 200,
    ) -> list[dict]:
        """Execute a single search against Sulcus. Returns raw normalised results."""
        session = await self._get_session()
        headers = self._request_headers(namespace)
        url = f"{self.base_url}/api/v1/agent/search"

        payload: dict[str, Any] = {
            "query": query,
            "limit": min(limit, 200),
            "namespace": namespace,
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

                raw_items = []
                if isinstance(data, dict):
                    raw_items = data.get("items") or data.get("results") or data.get("nodes") or []
                elif isinstance(data, list):
                    raw_items = data

                normalised = []
                for item in raw_items:
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
                    if item.get("updated_at"):
                        entry["updated_at"] = item.get("updated_at", "")
                    normalised.append(entry)

                return normalised

            except Exception as exc:
                logger.warning("SEARCH attempt %d/%d failed: %s", attempt + 1, self.max_retries, str(exc)[:200])
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                else:
                    return []
        return []

    # ------------------------------------------------------------------
    # Multi-query search with keyword fan-out
    # ------------------------------------------------------------------

    @staticmethod
    def _build_query_variants(query: str) -> list[str]:
        """Build multiple search query variants from a natural-language question.

        Returns a list of query strings to try, ordered from most specific to
        most general.  The first variant is the original question; subsequent
        variants strip noise progressively.
        """
        variants: list[str] = [query]

        # Variant 2: condensed keywords (strip stop words, keep as phrase)
        keywords = SulcusClient._extract_keywords(query, max_keywords=8)
        if keywords:
            condensed = " ".join(keywords)
            if condensed != query:
                variants.append(condensed)

        # Variant 3: bigrams from keywords (captures multi-word concepts)
        if len(keywords) >= 2:
            bigrams = [f"{keywords[i]} {keywords[i+1]}" for i in range(len(keywords) - 1)]
            # Take the first 3 most promising bigrams
            for bg in bigrams[:3]:
                if bg not in variants:
                    variants.append(bg)

        return variants

    # ------------------------------------------------------------------
    # Client-side keyword re-ranking
    # ------------------------------------------------------------------

    @staticmethod
    def _keyword_rerank(
        results: list[dict],
        query: str,
        keywords: list[str],
        boost_weight: float = 0.5,
    ) -> list[dict]:
        """Re-rank search results using client-side keyword overlap scoring.

        The engine's hybrid score fusion produces a flat ~0.55-0.60 for
        keyword-matched results — it doesn't distinguish between a result
        that matches 1/8 query keywords and one that matches 7/8.  This
        re-ranker adds a keyword overlap boost that rewards results
        containing more of the question's content-bearing terms.

        The boosted score = engine_score + (keyword_overlap * boost_weight)
        where keyword_overlap = matched_keywords / total_keywords.

        This is purely client-side — no extra API calls.
        """
        if not keywords or not results:
            return results

        query_lower = query.lower()
        reranked = []
        for r in results:
            mem_lower = r.get("memory", "").lower()
            matches = sum(1 for kw in keywords if kw in mem_lower)
            kw_overlap = matches / len(keywords)
            engine_score = r.get("score", 0)
            boosted = engine_score + kw_overlap * boost_weight
            reranked.append({**r, "score": boosted, "_engine_score": engine_score, "_kw_overlap": kw_overlap})

        reranked.sort(key=lambda x: x.get("score", 0), reverse=True)
        return reranked

    async def search(
        self,
        query: str,
        user_id: str,
        top_k: int = 200,
        rerank: bool = False,
        score_debug: bool = False,
    ) -> list[dict]:
        """Search Sulcus memories with parallel multi-strategy retrieval + keyword re-ranking.

        Pipeline:
        1. Build query variants (original, condensed keywords, bigrams)
        2. Run ALL search strategies in parallel against the engine
        3. Merge & deduplicate by node ID (keeping highest score)
        4. Re-rank using client-side keyword overlap boost

        Step 4 compensates for the engine's flat ~0.55-0.60 score floor
        on keyword-matched results.  It rewards results that match more
        of the question's content-bearing terms, significantly improving
        ranking for topical queries.

        Why parallel-everything instead of cascading:
        The engine's hybrid search can return many low-quality results for
        generic queries while missing specific topic-relevant nodes. Running
        keyword searches in parallel ensures topic-specific terms (e.g.
        "photography") surface relevant nodes even when the full question
        returns only generic matches.
        """
        namespace = self._ns(user_id)
        merged: dict[str, dict] = {}

        # Build all query variants
        variants = self._build_query_variants(query)
        keywords = self._extract_keywords(query, max_keywords=8)

        # Build all search tasks
        all_tasks: list[asyncio.Task] = []

        # Variant queries (original + condensed + bigrams)
        for v in variants:
            all_tasks.append(
                self._search_single(v, namespace, limit=min(top_k, 50))
            )

        # Individual keyword fan-out
        for kw in keywords:
            if kw not in [v.lower() for v in variants]:  # avoid duplicate searches
                all_tasks.append(
                    self._search_single(kw, namespace, limit=min(top_k, 50))
                )

        # Run all in parallel
        all_results = await asyncio.gather(*all_tasks, return_exceptions=True)

        for result_set in all_results:
            if isinstance(result_set, Exception):
                continue
            for item in result_set:
                node_id = item.get("id", "")
                if not node_id:
                    continue
                existing = merged.get(node_id)
                if existing is None or item.get("score", 0) > existing.get("score", 0):
                    merged[node_id] = item

        sorted_results = sorted(merged.values(), key=lambda x: x.get("score", 0), reverse=True)

        # Client-side re-ranking: boost results that match more query keywords
        reranked = self._keyword_rerank(sorted_results[:top_k], query, keywords, boost_weight=0.5)
        return reranked[:top_k]

    # =========================================================================
    # Delete
    # =========================================================================

    async def delete_user(self, user_id: str) -> bool:
        """Delete all memories for a benchmark user (purge namespace)."""
        namespace = self._ns(user_id)
        session = await self._get_session()
        headers = self._request_headers(namespace)

        # Fetch all nodes in the namespace, then delete each.
        # Pass namespace as query param so the server scopes to bench namespace,
        # not the API key's default namespace.
        try:
            page_size = 200
            url = f"{self.base_url}/api/v1/agent/nodes"
            params = {"page_size": page_size, "namespace": namespace}

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


# Backward compatibility alias — existing run.py files import this name
format_sulcus_search_results = format_search_results
