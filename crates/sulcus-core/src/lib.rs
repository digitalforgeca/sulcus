//! sulcus-core: vMMU domain models (Spaces, Pages, PageTables).
//!
//! Architectural shift: we separate Physical partitions (Spaces) from Virtual session
//! state (PageTables). Thermodynamics, global mutable node-soup, and continuous WAL
//! sync have been removed in favor of immutable Pages + session-local PageEntries.

pub mod mmu;

pub use mmu::{Page, PageEntry, Space};
