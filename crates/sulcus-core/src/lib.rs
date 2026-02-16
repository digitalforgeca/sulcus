//! sulcus-core: shared business logic for the Sulcus memory system.
//!
//! Exposes the graph model (nodes/edges), thermodynamics (decay + spreading activation)
//! and the Sync / Storage traits used by `sulcus-local` and `sulcus-server`.

pub mod graph;
pub mod sync;

pub use graph::{apply_decay, spread_activation, Edge, EdgeType, Node};
pub use sync::{MemoryOp, OpType, StorageBackend, SyncEngine};
