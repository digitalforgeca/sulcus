# Sulcus v2.3.0 — Conflict Detection, Explainable Recall, Confidence Levels

## Feature 1: Conflict Detection (Contradiction Trigger)

### New table: `conflicts`
```sql
CREATE TABLE IF NOT EXISTS conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  namespace TEXT,
  node_a_id UUID NOT NULL,
  node_b_id UUID NOT NULL,
  similarity REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open, resolved, dismissed
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, node_a_id, node_b_id)
);
```

### Logic (in agent.rs, on store):
When a new memory is stored:
1. After embedding is generated, query for existing nodes in same namespace with cosine similarity > 0.85
2. For each high-similarity match, compare content:
   - If pointer_summary text is substantially different (not just a rephrase), flag as conflict
   - Use simple heuristic: if similarity > 0.85 but Levenshtein ratio < 0.7, it's a potential conflict
3. Insert into `conflicts` table
4. Fire `on_conflict` trigger event

### New trigger event: `on_conflict`
Add to trigger_engine.rs `TriggerEvent` enum. Context includes both node IDs, similarity score.

### New endpoint: `GET /api/v1/agent/conflicts`
Returns open conflicts for the tenant. Query params: `?status=open&namespace=xxx&limit=20`

### Resolve endpoint: `PATCH /api/v1/agent/conflicts/:id`
Body: `{ "status": "resolved" | "dismissed" }` — sets resolved_at.

## Feature 2: Explainable Recall

### Change to search endpoint (`POST /api/v1/agent/search`):
When `?explain=true` query param is present (or body contains `"explain": true`):

Return additional fields per result:
```json
{
  "results": [{
    "id": "...",
    "pointer_summary": "...",
    "current_heat": 0.85,
    "score": 0.78,
    "explain": {
      "cosine_similarity": 0.92,
      "heat_component": 0.85,
      "similarity_weight": 0.7,
      "heat_weight": 0.3,
      "final_score": 0.78,
      "formula": "(0.92 * 0.7) + (0.85 * 0.3) = 0.899"
    }
  }]
}
```

### Implementation:
In `db.rs` `search_golden_index_ns_weighted()`:
- Already computes similarity and heat separately
- Add an `explain` flag parameter
- When true, return the raw components alongside the final score

In `agent.rs` `handle_text_search()`:
- Parse `explain` from query params or body
- Pass through to search function
- Include in response JSON

## Feature 3: Confidence Levels

### New column on `golden_index`:
```sql
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'observed';
```

Valid values: `verified`, `observed`, `inferred`, `stale`
- `verified` — explicitly confirmed by user/agent
- `observed` — default on store (agent saw/recorded it)
- `inferred` — derived from other memories (e.g., by curator/synthesis)
- `stale` — auto-marked by curator after 30 days without recall

### On store (agent.rs):
- Accept optional `confidence` field in store request body
- Default to `observed`

### On recall (agent.rs):
- Include `confidence` in search results

### Curator integration (curator.rs):
- In curation cycle, check nodes where `last_recalled_at` is NULL or > 30 days ago
- If `confidence != 'stale'` and `confidence != 'verified'`, set to `stale`
- Don't mark `verified` nodes as stale — they were explicitly confirmed

### Search results format:
Include confidence in all memory responses (list, search, get).

## Implementation Order:
1. Migration (all three features — one migration file)
2. Confidence column + store/recall support
3. Explainable recall
4. Conflict detection + trigger event

## Constraints:
- All backward compatible
- Migrations idempotent
- Do NOT touch graph.rs
- Cargo check after each feature
- Bump to v2.3.0
- Commit per feature, descriptive messages
- Do NOT push
