# Memory Curation & Consolidation Cycle

Sulcus includes an autonomous background curator and an agent-facing consolidation pipeline that maintain memory quality without manual intervention. The background curator runs on a configurable interval (default: every 30 minutes) and performs seven maintenance passes on each active `(tenant_id, namespace)` slice.

---

## The 7-Step Curator Cycle

### 1. Re-classify Stale Nodes

Nodes that haven't been recalled recently can drift out of alignment with the namespace's evolving context. The curator identifies nodes whose internal epoch lags behind the namespace epoch and flags them for SIU reclassification.

When LLM-powered extraction is enabled, the SIU Intelligence Unit re-evaluates each flagged node; reassigning its `memory_type`, updating entity links, and refreshing its pointer summary.

### 2. Consolidate Near-Duplicates

The curator scans for unlocked, unpinned node pairs (`is_locked = false`, `is_pinned = false`) with cosine similarity above **0.92**. When a near-duplicate pair is found:

- An LLM-powered (or Caveman-distilled) merge produces a single unified node preserving the best content from both sources.
- Both source `raw_content` payloads (Territory) are preserved on the surviving node.
- The weaker node is **soft-archived** (`archived_at = NOW()`) and recorded in `archive_log` (`reason = 'duplicate_consolidation'`): never hard-deleted.
- Graph edges (`golden_edges`) from the archived node are re-homed to the surviving node, and a `consolidated_from` (`keep_id -> archive_id`) lineage edge is recorded.

### 3. Summarize Verbose Nodes

Nodes exceeding **500 characters** in `pointer_summary` are condensed into high-density Map pointers while preserving the original full text in `raw_content` (Territory). Token budget is recovered without losing information.

### 4. Re-vectorize

Nodes missing embeddings receive fresh embeddings via the active embedding engine (`fastembed` BGE-Small-EN-v1.5), ensuring every node is searchable via semantic vector similarity.

### 5. Mark Stale Confidence

Nodes that haven't been recalled in **30+ days** (and have low heat) are marked with a `stale` confidence flag. This signal:

- Deprioritizes them in future recall rankings.
- Makes them candidates for consolidation in subsequent cycles.
- Does **not** delete or archive them; they remain fully accessible.

### 6. Sync to Knowledge Graph

All nodes modified during the cycle are synchronized to the Apache AGE knowledge graph. This keeps the graph index consistent with the relational store and ensures that topological heat diffusion operates on current data.

### 7. Auto-Fold Cold Nodes (`step_fold_cold_nodes`)

Clusters of 3+ cold, stale, unlocked, unpinned nodes (`current_heat < 0.08`, age > 14 days, `memory_type != 'synthesis'`) sharing a `(namespace, memory_type)` slice are automatically folded into a non-destructive `'synthesis'` node:

- **Map (`pointer_summary`)**: Distilled via `sulcus_core::distill_caveman_pointer` ($\le 200$ chars).
- **Territory (`raw_content`)**: Stacked from the source nodes' `raw_content` (falling back to `pointer_summary`), preserving full inspectable detail on Page Fault.
- **Vector (`embedding`)**: Computed inline via the embedding engine so the synthesis node is immediately vector-searchable.
- **Lineage & Entity Spine**: Wired to source nodes via `consolidated_from` (`synthesis_id -> source_id`) edges, synced to Apache AGE, and linked into the Canonical Entity Spine (`create_coref_edges`).
- **Soft-Archival**: Source nodes are soft-archived (`archived_at = NOW()`, `current_heat = 0.02`) and logged in `archive_log` (`reason = 'cold_fold'`).

---

## Agent & Piggyback Consolidation Endpoints

In addition to the background curator, agents and automated workflows can trigger or assist consolidation directly:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/agent/consolidation-candidates` | `GET` | Filters by namespace and uses semantic clustering to return coherent cold clusters for folding. |
| `/api/v1/agent/fold` | `POST` | Folds verified, unlocked `source_ids` into a new `'synthesis'` node with Caveman-distilled `pointer_summary` (Map), stacked source `raw_content` (Territory), inline vector embedding, `consolidated_from` edges, and Entity Spine edges. |
| `/api/v1/agent/consolidate` | `POST` | Clusters cold memories (`current_heat < min_heat`), synthesizes non-destructive `'synthesis'` nodes (Map + Territory + Vector + `consolidated_from` + Entity Spine) for multi-node clusters, and soft-archives the cold source nodes with `archive_log` entries. |

---

## Scheduling Behavior

The background curator runs automatically every **30 minutes** on active namespaces and also triggers opportunistically when a namespace has been idle for **10 minutes**, ensuring maintenance runs even during low-activity periods.

---

## Design Principles

- **Never delete**: The curator and consolidation endpoints archive and synthesize but never hard-delete data. Every node's Territory and lineage (`consolidated_from` + `archive_log`) are preserved.
- **Respect Locks & Pins**: Nodes with `is_locked = true` or `is_pinned = true` are strictly excluded from duplicate archival, cold folding, and consolidation archival.
- **Map vs. Territory Invariant**: Every consolidated `'synthesis'` node has both a terse Caveman-distilled `pointer_summary` (Map) and stacked source `raw_content` (Territory), plus an inline vector embedding and Entity Spine links.
- **LLM-optional**: When LLM extraction is not configured, Sulcus uses deterministic Caveman distillation and extractive synthesis.

