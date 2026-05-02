//! sulcus-core: Full vMMU domain models — re-exports public types from `sulcus-types`
//! plus proprietary sync protocol (CRDT merge, WAL compaction, sync engine).
//!
//! This crate exists as a compatibility shim: all public types live in `sulcus-types`
//! (MIT licensed), while this crate adds the proprietary sync layer on top.
//! Existing `use sulcus_core::` imports continue to work unchanged.

pub mod triggers;

pub mod consolidation;

pub mod folds;

// Re-export all public types from sulcus-types
pub use sulcus_types::crdt;
pub use sulcus_types::graph;
pub use sulcus_types::mmu;
pub use sulcus_types::sync;
pub use sulcus_types::thermo;
pub use sulcus_types::zero_copy;

// Re-export commonly used items at the crate root
pub use sulcus_types::crdt::{Hlc, LwwRegister, NodePatch};
pub use sulcus_types::graph::Node;
pub use sulcus_types::mmu::{Page, PageFaultHandler, PageTableEntry, PassthroughMmu, Space};
pub use sulcus_types::sync::WalCompactor;
pub use sulcus_types::thermo::{
    ActiveIndexConfig, ConsolidationConfig, ConsolidationStrategy, DecayClass, DecayProfile,
    ReinforcementConfig, ResonanceConfig, ThermoConfig, TickMode,
};
pub use sulcus_types::zero_copy::{NodePointer, SharedIndexBuffer};
pub use sulcus_types::StorageBackend;
