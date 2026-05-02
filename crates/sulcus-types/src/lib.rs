//! sulcus-types: Public types for the Sulcus reactive, thermodynamic memory engine.
//!
//! This crate contains all the data structures, traits, and algorithms needed to
//! build a standalone single-agent memory system. It is published under the MIT
//! license so anyone can build on top of Sulcus.
//!
//! # Modules
//!
//! - [`crdt`] — Hybrid Logical Clocks, LWW registers, NodePatch for field-level updates.
//! - [`graph`] — Node (memory entity) struct.
//! - [`mmu`] — Virtual Memory Management Unit: page fault handler, context budgeting.
//! - [`sync`] — Memory operation types, WAL compaction trait, sync engine trait.
//! - [`thermo`] — Thermodynamic decay engine: heat, half-lives, resonance, consolidation.
//! - [`zero_copy`] — rkyv-backed zero-copy index buffer for LLM context injection.

pub mod consolidation;
pub mod crdt;
pub mod folds;
pub mod graph;
pub mod math;
pub mod mmu;
pub mod sync;
pub mod thermo;
pub mod triggers;
pub mod zero_copy;

pub use crdt::{Hlc, LwwRegister, NodePatch};
pub use graph::Node;
pub use mmu::{Page, PageFaultHandler, PageTableEntry, PassthroughMmu, Space};
pub use sync::WalCompactor;
pub use thermo::{
    ActiveIndexConfig, ConsolidationConfig, ConsolidationStrategy, DecayClass, DecayProfile,
    ReinforcementConfig, ResonanceConfig, ThermoConfig, TickMode,
};
pub use zero_copy::{NodePointer, SharedIndexBuffer};

// ─── StorageBackend trait ────────────────────────────────────────────────────

/// Minimal async storage abstraction implemented by `LocalStorage` (backed by PostgreSQL / PGLite).
/// Defined here so other crates can depend on the trait without pulling in the full storage layer.
#[async_trait::async_trait]
pub trait StorageBackend: Send + Sync + 'static {
    async fn get_node(&self, id: uuid::Uuid) -> anyhow::Result<Option<Node>>;
    async fn upsert_node(&self, node: Node) -> anyhow::Result<()>;
    async fn list_hot_nodes(&self, limit: usize) -> anyhow::Result<Vec<Node>>;

    async fn record_memory_op(
        &self,
        op_type: &str,
        payload: &serde_json::Value,
    ) -> anyhow::Result<()>;
    async fn set_active_index(&self, node_id: uuid::Uuid, heat: f32) -> anyhow::Result<()>;
    async fn list_active_index(&self, limit: usize) -> anyhow::Result<Vec<(uuid::Uuid, f32)>>;

    async fn get_crdt_clocks(
        &self,
        node_id: uuid::Uuid,
    ) -> anyhow::Result<std::collections::HashMap<String, crate::crdt::Hlc>>;
    async fn set_crdt_clocks(
        &self,
        node_id: uuid::Uuid,
        clocks: &std::collections::HashMap<String, crate::crdt::Hlc>,
    ) -> anyhow::Result<()>;
}
