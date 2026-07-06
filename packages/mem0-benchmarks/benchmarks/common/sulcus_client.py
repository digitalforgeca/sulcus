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

    # Common stop words to filter out of search queries — expanded with
    # conversational filler words that appear in LongMemEval questions
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
        "right around any been did does ever since used able "
        # Conversational fillers common in LongMemEval questions
        "looking wanted follow previous conversation wondering mentioned "
        "remember recall remind told talked discussed suggest suggestions "
        "provide information please help could would".split()
    )

    @staticmethod
    def _extract_quoted_phrases(query: str) -> list[str]:
        """Extract quoted phrases and capitalized entity names from a query.

        These are treated as exact-match terms for boosting.
        """
        phrases = []
        # Extract single-quoted and double-quoted phrases
        for match in re.finditer(r"""['"]([^'"]{3,})['"]""", query):
            phrases.append(match.group(1).strip().lower())
        # Extract capitalized multi-word names (e.g., "Body Scan Meditation")
        for match in re.finditer(r"(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)", query):
            phrases.append(match.group(0).strip().lower())
        return phrases

    @staticmethod
    def _extract_keywords(query: str, max_keywords: int = 8) -> list[str]:
        """Extract content-bearing keywords from a natural-language question.

        Removes stop words, question words, short tokens, and returns the most
        likely content-bearing terms for FTS matching.  Preserves alphanumeric
        tokens (e.g. chess notation "Kg2", "Bd5") and domain-specific terms.
        """
        # First, extract quoted phrases for separate handling
        quoted = SulcusClient._extract_quoted_phrases(query)

        # Preserve alphanumeric tokens (chess notation, model numbers, etc.)
        # before stripping punctuation
        alphanum_tokens = re.findall(r'\b[A-Za-z][a-z0-9]+[A-Z0-9][a-z0-9]*\b', query)
        alphanum_lower = [t.lower() for t in alphanum_tokens]

        # Strip punctuation and lowercase
        cleaned = re.sub(r"[^\w\s]", " ", query.lower())
        tokens = cleaned.split()

        # Filter: remove stop words and very short tokens
        keywords = [
            t for t in tokens
            if t not in SulcusClient._STOP_WORDS and len(t) >= 3
        ]

        # Add alphanumeric tokens that may have been split
        for t in alphanum_lower:
            if t not in keywords:
                keywords.append(t)

        # Add individual words from quoted phrases
        for phrase in quoted:
            for word in phrase.split():
                if len(word) >= 3 and word not in SulcusClient._STOP_WORDS:
                    keywords.append(word)

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
    def _extract_enumerated_entities(query: str) -> list[str]:
        """Extract individual entities from enumeration patterns in a query.

        Recognises patterns like:
        - "workshops, lectures, and conferences"
        - "books and novels"
        - "cats, dogs or birds"
        - "January and March"

        Returns a list of individual entity terms (1-2 words each),
        or empty list if no enumeration is detected.
        """
        structural = {
            'total', 'amount', 'many', 'much', 'count', 'number',
            'days', 'spend', 'spent', 'earned', 'selling', 'attending',
            'both', 'two', 'three', 'all', 'each', 'every',
        }

        def _clean_entity(text: str) -> str:
            """Strip leading stop words, structural words, and prepositions."""
            words = text.strip().lower().split()
            # Strip leading stop words and structural terms
            while words and (words[0] in SulcusClient._STOP_WORDS or words[0] in structural):
                words = words[1:]
            # Strip trailing prepositions/stop words
            while words and words[-1] in SulcusClient._STOP_WORDS:
                words = words[:-1]
            return " ".join(words)

        # Try three-item pattern first: "A, B, and/or C"
        m3 = re.search(
            r'(\b\w+(?:\s+\w+){0,1})\s*,\s*(\b\w+(?:\s+\w+){0,1})\s*,?\s*(?:and|or)\s+(\b\w+(?:\s+\w+){0,1})\b',
            query, re.IGNORECASE
        )
        if m3:
            cleaned = [_clean_entity(g) for g in m3.groups()]
            cleaned = [e for e in cleaned if len(e) >= 3 and e not in structural]
            if len(cleaned) >= 2:
                return cleaned

        # Two-item pattern: "A and/or B" (3+ char words)
        m2 = re.search(
            r'(\b\w{3,}(?:\s+\w+){0,1})\s+(?:and|or)\s+(\b\w{3,}(?:\s+\w+){0,1})\b',
            query, re.IGNORECASE
        )
        if m2:
            cleaned = [_clean_entity(g) for g in m2.groups()]
            cleaned = [e for e in cleaned if len(e) >= 3 and e not in structural]
            if len(cleaned) >= 2:
                return cleaned

        return []

    @staticmethod
    def _is_aggregation_query(query: str) -> bool:
        """Detect queries that require aggregating information across multiple memories.

        These include "how many", "total", "all the", "in total", counting patterns.
        """
        aggregation_patterns = [
            r'\bhow\s+many\b',
            r'\btotal\b',
            r'\bin\s+total\b',
            r'\ball\s+the\b',
            r'\ball\s+of\b',
            r'\beach\s+of\b',
            r'\bevery\b',
            r'\bsum\b',
            r'\bcombined\b',
            r'\boverall\b',
        ]
        q_lower = query.lower()
        return any(re.search(p, q_lower) for p in aggregation_patterns)

    @staticmethod
    def _build_query_variants(query: str) -> list[str]:
        """Build multiple search query variants from a natural-language question.

        Returns a list of query strings to try, ordered from most specific to
        most general.  The first variant is the original question; subsequent
        variants strip noise progressively.

        For enumeration queries ("workshops, lectures, and conferences"),
        generates entity-specific variants to ensure each topic area is searched
        independently — critical for multi-session aggregation questions.
        """
        variants: list[str] = [query]

        # Variant 2: condensed keywords (strip stop words, keep as phrase)
        keywords = SulcusClient._extract_keywords(query, max_keywords=12)
        if keywords:
            condensed = " ".join(keywords)
            if condensed != query:
                variants.append(condensed)

        # Variant 3: quoted phrases as exact search terms
        quoted = SulcusClient._extract_quoted_phrases(query)
        for phrase in quoted[:3]:
            if phrase not in variants and len(phrase) >= 5:
                variants.append(phrase)

        # Variant 4: bigrams from keywords (captures multi-word concepts)
        if len(keywords) >= 2:
            bigrams = [f"{keywords[i]} {keywords[i+1]}" for i in range(len(keywords) - 1)]
            # Take the first 3 most promising bigrams
            for bg in bigrams[:3]:
                if bg not in variants:
                    variants.append(bg)

        # Variant 5: entity-specific searches for enumeration queries
        # "workshops, lectures, and conferences in April" →
        #   "workshops April", "lectures April", "conferences April"
        entities = SulcusClient._extract_enumerated_entities(query)
        if entities:
            # Extract temporal/contextual modifiers from the query
            context_words = []
            for kw in keywords:
                # Keep temporal terms and other context not in the entity list
                if kw not in SulcusClient._STOP_WORDS and kw not in entities:
                    # Skip generic aggregation words
                    if kw not in {'total', 'amount', 'many', 'count', 'number', 'days',
                                  'spend', 'spent', 'attending', 'earned', 'selling'}:
                        context_words.append(kw)
            for entity in entities:
                entity_query = entity
                if context_words:
                    entity_query = f"{entity} {' '.join(context_words[:3])}"
                if entity_query not in variants:
                    variants.append(entity_query)

        return variants

    # ------------------------------------------------------------------
    # Client-side keyword re-ranking
    # ------------------------------------------------------------------

    @staticmethod
    def _stem_simple(word: str) -> str:
        """Ultra-simple suffix-stripping stemmer for keyword matching.

        Not a real stemmer — just strips common English plural/verb suffixes
        so that "workshops" matches "workshop", "conferences" matches
        "conference", "earned" matches "earn", etc.

        Deliberately conservative to avoid over-stemming (e.g., "class" from
        "classes" is fine, but we don't want "lov" from "loving").
        """
        w = word.lower()
        if len(w) <= 4:
            return w
        # Ordered by specificity (most specific first)
        if w.endswith("ies") and len(w) > 5:
            return w[:-3] + "y"  # "cities" → "city"
        if w.endswith("ches") or w.endswith("shes") or w.endswith("sses"):
            return w[:-2]  # "watches" → "watch", "dishes" → "dish"
        if w.endswith("ces") and len(w) > 5:
            return w[:-1]  # "conferences" → "conference"
        if w.endswith("es") and len(w) > 4 and w[-3] not in "aeiou":
            return w[:-2]  # "lectures" → "lectur" (close enough)
        if w.endswith("s") and w[-2] not in "su":
            return w[:-1]  # "workshops" → "workshop"
        if w.endswith("ed") and len(w) > 4:
            return w[:-2]  # "earned" → "earn"
        if w.endswith("ing") and len(w) > 5:
            return w[:-3]  # "selling" → "sell"
        return w

    @staticmethod
    def _stem_match(keyword: str, text: str) -> bool:
        """Check if a keyword (or its stem) appears in text.

        Tries exact match first, then stemmed match.  Both keyword and text
        should already be lowercased.
        """
        if keyword in text:
            return True
        stem = SulcusClient._stem_simple(keyword)
        if stem != keyword and stem in text:
            return True
        return False

    @staticmethod
    def _classify_keywords(
        keywords: list[str], query: str
    ) -> tuple[list[str], list[str]]:
        """Split keywords into topic-bearing and structural/aggregation words.

        Topic keywords describe WHAT the question is about (e.g., "fish",
        "aquariums", "workshops", "chess").  Structural keywords describe HOW
        the answer should be computed ("total", "many", "earned", "days") —
        these should NOT boost search ranking because they match unrelated
        memories that happen to contain those common words.
        """
        structural = {
            'total', 'amount', 'many', 'much', 'count', 'number', 'sum',
            'combined', 'overall', 'average', 'page', 'days', 'hours',
            'spend', 'spent', 'earn', 'earned', 'earning', 'selling',
            'sell', 'sold', 'buying', 'bought', 'attending', 'attended',
            'cost', 'price', 'money', 'paying', 'paid',
            'two', 'three', 'four', 'five', 'both',
            'finished', 'completed', 'started',
        }
        topic_kws = []
        struct_kws = []
        for kw in keywords:
            if kw in structural:
                struct_kws.append(kw)
            else:
                topic_kws.append(kw)
        return topic_kws, struct_kws

    @staticmethod
    def _keyword_rerank(
        results: list[dict],
        query: str,
        keywords: list[str],
        boost_weight: float = 0.5,
    ) -> list[dict]:
        """Re-rank search results using position-aware, co-occurrence-boosted keyword scoring.

        Scoring layers:
        1. Position-aware topic keyword matching: matches in the user's message
           (first ~200 chars before "Assistant:") score 2x vs matches in the
           assistant response.  This filters false positives where an assistant
           mentions a keyword incidentally in a long response.
        2. Multi-keyword co-occurrence bonus: results matching 2+ topic keywords
           get a super-linear bonus (n*(n-1)*0.05) because co-occurrence is a
           much stronger relevance signal than any single keyword.
        3. Exact phrase and entity boost.
        4. Topic coherence penalty for results matching only structural keywords.

        This is purely client-side — no extra API calls.
        """
        if not keywords or not results:
            return results

        import math

        # Split keywords into topic vs structural
        topic_kws, struct_kws = SulcusClient._classify_keywords(keywords, query)

        # If no topic keywords identified, fall back to using all keywords
        if not topic_kws:
            topic_kws = keywords

        # Extract exact phrases for bonus scoring
        quoted_phrases = SulcusClient._extract_quoted_phrases(query)

        # Also extract enumerated entities as topic phrases
        entities = SulcusClient._extract_enumerated_entities(query)

        is_aggregation = SulcusClient._is_aggregation_query(query)

        # Compute document frequency for topic keywords
        n_docs = max(len(results), 1)
        doc_freq: dict[str, int] = {}
        for kw in topic_kws:
            count = sum(1 for r in results if SulcusClient._stem_match(kw, r.get("memory", "").lower()))
            doc_freq[kw] = max(count, 1)

        idf_weights = {kw: math.log(n_docs / doc_freq[kw]) + 1 for kw in topic_kws}
        total_idf = sum(idf_weights.values()) or 1.0

        reranked = []
        for r in results:
            mem = r.get("memory", "")
            mem_lower = mem.lower()

            # --- Position-aware keyword matching ---
            # Split memory into user portion and assistant portion
            # User portion is the primary content; assistant is context
            asst_split = mem_lower.find("\nassistant:")
            if asst_split == -1:
                asst_split = mem_lower.find("assistant:")
            if asst_split > 0:
                user_portion = mem_lower[:asst_split]
                asst_portion = mem_lower[asst_split:]
            else:
                user_portion = mem_lower
                asst_portion = ""

            # Topic keyword overlap (IDF-weighted, position-aware)
            topic_overlap = 0.0
            topic_hits = 0
            topic_hits_in_user = 0
            for kw in topic_kws:
                in_user = SulcusClient._stem_match(kw, user_portion)
                in_asst = SulcusClient._stem_match(kw, asst_portion)
                if in_user:
                    # Full weight for user-portion matches
                    topic_overlap += idf_weights[kw] / total_idf
                    topic_hits += 1
                    topic_hits_in_user += 1
                elif in_asst:
                    # Half weight for assistant-portion matches (often incidental)
                    topic_overlap += (idf_weights[kw] / total_idf) * 0.4
                    topic_hits += 1

            # --- Multi-keyword co-occurrence bonus ---
            # Results matching 2+ topic keywords in the user portion are much more
            # likely to be relevant than single-keyword matches
            cooccurrence_bonus = 0.0
            if topic_hits_in_user >= 2:
                cooccurrence_bonus = topic_hits_in_user * (topic_hits_in_user - 1) * 0.06
            elif topic_hits >= 2:
                cooccurrence_bonus = topic_hits * (topic_hits - 1) * 0.03

            # Exact phrase bonus
            phrase_hits = sum(1 for phrase in quoted_phrases if SulcusClient._stem_match(phrase, mem_lower))
            phrase_boost = min(phrase_hits * 0.3, 0.6)

            # Entity coverage bonus: for enumeration queries, reward memories
            # that contain specific entities from the list
            entity_boost = 0.0
            if entities:
                # Weight entity matches in user portion more
                user_entity_hits = sum(1 for e in entities if SulcusClient._stem_match(e, user_portion))
                asst_entity_hits = sum(1 for e in entities if SulcusClient._stem_match(e, asst_portion) and not SulcusClient._stem_match(e, user_portion))
                entity_boost = min(user_entity_hits * 0.20 + asst_entity_hits * 0.08, 0.5)

            # Topic coherence: penalize results matching only structural keywords
            coherence_penalty = 0.0
            if topic_kws and topic_hits == 0:
                struct_hits = sum(1 for kw in struct_kws if SulcusClient._stem_match(kw, mem_lower))
                if struct_hits > 0:
                    coherence_penalty = -0.12 * struct_hits

            engine_score = r.get("score", 0)
            boosted = (
                engine_score
                + topic_overlap * boost_weight
                + cooccurrence_bonus
                + phrase_boost
                + entity_boost
                + coherence_penalty
            )
            reranked.append({
                **r,
                "score": boosted,
                "_engine_score": engine_score,
                "_topic_overlap": topic_overlap,
                "_phrase_boost": phrase_boost,
                "_entity_boost": entity_boost,
                "_cooccurrence_bonus": cooccurrence_bonus,
                "_coherence_penalty": coherence_penalty,
                "_topic_hits": topic_hits,
                "_topic_hits_in_user": topic_hits_in_user,
            })

        reranked.sort(key=lambda x: x.get("score", 0), reverse=True)

        # --- Aggregation diversity pass ---
        # For aggregation queries with entities, ensure the top results cover
        # different entity subtopics.  Without this, the top-10 might cluster
        # around one entity (e.g., "workshops" dominating "lectures").
        if is_aggregation and entities and len(entities) >= 2:
            reranked = SulcusClient._diversify_for_entities(reranked, entities, top_k=10)

        return reranked

    @staticmethod
    def _diversify_for_entities(
        results: list[dict],
        entities: list[str],
        top_k: int = 10,
    ) -> list[dict]:
        """Ensure top-K results cover different entity subtopics for aggregation queries.

        Uses a round-robin-like approach: for each entity that isn't represented
        in the current top-K, promote the highest-scored result containing that
        entity into the top-K (displacing the lowest-scored non-entity result).
        """
        if len(results) <= top_k:
            return results

        top = results[:top_k]
        rest = results[top_k:]

        # Check which entities are covered in top-K
        for entity in entities:
            covered = any(SulcusClient._stem_match(entity, r.get("memory", "").lower()) for r in top)
            if covered:
                continue

            # Find the best result in 'rest' that contains this entity
            best_idx = None
            best_score = -1
            for i, r in enumerate(rest):
                if SulcusClient._stem_match(entity, r.get("memory", "").lower()) and r.get("score", 0) > best_score:
                    best_idx = i
                    best_score = r.get("score", 0)

            if best_idx is not None:
                # Promote it into the top-K, displacing the lowest-scored result
                # that doesn't match ANY entity (to preserve existing coverage)
                worst_idx = None
                worst_score = float("inf")
                for i, r in enumerate(top):
                    r_mem = r.get("memory", "").lower()
                    matches_any_entity = any(SulcusClient._stem_match(e, r_mem) for e in entities)
                    if not matches_any_entity and r.get("score", 0) < worst_score:
                        worst_idx = i
                        worst_score = r.get("score", 0)

                if worst_idx is not None:
                    # Swap
                    promoted = rest.pop(best_idx)
                    demoted = top[worst_idx]
                    top[worst_idx] = promoted
                    rest.append(demoted)

        # Re-sort top-K by score
        top.sort(key=lambda x: x.get("score", 0), reverse=True)
        return top + rest

    async def search(
        self,
        query: str,
        user_id: str,
        top_k: int = 200,
        rerank: bool = False,
        score_debug: bool = False,
        timeout_s: float = 45.0,
    ) -> list[dict]:
        """Search Sulcus memories with parallel multi-strategy retrieval + keyword re-ranking.

        Pipeline:
        1. Build query variants (original, condensed keywords, bigrams, entity-specific)
        2. Run ALL search strategies in parallel against the engine
        3. Merge & deduplicate by node ID (keeping highest score)
        4. Re-rank using topic-aware keyword overlap boost
        5. (Aggregation queries) Ensure diversity in top results

        Steps 4-5 compensate for the engine's flat ~0.55-0.60 score floor
        on keyword-matched results.  Step 4 rewards results that match topic
        keywords while penalizing false positives from structural word overlap.
        Step 5 ensures that aggregation queries ("how many X", "total Y")
        get diverse results covering all relevant items, not just the top-
        scored cluster.

        Why parallel-everything instead of cascading:
        The engine's hybrid search can return many low-quality results for
        generic queries while missing specific topic-relevant nodes. Running
        keyword searches in parallel ensures topic-specific terms (e.g.
        "photography") surface relevant nodes even when the full question
        returns only generic matches.

        Timeout & progressive degradation:
        If the full parallel fan-out exceeds ``timeout_s`` seconds (default 45s),
        we collect whatever results completed so far.  If zero results came
        back, we fall back to a single search with just the original query.
        This prevents rate-limit cascading from producing 0-result timeouts.
        """
        namespace = self._ns(user_id)
        merged: dict[str, dict] = {}

        # Build all query variants
        variants = self._build_query_variants(query)
        keywords = self._extract_keywords(query, max_keywords=12)
        is_aggregation = self._is_aggregation_query(query)

        # Build all search tasks
        all_tasks: list[asyncio.Task] = []

        # Variant queries (original + condensed + bigrams + entity-specific)
        for v in variants:
            all_tasks.append(
                asyncio.ensure_future(self._search_single(v, namespace, limit=min(top_k, 50)))
            )

        # Individual keyword fan-out — search ALL keywords to maximize recall.
        # The re-ranking step will handle penalizing off-topic results
        # that matched only structural keywords.
        for kw in keywords:
            if kw not in [v.lower() for v in variants]:  # avoid duplicate searches
                all_tasks.append(
                    asyncio.ensure_future(self._search_single(kw, namespace, limit=min(top_k, 50)))
                )

        # Run all in parallel with timeout protection
        done: set[asyncio.Task] = set()
        pending: set[asyncio.Task] = set()
        try:
            done, pending = await asyncio.wait(all_tasks, timeout=timeout_s)
        except Exception:
            # If wait itself fails, collect whatever we can
            done = {t for t in all_tasks if t.done()}
            pending = {t for t in all_tasks if not t.done()}

        # Cancel any still-pending tasks
        for t in pending:
            t.cancel()
        if pending:
            logger.info(
                "Search timeout: %d/%d tasks completed in %.1fs, %d cancelled",
                len(done), len(all_tasks), timeout_s, len(pending),
            )

        # Collect results from completed tasks
        for task in done:
            try:
                result_set = task.result()
            except Exception:
                continue
            if isinstance(result_set, list):
                for item in result_set:
                    node_id = item.get("id", "")
                    if not node_id:
                        continue
                    existing = merged.get(node_id)
                    if existing is None or item.get("score", 0) > existing.get("score", 0):
                        merged[node_id] = item

        # Fallback: if we got zero results (likely full timeout), try a single
        # direct search with just the original query and generous timeout
        if not merged and pending:
            logger.info("Zero results after timeout — falling back to single-query search")
            try:
                fallback = await asyncio.wait_for(
                    self._search_single(query, namespace, limit=min(top_k, 50)),
                    timeout=30.0,
                )
                for item in fallback:
                    node_id = item.get("id", "")
                    if node_id:
                        merged[node_id] = item
            except Exception as exc:
                logger.warning("Fallback search also failed: %s", exc)

        sorted_results = sorted(merged.values(), key=lambda x: x.get("score", 0), reverse=True)

        # Client-side re-ranking: topic-aware keyword boost
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


def _trim_memory_for_answerer(memory: str, max_assistant_chars: int = 400) -> str:
    """Trim the assistant-response portion of a paired memory to reduce answerer context load.

    Keeps the full user message (where facts live) and truncates the assistant
    response to ``max_assistant_chars``.  This dramatically improves answerer
    comprehension when 10+ memories each contain 1000+ char assistant responses
    full of generic advice.

    For memories without a clear User:/Assistant: split, returns the original
    text (up to 2500 chars total).
    """
    # Find the assistant portion
    # Look for newline + "Assistant:" which is how we format paired turns
    asst_markers = ["\nAssistant:", "\nassistant:"]
    split_pos = -1
    for marker in asst_markers:
        pos = memory.find(marker)
        if pos > 0:
            split_pos = pos
            break

    if split_pos < 0:
        # No assistant portion found — return as-is (up to reasonable limit)
        return memory[:2500]

    user_portion = memory[:split_pos]
    asst_portion = memory[split_pos:]

    if len(asst_portion) <= max_assistant_chars:
        return memory

    # Truncate assistant response, keeping first N chars
    trimmed_asst = asst_portion[:max_assistant_chars].rstrip()
    # Try to break at a sentence boundary
    for punct in ['. ', '.\n', '! ', '? ']:
        last_punct = trimmed_asst.rfind(punct)
        if last_punct > max_assistant_chars // 2:
            trimmed_asst = trimmed_asst[:last_punct + 1]
            break

    return user_portion + trimmed_asst + " [...]"


def format_search_results(search_results: list[dict], for_answerer: bool = False) -> tuple[list[dict], dict | None]:
    """Normalize Sulcus search results to Mem0-compatible format.

    Args:
        search_results: Raw search results from Sulcus.
        for_answerer: If True, trim long assistant responses in memories to
            reduce context load on the answerer LLM. This improves comprehension
            when memories contain long generic advice paragraphs.

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
        memory_text = r.get("memory", "")
        if for_answerer:
            memory_text = _trim_memory_for_answerer(memory_text)

        entry: dict[str, Any] = {
            "memory": memory_text,
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
