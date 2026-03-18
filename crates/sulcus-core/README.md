# sulcus-core

Core memory model and thermodynamics for [SULCUS](https://sulcus.ca) — a
production-grade federated knowledge network with agent-native persistent memory.

## What's inside

- **ACT-R Thermodynamics** — heat-based memory activation; nodes decay over time,
  spike on access, and diffuse heat to neighbours via graph edges.
- **HLC-CRDTs** — Hybrid Logical Clock conflict-free replicated data types for
  deterministic, causally-consistent multi-instance sync.
- **Zero-copy shared index** — `rkyv`-encoded `NodePointer` buffer written to a
  memory-mapped file for sub-microsecond LLM runtime reads.
- **Virtual MMU** — page-fault model for lazy node hydration; cold nodes are evicted
  from the active index and recalled on demand.

## Usage

```toml
[dependencies]
sulcus-core = "0.1"
```

```rust
use sulcus_core::mmu::{MemoryNode, MemoryBudget};

let node = MemoryNode::new("My concept");
// plug into a StorageBackend implementation (e.g. sulcus-local)
```

## License

Dual-licensed under [MIT](../../LICENSE-MIT) or Apache-2.0.
