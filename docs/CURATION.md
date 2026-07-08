# Memory Curation Cycle

Sulcus includes an autonomous background curator that maintains memory quality without manual intervention. It runs on a configurable interval (default: every 30 minutes) and performs six maintenance passes on each namespace.

---

## The 6-Step Cycle

### 1. Re-classify Stale Nodes

Nodes that haven't been recalled recently can drift out of alignment with the namespace's evolving context. The curator identifies nodes whose internal epoch lags behind the namespace epoch and flags them for SIU reclassification.

When LLM-powered extraction is enabled, the SIU Intelligence Unit re-evaluates each flagged node — reassigning its `memory_type`, updating entity links, and refreshing its pointer summary.

### 2. Consolidate Near-Duplicates

The curator scans for node pairs with cosine similarity above **0.92**. When a near-duplicate pair is found:

- An LLM-powered merge produces a single unified node preserving the best content from both sources.
- The weaker node (lower heat, fewer recalls) is **archived** — never deleted.
- Graph edges from the archived node are transferred to the surviving node.

This prevents semantic bloat while preserving every piece of information in the archive.

### 3. Summarize Verbose Nodes

Nodes exceeding **500 characters** with low recall frequency are candidates for condensation:

- LLM-powered summarization distills the node to its essential meaning.
- The original full content is preserved in the node's history.
- Token budget is recovered without losing information.

### 4. Re-vectorize

Nodes missing embeddings (e.g., imported via Markdown, migrated from older versions, or modified by the merger) receive fresh **384-dimensional embeddings** via the ONNX runtime. This ensures every node is searchable via semantic similarity.

### 5. Mark Stale Confidence

Nodes that haven't been recalled in **30+ days** are marked with a `stale` confidence flag. This signal:

- Deprioritizes them in future recall rankings.
- Makes them candidates for consolidation in subsequent cycles.
- Does **not** delete or archive them — they remain fully accessible.

### 6. Sync to Knowledge Graph

All nodes modified during the cycle are synchronized to the Apache AGE knowledge graph. This keeps the graph index consistent with the relational store and ensures that topological heat diffusion operates on current data.

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `CURATOR_INTERVAL_SECS` | `1800` (30 min) | Time between curation cycles |
| `SULCUS_EXTRACTION_ENABLED` | `false` | Enable LLM-powered reclassification, merging, and summarization |

The curator also triggers opportunistically when a namespace has been idle for **10 minutes**, ensuring maintenance runs even during low-activity periods.

---

## Design Principles

- **Never delete** — The curator archives and consolidates but never removes data. Every node's history is preserved.
- **LLM-optional** — Without `SULCUS_EXTRACTION_ENABLED`, the curator still handles re-vectorization, staleness marking, and graph sync. LLM-powered steps (reclassify, merge, summarize) are skipped gracefully.
- **Observable** — All curator activity is logged with timestamps, affected node IDs, and action types. Use the activity log or dashboard to audit curation history.
- **Non-blocking** — The curator runs in a background task and does not block memory operations (store, recall, search) during execution.

---

## How It Fits Together

```
┌─────────────────────────────────────────────────┐
│              Curation Cycle (every 30m)          │
│                                                   │
│  ① Re-classify  →  ② Consolidate  →  ③ Summarize │
│        ↓                                          │
│  ④ Re-vectorize →  ⑤ Mark stale   →  ⑥ Graph sync│
│                                                   │
│  Generates training signals (reclassify_pending)  │
│        ↓                                          │
│  Offline Training Pipeline (see OFFLINE_TRAINING) │
└─────────────────────────────────────────────────┘
```

Reclassification decisions made by the curator generate training signals that feed into the [Offline Training Pipeline](OFFLINE_TRAINING.md), creating a self-improving feedback loop where the SIU models learn from every curation cycle.
