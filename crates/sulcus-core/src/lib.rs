//! sulcus-core: vMMU domain models (Spaces, Pages, PageTables).
//!
//! Architectural shift: we separate Physical partitions (Spaces) from Virtual session
//! state (PageTables). Pages are immutable; session-local `PageTableEntry` records
//! maintain token-bounded attention windows for agents.

pub mod mmu;

pub use mmu::{Page, PageTableEntry, Space};
