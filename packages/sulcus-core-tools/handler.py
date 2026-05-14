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
    """Build a token-budgeted context block from relevant memories.

    Uses semantic search (query-based) with client-side token budget
    enforcement, plus hot memories for recency. Results are merged,
    deduplicated, and truncated to fit within the token budget.

    Approximate token estimation: 1 token ≈ 4 characters.
    """
    chars_budget = token_budget * 4
    results: list[dict] = []
    seen_ids: set[str] = set()

    # 1. Semantic search — query-relevant memories
    try:
        search_resp = sulcus_search(query, limit=15)
        for item in (search_resp.get("results") or []):
            mid = item.get("id", "")
            if mid and mid not in seen_ids:
                seen_ids.add(mid)
                results.append(item)
    except RuntimeError:
        pass  # search failed — continue with hot nodes only

    # 2. Hot nodes — high-heat memories for recency/importance signal
    try:
        hot = sulcus_hot_nodes(limit=5)
        for item in (hot if isinstance(hot, list) else []):
            mid = item.get("id", "")
            if mid and mid not in seen_ids:
                seen_ids.add(mid)
                results.append(item)
    except RuntimeError:
        pass

    # 3. Diversity filter — remove near-duplicate results
    results = diversity_filter(results, threshold=0.6)

    # 3.5. PII guardrails — redact PII from recall results
    results = _guard_recall_results(results)

    # 4. Enforce token budget — greedy packing by relevance order
    packed: list[dict] = []
    chars_used = 0
    for item in results:
        text = item.get("pointer_summary") or item.get("label") or item.get("content") or ""
        text_len = len(text)
        if chars_used + text_len > chars_budget:
            # Try truncating to fit remaining budget
            remaining = chars_budget - chars_used
            if remaining > 100:  # only include if meaningful chunk fits
                item = {**item, "_truncated": True}
                packed.append(item)
                chars_used += remaining
            break
        packed.append(item)
        chars_used += text_len

    return {
        "memories": packed,
        "token_budget": token_budget,
        "tokens_used_estimate": chars_used // 4,
        "total_candidates": len(results),
        "selected": len(packed),
    }


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


def sulcus_auto_recall(query: str, token_budget: int = 4000,
                       graph_hops: bool = True, graph_seed_count: int = 2,
                       graph_max_extras: int = 4, min_heat: float = 0.2) -> dict:
    """Auto-recall: query-aware context retrieval with graph-hop expansion.

    This is the recommended way to build session context for LLM integrations
    that don't have lifecycle hooks (Gemini, OpenAI, LangChain, etc.).

    Pipeline:
    1. Semantic search with query (limit=10) for relevance
    2. Graph-hop expansion: seed top-N search results → fetch neighbors → fold warm nodes
    3. Hot nodes (limit=5) for recency/importance signal
    4. Diversity filter — remove near-duplicate results (Jaccard > 0.6)
    5. Client-side token budget enforcement (greedy packing)

    Returns a formatted context string suitable for system prompt injection,
    plus metadata about the recall.
    """
    chars_budget = token_budget * 4  # ~4 chars/token heuristic
    all_results: list[dict] = []
    seen_ids: set[str] = set()

    # 1. Semantic search
    try:
        search_resp = sulcus_search(query, limit=10)
        for item in (search_resp.get("results") or []):
            mid = item.get("id", "")
            if mid and mid not in seen_ids:
                seen_ids.add(mid)
                all_results.append(item)
    except RuntimeError:
        pass

    # 2. Graph-hop expansion (mirrors Claude Code plugin pattern)
    graph_count = 0
    if graph_hops and all_results:
        seed_ids = [r["id"] for r in all_results[:graph_seed_count] if r.get("id")]
        for seed_id in seed_ids:
            try:
                neighbors_resp = sulcus_graph_traverse(seed_id)
                neighbors = (
                    neighbors_resp if isinstance(neighbors_resp, list)
                    else (neighbors_resp.get("neighbors") or [])
                )
                extras = []
                for node in neighbors:
                    nid = node.get("id", "")
                    if not nid or nid in seen_ids:
                        continue
                    heat = node.get("current_heat", 0) or 0
                    if heat < min_heat:
                        continue  # skip cold nodes
                    seen_ids.add(nid)
                    node["_source"] = "graph"
                    extras.append(node)
                # Sort by heat, take top extras
                extras.sort(key=lambda n: n.get("current_heat", 0) or 0, reverse=True)
                all_results.extend(extras[:graph_max_extras])
                graph_count += len(extras[:graph_max_extras])
            except RuntimeError:
                continue  # graph failure is non-fatal

    # 3. Hot nodes for recency signal
    try:
        hot = sulcus_hot_nodes(limit=5)
        for item in (hot if isinstance(hot, list) else []):
            mid = item.get("id", "")
            if mid and mid not in seen_ids:
                seen_ids.add(mid)
                all_results.append(item)
    except RuntimeError:
        pass

    # 4. Diversity filter — remove near-duplicate results
    all_results = diversity_filter(all_results, threshold=0.6)

    # 4.5. PII guardrails — redact PII from recall results before injection
    all_results = _guard_recall_results(all_results)

    # 5. Token budget enforcement (greedy packing)
    packed: list[str] = []
    chars_used = 0
    packed_count = 0
    for item in all_results:
        text = item.get("pointer_summary") or item.get("label") or item.get("content") or ""
        heat = item.get("current_heat")
        mtype = item.get("memory_type", "")
        source = item.get("_source", "")
        heat_tag = f" [heat:{heat:.2f}]" if heat is not None else ""
        type_tag = f" ({mtype})" if mtype else ""
        src_tag = " [graph]" if source == "graph" else ""
        line = f"- {text[:400]}{heat_tag}{type_tag}{src_tag}"

        if chars_used + len(line) > chars_budget and packed:
            break
        packed.append(line)
        chars_used += len(line)
        packed_count += 1

    context_text = "\n".join(packed) if packed else "No relevant memories found."

    return {
        "context": context_text,
        "token_budget": token_budget,
        "tokens_used_estimate": chars_used // 4,
        "total_candidates": len(all_results),
        "selected": packed_count,
        "graph_hop_count": graph_count,
    }


def sulcus_classify(text: str) -> dict:
    """Classify text via SIU v2 quality gate.
    Maps to POST /api/v2/siu/label.

    Returns: { quality: "store"|"reject", quality_confidence: float,
             memory_type: str, type_confidence: float,
             model_version: str, engine: str }
    """
    url = BASE_URL + "/api/v2/siu/label"
    data = json.dumps({"text": text}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=_headers(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {}
    except (urllib.error.HTTPError, urllib.error.URLError):
        return {}  # SIU unavailable — degrade gracefully


# ---------------------------------------------------------------------------
# PII Detection & Redaction (ported from OpenClaw plugin guardrails)
# ---------------------------------------------------------------------------

import re

_PII_PATTERNS = [
    ("email", re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")),
    ("phone", re.compile(r"(?:\+?\d[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4}\b")),
    ("ssn", re.compile(r"\b\d{3}[\s\-]\d{2}[\s\-]\d{4}\b")),
    ("credit_card", re.compile(
        r"\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|6011\d{12}|3(?:0[0-5]|[68]\d)\d{11})\b"
    )),
    ("ip_address", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("api_key", re.compile(
        r"\b(sk-[a-zA-Z0-9]{20,}|sk-ant-[a-zA-Z0-9\-]{20,}"
        r"|gh[pors]_[A-Za-z0-9]{36,}|xox[bpa]-[A-Za-z0-9\-]+"
        r"|AKIA[A-Z0-9]{16}"
        r"|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,})\b"
    )),
]

_PII_REPLACEMENTS = {
    "email": "[EMAIL_REDACTED]",
    "phone": "[PHONE_REDACTED]",
    "ssn": "[SSN_REDACTED]",
    "credit_card": "[CARD_REDACTED]",
    "ip_address": "[IP_REDACTED]",
    "api_key": "[KEY_REDACTED]",
}


def sulcus_scan_pii(text: str) -> dict:
    """Scan text for PII patterns and return detected spans.

    Returns: {
        "found": bool,
        "spans": [{ "type": str, "start": int, "end": int }],
        "types": [str],  # deduplicated list of PII types found
        "redacted": str,  # text with PII replaced by type-specific placeholders
    }
    """
    spans: list[dict] = []
    for pii_type, pattern in _PII_PATTERNS:
        for match in pattern.finditer(text):
            spans.append({
                "type": pii_type,
                "start": match.start(),
                "end": match.end(),
            })

    if not spans:
        return {"found": False, "spans": [], "types": [], "redacted": text}

    # Sort by position for left-to-right replacement
    spans.sort(key=lambda s: s["start"])

    # Remove overlapping spans (keep first match at each position)
    deduped: list[dict] = []
    last_end = -1
    for span in spans:
        if span["start"] >= last_end:
            deduped.append(span)
            last_end = span["end"]
    spans = deduped

    # Redact
    result_parts: list[str] = []
    cursor = 0
    for span in spans:
        if span["start"] > cursor:
            result_parts.append(text[cursor:span["start"]])
        result_parts.append(_PII_REPLACEMENTS.get(span["type"], "[REDACTED]"))
        cursor = span["end"]
    result_parts.append(text[cursor:])

    types = list({s["type"] for s in spans})
    return {
        "found": True,
        "spans": spans,
        "types": types,
        "redacted": "".join(result_parts),
    }


def _guard_recall_results(results: list[dict]) -> list[dict]:
    """Apply PII redaction to a list of recall result dicts in-place.

    For each memory, scans pointer_summary/label/content for PII and replaces
    with redacted text. Returns the guarded list (same objects, modified).
    """
    for item in results:
        for key in ("pointer_summary", "label", "content"):
            text = item.get(key)
            if text:
                scan = sulcus_scan_pii(text)
                if scan["found"]:
                    item[key] = scan["redacted"]
    return results


# ---------------------------------------------------------------------------
# Junk filtering (ported from Claude Code capture-utils.cjs)
# ---------------------------------------------------------------------------

_JUNK_PATTERNS = [
    re.compile(r"^(HEARTBEAT_OK|NO_REPLY|NOOP)$", re.IGNORECASE),
    re.compile(r"^\s*$"),
    re.compile(r"^system:\s", re.IGNORECASE),
    re.compile(r"^\[?(message_id|sender_id|conversation_label|schema)[\]\"\:]", re.IGNORECASE),
    re.compile(r"^Conversation info \(untrusted", re.IGNORECASE),
    re.compile(r"^UNTRUSTED (channel|Discord)", re.IGNORECASE),
    re.compile(r"^Runtime:", re.IGNORECASE),
    re.compile(r"\b(sk-[a-f0-9]{40,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,})\b"),
    re.compile(r"\b(api[_\-]?key|secret|password|token)\s*[:=]\s*[\"']?[A-Za-z0-9._~+/=-]{16,}", re.IGNORECASE),
]


def _is_junk(text: str) -> bool:
    """Return True if text is system noise, credentials, or metadata."""
    if not text or len(text) < 10 or len(text) > 10000:
        return True
    trimmed = text.strip()
    return any(p.search(trimmed) for p in _JUNK_PATTERNS)


# ---------------------------------------------------------------------------
# Diversity filter — remove near-duplicate recall results
# ---------------------------------------------------------------------------

_STOP_WORDS = frozenset([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "and", "but", "or",
    "nor", "not", "so", "yet", "both", "either", "neither", "each",
    "every", "all", "any", "few", "more", "most", "other", "some",
    "such", "no", "only", "own", "same", "than", "too", "very",
    "just", "about", "up", "out", "if", "then", "this", "that",
    "it", "its", "he", "she", "they", "we", "you", "i", "me",
    "my", "your", "his", "her", "our", "their", "what", "which",
    "who", "whom", "how", "when", "where", "why",
])


def _tokenize(text: str) -> set[str]:
    """Extract meaningful tokens from text for overlap comparison."""
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {w for w in words if w not in _STOP_WORDS and len(w) > 2}


def _jaccard(a: set[str], b: set[str]) -> float:
    """Jaccard similarity between two token sets."""
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union else 0.0


def diversity_filter(results: list[dict], threshold: float = 0.6) -> list[dict]:
    """Remove near-duplicate results using Jaccard overlap on token sets.

    Keeps the first (highest-scored) result when two results overlap above threshold.
    Results should be pre-sorted by relevance (score/heat descending).
    """
    if len(results) <= 1:
        return results

    kept: list[dict] = []
    kept_tokens: list[set[str]] = []

    for item in results:
        text = item.get("pointer_summary") or item.get("label") or item.get("content") or ""
        tokens = _tokenize(text)
        if not tokens:
            kept.append(item)  # can't compare — keep it
            continue

        is_dup = False
        for existing_tokens in kept_tokens:
            if _jaccard(tokens, existing_tokens) > threshold:
                is_dup = True
                break

        if not is_dup:
            kept.append(item)
            kept_tokens.append(tokens)

    return kept


# ---------------------------------------------------------------------------
# Auto-capture — SIU v2 quality-gated memory storage
# ---------------------------------------------------------------------------

_MIN_CAPTURE_CONFIDENCE = 0.5


def sulcus_auto_capture(text: str, source: str = "auto-capture-python") -> dict:
    """Auto-capture: classify text via SIU v2 quality gate and store if worthy.

    Pipeline:
    1. Junk filter — reject system noise, credentials, metadata
    2. SIU v2 classification — quality gate + memory type prediction
    3. Store — if SIU says "store" (or low-confidence "reject")

    Returns metadata about the capture decision.
    """
    if _is_junk(text):
        return {"captured": False, "reason": "junk_filtered"}

    # Classify via SIU v2
    siu_result = sulcus_classify(text)
    if not siu_result:
        # SIU unavailable — store with benefit of the doubt
        result = sulcus_remember(text, memory_type="episodic", heat=60.0)
        return {
            "captured": True,
            "reason": "siu_unavailable_fallback",
            "memory_type": "episodic",
            "store_result": result,
        }

    quality = siu_result.get("quality", "store")
    quality_conf = siu_result.get("quality_confidence", 0.0)
    memory_type = siu_result.get("memory_type", "episodic")

    # Quality gate: reject if SIU says don't store with sufficient confidence
    if quality == "reject" and quality_conf >= _MIN_CAPTURE_CONFIDENCE:
        return {
            "captured": False,
            "reason": "siu_rejected",
            "quality": quality,
            "quality_confidence": quality_conf,
        }

    # Store the memory
    result = sulcus_remember(
        text,
        memory_type=memory_type,
        heat=75.0,  # slightly below default — auto-captured, not user-explicit
    )

    return {
        "captured": True,
        "reason": "siu_approved",
        "quality": quality,
        "quality_confidence": quality_conf,
        "memory_type": memory_type,
        "type_confidence": siu_result.get("type_confidence", 0.0),
        "engine": siu_result.get("engine", "unknown"),
        "store_result": result,
    }


def sulcus_status() -> dict:
    """Get server status. Maps to GET /api/v1/status."""
    return _get("/status")


# ---------------------------------------------------------------------------
# Context-window throttling (in-process, for Python integrations)
# ---------------------------------------------------------------------------

class ContextThrottle:
    """Tracks estimated context usage and scales recall budget.

    Unlike the Claude Code version (file-based, cross-process), this is
    in-process since Python integrations run as a single long-lived process.

    Usage:
        throttle = ContextThrottle(context_window=200000)
        throttle.record_turn(prompt_length=500)
        level = throttle.get_level()
        budget = int(base_budget * level["budget_scale"])
    """

    def __init__(self, context_window: int = 200000):
        self.context_window = context_window
        self.estimated_tokens_used = 0
        self.turn_count = 0
        self.recall_tokens_injected = 0

    def record_turn(self, prompt_chars: int, recall_chars: int = 0) -> None:
        self.turn_count += 1
        prompt_tokens = prompt_chars // 4
        response_est = min(int(prompt_tokens * 1.5), 4000) or 800
        recall_tokens = recall_chars // 4
        self.estimated_tokens_used += prompt_tokens + response_est + 200  # overhead
        self.recall_tokens_injected += recall_tokens

    def record_recall(self, chars: int) -> None:
        tokens = chars // 4
        self.estimated_tokens_used += tokens
        self.recall_tokens_injected += tokens

    def get_level(self) -> dict:
        fill = self.estimated_tokens_used / self.context_window if self.context_window else 0
        if fill >= 0.90:
            return {"level": "silent", "budget_scale": 0.0, "fill": fill}
        elif fill >= 0.80:
            return {"level": "muted", "budget_scale": 0.15, "fill": fill}
        elif fill >= 0.60:
            return {"level": "reduced", "budget_scale": 0.50, "fill": fill}
        else:
            return {"level": "normal", "budget_scale": 1.0, "fill": fill}

    def reset(self, post_compact: bool = False) -> None:
        if post_compact:
            self.estimated_tokens_used = int(self.context_window * 0.05)
            self.recall_tokens_injected = 0
        else:
            self.estimated_tokens_used = 0
            self.turn_count = 0
            self.recall_tokens_injected = 0


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
    "sulcus_auto_recall": sulcus_auto_recall,
    "sulcus_classify": sulcus_classify,
    "sulcus_auto_capture": sulcus_auto_capture,
    "sulcus_scan_pii": sulcus_scan_pii,
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
