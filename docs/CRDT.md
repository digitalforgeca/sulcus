# SULCUS Distributed Consistency (HLC-CRDT)

SULCUS ensures causal consistency and high availability for AI agent memory using a Hybrid Logical Clock (HLC) and state-based Conflict-free Replicated Data Types (CRDTs).

## 1. The Clock (Hybrid Logical Clock)

To resolve conflicts without a central lock, every agent and the Sulcus API maintain an HLC.
- **Components:** `(wall_clock, logical_counter, node_id)`.
- **Properties:** 
  - Strictly monotonic.
  - Captures causal relationships between agents.
  - Clamped to maximum 500ms ahead of wall-clock to prevent clock-drift exploitation.

## 2. The Data Structure (LWW-Element-Graph)

The memory graph is modeled as an **LWW-Element-Graph**:
- **Nodes:** Upserted using Last-Write-Wins (LWW). If two agents update the same node, the one with the higher HLC timestamp prevails.
- **Edges:** Modeled as directed relationships. Deletions are handled via **Tombstones** to ensure idempotency during high-latency sync.

## 3. The Synchronization Protocol

Agents communicate via a **Hub-and-Spoke Anti-Entropy** protocol:

1. **Local Mutation:** Agent records a `MemoryOp` locally.
2. **Push:** Agent sends a batch of `MemoryOp` to the Sulcus API.
3. **Merge:** The API applies the patches to the **Golden Index** using HLC conflict resolution.
4. **Pull:** Other agents fetch the latest "Truth" from the Golden Index.

## 4. Why CRDTs for Agents?

Standard RAG systems often suffer from stale context. By using CRDTs, SULCUS allows multiple agents (e.g., a "Researcher" agent and a "Coder" agent) to collaboratively build a shared mental model in real-time without overwriting each other's insights.

---
*Last Updated: 2026-03-05*
