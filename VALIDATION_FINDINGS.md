# Sulcus Validation Findings — Ariadne

Gathered from 3+ validation rounds (2026-03-31 14:53–17:45 PDT).

## Fixed in This Branch

### 1. `hot_node_count` always 0
**Root cause:** Plugin `list_hot_nodes()` called `GET /api/v1/agent/memory/status` which returns stats/capabilities but no hot nodes. The actual hot nodes endpoint is `GET /api/v1/agent/hot_nodes`.
**Fix:** `493aa10` — corrected endpoint URL, added parallel fetch for enriched `memory_status` response.

## Fixed in Code, Pending Deploy

These fixes exist in master but the cloud server image hasn't been rebuilt yet.

### 2. Cross-namespace bleed on recall
**Root cause:** Search didn't default to the agent's own namespace. Queries in `ariadne` returned results from `daedalus`, `icarus`, `default`, and `membench`.
**Fix:** `1ed8772` (Daedalus) — search defaults to agent_label namespace, ACL enforced for cross-namespace.

### 3. Consolidate endpoint 404
**Root cause:** Endpoint `POST /api/v1/agent/consolidate` wasn't registered in routes.
**Fix:** `c0c7176` (Daedalus) — route added.

### 4. Trigger evaluate endpoint 404
**Root cause:** Endpoint `POST /api/v1/triggers/evaluate` wasn't registered in routes.
**Fix:** `c0c7176` (Daedalus) — route added.

## Still Open

### 5. Fresh memories not immediately recallable
**Root cause:** Memory INSERT does not populate the `embedding` column. Semantic search requires `embedding IS NOT NULL`. Embeddings are generated asynchronously (fire-and-forget spawn). Until embedding is computed, the memory is invisible to semantic search.
**Text fallback exists** but only triggers when semantic search returns 0 results. If *other* memories match semantically, the fresh one won't appear.
**Proposed fix:** Either:
  - (a) Generate embedding synchronously on INSERT (adds latency but guarantees immediate recall)
  - (b) Add the fresh node to text search index immediately (tsvector is populated on INSERT via PostgreSQL `to_tsvector`)
  - (c) Hybrid: return fresh unembedded nodes from text search alongside semantic results
  
  Option (b) should already work — `plainto_tsquery` searches `pointer_summary` which IS populated on INSERT. The issue may be that semantic search returns results from older memories, preventing the text fallback from running. **The fix is to merge text + semantic results rather than treating text as a fallback.**

### 6. SIU tools not exposed to agents
**Status:** Plugin v3.8.0 has `siu_label`, `siu_retrain`, `siu_status`, `trigger_feedback` but they're **disabled by default**. Agents need config to enable them.

### 7. `train: true` boolean
**Status:** `d9506d4` + `c4357db` (Daedalus) added `train_on_this` to API endpoints. Plugin and SDK need to wire this through on all memory operations.
