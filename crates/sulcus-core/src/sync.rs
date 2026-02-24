use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::crdt::NodePatch;
use crate::graph::Node;

// ─── Op type ─────────────────────────────────────────────────────────────────

/// Operation kind for a MemoryOp (Add / Update / Delete / Patch).
///
/// `Patch` is the preferred variant for fact updates — it carries a sparse
/// [`NodePatch`] with only the mutated fields, making sync payloads tiny.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum OpType {
    Add,
    Update,
    /// Surgical LWW-register patch — preferred over `Update` for field-level changes.
    Patch,
    Delete,
}

// ─── MemoryOp ────────────────────────────────────────────────────────────────

/// A single WAL-style memory operation exchanged between local and remote sync engines.
///
/// ## Zero-copy note
/// The wire format is serde-JSON (required by the MCP/HTTP transport layer).
/// In-process transfers use the [`crate::zero_copy::SharedIndexBuffer`] which
/// exposes rkyv-encoded bytes readable without any deserialization step.
///
/// ## CRDT note
/// When `patch` is `Some`, engines MUST apply it via LWW-register merge rather than
/// performing a full node overwrite. This makes concurrent fact updates from different
/// agents converge deterministically without coordination.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MemoryOp {
    pub op: OpType,
    /// Full node snapshot (Add / Update ops). Prefer `patch` for partial updates.
    pub payload: Option<Node>,
    /// Surgical LWW-register patch (Patch ops). Only the changed fields are present.
    /// When this is `Some`, engines apply each register field independently.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch: Option<NodePatch>,
    /// Heavy territory text (raw content). Optional — only on ops that carry payloads.
    pub raw_content: Option<String>,
    pub timestamp: DateTime<Utc>,
}

impl MemoryOp {
    /// Construct an `Add` op carrying the full node + optional raw content.
    pub fn add(node: Node, raw_content: Option<String>) -> Self {
        Self {
            op: OpType::Add,
            payload: Some(node),
            patch: None,
            raw_content,
            timestamp: Utc::now(),
        }
    }

    /// Construct a `Patch` op carrying a sparse [`NodePatch`].
    /// This is the preferred way to propagate fact updates between replicas.
    pub fn patch(patch: NodePatch) -> Self {
        Self {
            op: OpType::Patch,
            payload: None,
            patch: Some(patch),
            raw_content: None,
            timestamp: Utc::now(),
        }
    }

    /// Construct a `Delete` op for the node with the given id.
    pub fn delete(node_id: uuid::Uuid) -> Self {
        // Reuse payload slot for the id; only the id field matters on delete.
        let node = Node {
            id: node_id,
            label: String::new(),
            pointer_summary: String::new(),
            base_utility: 0.0,
            current_heat: 0.0,
            is_pinned: false,
            memory_type: String::new(),
        };
        // Reuse payload slot for the id; only the id field matters on delete.
        Self {
            op: OpType::Delete,
            payload: Some(node),
            patch: None,
            raw_content: None,
            timestamp: Utc::now(),
        }
    }
}

// ─── Sync results ─────────────────────────────────────────────────────────────

/// Result returned by a successful `push` to a SyncEngine.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncPushResult {
    pub new_cursor: Option<String>,
    pub new_cursor_seq: Option<i64>,
}

/// Result returned by a successful `pull` from a SyncEngine.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncPullResult {
    pub ops: Vec<MemoryOp>,
    pub new_cursor: Option<String>,
    pub new_cursor_seq: Option<i64>,
}

// ─── Op hash ──────────────────────────────────────────────────────────────────

/// Compute a stable, deterministic fingerprint for idempotent deduplication.
/// Deliberately excludes `timestamp` so the same logical op from different
/// clients (or with slightly different clocks) still deduplicates.
pub fn compute_op_hash(op: &MemoryOp) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{:?}", op.op));
    if let Some(ref p) = op.payload {
        if let Ok(s) = serde_json::to_string(p) {
            hasher.update(s.as_bytes());
        }
    } else {
        hasher.update(b"null");
    }
    // Include patch fingerprint when present
    if let Some(ref patch) = op.patch {
        hasher.update(patch.node_id.as_bytes());
        if let Some(ref r) = patch.pointer_summary {
            hasher.update(r.value.as_bytes());
        }
        if let Some(ref r) = patch.fold_result {
            hasher.update(r.value.as_bytes());
        }
    } else {
        hasher.update(b"no-patch");
    }
    if let Some(ref r) = op.raw_content {
        hasher.update(r.as_bytes());
    } else {
        hasher.update(b"null");
    }
    hex::encode(hasher.finalize())
}

// ─── Merge helpers ─────────────────────────────────────────────────────────

/// Apply a `MemoryOp` to a mutable `Node` using the appropriate strategy:
///
/// - `Add` / `Update`: full replace (new wins).
/// - `Patch`: LWW-register merge per field (converges without coordination).
/// - `Delete`: caller is responsible for removing the node from storage.
///
/// Returns `true` if the node was mutated.
pub fn apply_op_to_node(op: &MemoryOp, node: &mut Node) -> bool {
    match op.op {
        OpType::Add | OpType::Update => {
            if let Some(ref p) = op.payload {
                *node = p.clone();
                return true;
            }
            false
        }
        OpType::Patch => {
            if let Some(ref patch) = op.patch {
                return patch.apply_to(node);
            }
            false
        }
        OpType::Delete => false, // deletion handled by storage layer
    }
}

// ─── SyncEngine trait ─────────────────────────────────────────────────────────

/// Sync engine trait implemented by local and remote adapters
/// (HTTP, in-memory test doubles, etc.).
#[async_trait]
pub trait SyncEngine {
    async fn push(&self, ops: Vec<MemoryOp>) -> anyhow::Result<SyncPushResult>;
    async fn pull(&self, since: Option<DateTime<Utc>>) -> anyhow::Result<SyncPullResult>;
}

// ─── WalCompactor trait ───────────────────────────────────────────────────────

/// Compacts the WAL (`memory_ops` table) by removing ops that have already
/// been confirmed as synced to the server.
///
/// The compaction horizon is the server cursor sequence number — any op whose
/// `seq <= horizon` and whose `status = 'synced'` is safe to discard.
///
/// Implementations live in `sulcus-local` (`LocalStorage`) and `sulcus-server`.
/// The trait lives here in `sulcus-core` so higher-level crates can depend on
/// it without pulling in the full storage layer.
#[async_trait]
pub trait WalCompactor: Send + Sync {
    /// Delete all synced ops up to (and including) `up_to_seq`.
    /// Returns the number of rows removed.
    async fn compact(&self, up_to_seq: i64) -> anyhow::Result<u64>;

    /// Return the current compaction horizon — the highest seq that is safe
    /// to compact (i.e. the last confirmed server cursor sequence).
    async fn compaction_horizon(&self) -> anyhow::Result<i64>;
}
