---
name: sulcus-search
description: Search and expand Sulcus persistent memory. Use when the user asks about past work, previous sessions, architectural rationale, user preferences, or how a feature or bug fix was implemented.
allowed-tools: mcp__sulcus__search_memory, mcp__sulcus__expand_memory, mcp__sulcus__list_memories, mcp__sulcus__list_namespaces, mcp__sulcus__build_context
---

# Sulcus Memory Search & Territory Expansion

Search Sulcus for past coding sessions, architectural decisions, preferences, and verified procedures.

## Map -> Territory Recall Workflow

1. **Hybrid Search (`mcp__sulcus__search_memory`)**:
   - Pass `query` (natural-language concepts or keywords), optional `memory_type` (`episodic`, `semantic`, `preference`, `procedural`, `fact`), `namespace`, `tier` (`"hot"` | `"cold"` | `"all"`), and `limit` (default `10`).
   - Results return compact **Map** summaries (`pointer_summary`), `heat` (`0.0–1.0`), and `node_id`s.
2. **Expand Full Territory (`mcp__sulcus__expand_memory`)**:
   - Whenever a search result or `<sulcus-memories>` pointer contains a `ccr:<hex>` handle or you need its full uncompacted details, call `mcp__sulcus__expand_memory` with `node_id` (and optional `lines`, e.g. `"1-80"`).
3. **Browse Working Set & Namespaces**:
   - Call `mcp__sulcus__list_memories` to inspect the hottest active memories in working context.
   - Call `mcp__sulcus__list_namespaces` to check available project namespaces.

## Search Tips

- Query by concept and intent (e.g. `"JWT verification algorithm mismatch"`) — Sulcus combines dense semantic vectors with BM25 keyword ranking and heat weighting.
- Pass `tier: "all"` when looking for older archived work from months ago.
- Summarize findings directly and concisely for the user rather than dumping raw UUIDs unless requested.
