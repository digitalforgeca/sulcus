# Memory Curation Cycle

Sulcus pairs local client consolidation (`sulcus` + MCP `compact_memory`) with an autonomous background curator on the managed Sulcus API (`api.sulcus.ca`) to maintain memory quality without manual intervention. On the Sulcus API, background curation runs on a regular cadence (every 30 minutes on active namespaces) and executes seven non-destructive maintenance passes per namespace.

---

## Curator Passes

### Reclassify Stale Nodes

Nodes that have not been recalled recently can drift out of alignment with a project's evolving context. The curator identifies memories whose classification lags behind current domain usage and re-evaluates them through System 1 VCR—reassigning `memory_type`, refreshing entity relationships, and tightening `pointer_summary` when appropriate.

### Consolidate Duplicates

The curator scans unlocked, unpinned memories (`is_locked = false`, `is_pinned = false`) with cosine similarity above **0.92**. When a near-duplicate pair is detected:

- Deterministic Caveman distillation (or optional synthesis) produces a unified surviving node preserving key facts from both memories.
- Both source `raw_content` payloads (Territory) remain preserved on the surviving node.
- The redundant node is **soft-archived** (never hard-deleted) and inspectable via `/api/v1/agent/archive`.
- Existing graph relationships are re-homed to the surviving node alongside a `consolidated_from` provenance link.

### Summarize Verbose Pointers

Nodes exceeding **500 characters** in `pointer_summary` are condensed into compact Map pointers while preserving the complete original text in `raw_content` (Territory). Prompt token budget is recovered without losing detail.

### Refresh Missing Embeddings

Any memory missing dense vector coordinates receives fresh embeddings from the active embedding model (default 384-d BGE-Small-EN-v1.5 or your configured cartridge), ensuring every node participates in hybrid semantic search.

### Mark Stale Confidence

Unpinned memories that have not been recalled in **30+ days** and carry low salience heat are marked with `confidence = "stale"`. This signal:

- Lowers their priority in default recall rankings.
- Flags them as candidates for synthesis folding in subsequent passes.
- Does **not** delete or hide them; they remain searchable and restorable.

### Synchronize Graph Topology

Modified memories and provenance links synchronize into the managed knowledge graph on `api.sulcus.ca` (and into the local property graph on standalone `sulcus` clients) so 2-hop spreading-activation resonance operates on up-to-date edges.

### Fold Cold Clusters

Clusters of 3 or more cold, stale, unlocked, unpinned memories (`current_heat < 0.08`, age > 14 days, `memory_type != "synthesis"`) within the same namespace and archetype are folded into a non-destructive `synthesis` memory:

- **Map (`pointer_summary`)**: Condensed into a terse pointer ($\le 200$ chars) for low-token prompt scanning.
- **Territory (`raw_content`)**: Stacks the source memories' `raw_content` so full line-level detail remains available on `expand_memory`.
- **Vector (`embedding`)**: Embedded inline so the new `synthesis` node is immediately vector-searchable.
- **Provenance & Entities**: Linked back to source memories via `consolidated_from` edges and connected to shared entity references.
- **Reversible Soft-Archival**: Source nodes move to the cold archive (`GET /api/v1/agent/archive`) and can be restored to active working memory at any time via `POST /api/v1/agent/restore`.

---

## Agent Consolidation Endpoints

Agents and workflows can also preview or trigger consolidation directly against the Sulcus API (`https://api.sulcus.ca`) or local `sulcus` client (`http://127.0.0.1:4203`):

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/agent/consolidation-candidates` | `GET` | Lists coherent cold memory clusters within a namespace that are eligible for synthesis folding. |
| `/api/v1/agent/fold` | `POST` | Folds specified unlocked `source_ids` into a `synthesis` memory with a compact Map pointer, stacked Territory, vector embedding, and `consolidated_from` provenance links. |
| `/api/v1/agent/consolidate` | `POST` | Clusters cold memories (`current_heat < min_heat`), creates non-destructive `synthesis` nodes, and soft-archives the source episodes. |
| `/api/v1/agent/archive` | `GET` | Lists soft-archived source memories for audit and inspection. |
| `/api/v1/agent/restore` | `POST` | Restores soft-archived memories back into active recall. |

---

## Design Guarantees

- **Non-Destructive Archival**: Curation and consolidation never hard-delete memories; Territory payloads and `consolidated_from` provenance links are always preserved.
- **Pin & Lock Immunity**: Memories with `is_locked = true` or `is_pinned = true` are never archived or folded.
- **Map vs. Territory Invariant**: Every consolidated `synthesis` node maintains a compact `pointer_summary` (Map) alongside full stacked `raw_content` (Territory) for on-demand `expand_memory`.
- **Zero-LLM Default**: Both the `sulcus` client engine and the Sulcus API perform deterministic Caveman pointer distillation and extractive synthesis without requiring external LLM calls.
