//! sulcus-core: vMMU domain models (Spaces, Pages, PageTables).
//!
//! Architectural shift: we separate Physical partitions (Spaces) from Virtual session
//! state (PageTables). Pages are immutable; session-local `PageTableEntry` records
//! maintain token-bounded attention windows for agents.
//!
//! # Zero-copy memory transfers
//!
//! Memory pages are provisioned into a [`zero_copy::SharedIndexBuffer`] backed by
//! rkyv-encoded bytes (and optionally a file-backed mmap). An LLM runtime reads the
//! active index with **zero deserialization overhead** — the archived bytes ARE the
//! data.
//!
//! # State-based CRDTs
//!
//! [`crdt::NodePatch`] implements Last-Writer-Wins registers at the entity level.
//! When an agent learns a new fact it emits a surgical patch that targets only the
//! changed fields, keeping sync payloads tiny.  No text-level CRDTs (Automerge etc.)
//! are used.

pub mod crdt;
pub mod graph;
pub mod mmu;
pub mod sync;
pub mod zero_copy;

pub use crdt::{Hlc, LwwRegister, NodePatch};
pub use graph::Node;
pub use mmu::{Page, PageFaultHandler, PageTableEntry, PassthroughMmu, Space};
pub use sync::WalCompactor;
pub use zero_copy::{NodePointer, SharedIndexBuffer};

// ─── StorageBackend trait ────────────────────────────────────────────────────

/// Minimal async storage abstraction implemented by `LocalStorage` (backed by PostgreSQL / PGLite).
/// Defined here in core so other crates can depend on the trait without
/// pulling in the full local crate.
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
