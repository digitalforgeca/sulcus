## CRDT / Merge Strategy — IMPLEMENTED

### Design Choice: State-Based LWW-Registers at Entity Level

> **Do NOT use text-level CRDTs** (e.g. Automerge). SULCUS uses **State-based CRDTs  
> (Last-Writer-Wins Registers)** at the **Memory Node / Entity level**.

When an agent learns a new fact, it surgically patches that specific node via a `NodePatch`  
instead of overwriting the entire document. This is correct for memory systems: facts update,  
they do not "merge" at the character level.

---

### Core Primitives (`crates/sulcus-core/src/crdt.rs`)

#### Hybrid Logical Clock (`Hlc`)

```rust
pub struct Hlc {
    pub wall:    i64,    // Unix timestamp (ms)
    pub logical: u32,    // Tie-breaking counter when wall ties
    pub actor:   [u8; 8],// Node ID fingerprint — breaks remaining ties
}
```

`Hlc` implements `Ord` so any two events can be causally ordered without coordination.

#### LWW-Register (`LwwRegister<T>`)

```rust
pub struct LwwRegister<T: Clone + PartialEq> {
    pub value: T,
    pub clock: Hlc,
}
```

`merge(&mut self, other: &LwwRegister<T>) -> bool` keeps the value with the **higher clock**.  
Tie on exact same clock keeps `self` (stable, idempotent).

#### Node Patch (`NodePatch`)

```rust
pub struct NodePatch {
    pub node_id:         Uuid,
    pub label:           Option<LwwRegister<String>>,
    pub pointer_summary: Option<LwwRegister<String>>,
    pub base_utility:    Option<LwwRegister<f32>>,
    pub is_pinned:       Option<LwwRegister<bool>>,
    pub fold_result:     Option<LwwRegister<String>>,
}
```

- **`apply_to(&self, node: &mut Node) -> bool`** — writes only fields present in the patch;  
  does NOT overwrite fields absent from the patch. Returns `true` if any field changed.
- **`merge_from(&mut self, other: &NodePatch)`** — CRDT join (⊔); per-field LWW merge.  
  Two concurrent patches over the same node converge to a deterministic result regardless  
  of application order.

---

### WAL Op Extensions (`crates/sulcus-core/src/sync.rs`)

`OpType` now includes:

| Variant  | Meaning                                      |
| -------- | -------------------------------------------- |
| `Add`    | Insert a new node (full state)               |
| `Update` | Full node replacement (legacy)               |
| `Patch`  | Sparse surgical field update via `NodePatch` |
| `Delete` | Tombstone a node by id                       |

`MemoryOp` carries `patch: Option<NodePatch>` (skipped during serialization when `None`).

Factory helpers: `MemoryOp::patch(patch: NodePatch)` for clean construction.

`apply_op_to_node(op, node)` routes `Patch` ops to `NodePatch::apply_to`.

---

### Sync Integration (`crates/sulcus-local/src/sync.rs`)

The pull path (`pull_from_engine_and_apply`) now handles `OpType::Patch`:

```rust
OpType::Patch => {
    if let Some(ref patch) = op.patch {
        if let Ok(Some(mut node)) = storage.get_node(patch.node_id).await {
            if patch.apply_to(&mut node) {
                storage.upsert_node(node).await?;
            }
        }
    }
}
```

---

### Properties

| Property      | Guaranteed? | Mechanism                                              |
| ------------- | ----------- | ------------------------------------------------------ |
| Convergence   | ✅          | LWW merge is deterministic given same clock values     |
| Commutativity | ✅          | `merge_from` is commutative (higher clock always wins) |
| Idempotence   | ✅          | Merging identical patches is a no-op                   |
| Causality     | ✅          | `Hlc` captures wall-time + logical + actor ordering    |

---

### When to Use Each Op

| Scenario                      | Op to use                         |
| ----------------------------- | --------------------------------- |
| Agent records a new memory    | `Add`                             |
| Folding replaces node summary | `Patch` (fold_result field only)  |
| Agent updates a specific fact | `Patch` (only the changed fields) |
| Node removed / evicted        | `Delete`                          |
| Full node sync (cold-start)   | `Update`                          |

---

### Tombstoning

When a node page is **evicted** from the LRU active window, SULCUS writes a tombstone  
record containing a compact address hint:

```
[Paged Out: 0x4A2F User's database preferences...]
```

Tombstones are served in the `memory://active_index` MCP resource alongside hot nodes  
so the LLM context always has a breadcrumb back to evicted knowledge.  
Full content can be retrieved via a `fetch_payload` page fault.

---

### References

- Shapiro et al., "A comprehensive study of CRDTs" (2011)
- State-based CRDT vs. Op-based CRDT tradeoffs: state-based is simpler for sparse fact updates
- Hybrid Logical Clocks: Kulkarni et al. (2014)
