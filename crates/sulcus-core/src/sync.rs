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
    /// Vector embedding for the node (optional).
    pub vector: Option<Vec<f32>>,
    pub timestamp: DateTime<Utc>,
}

impl MemoryOp {
    /// Construct an `Add` op carrying the full node + optional raw content and vector.
    pub fn add(node: Node, raw_content: Option<String>, vector: Option<Vec<f32>>) -> Self {
        Self {
            op: OpType::Add,
            payload: Some(node),
            patch: None,
            raw_content,
            vector,
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
            vector: None,
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
            modality: Node::default_modality(),
            source_mime: None,
            namespace: Node::default_namespace(),
        };
        Self {
            op: OpType::Delete,
            payload: Some(node),
            patch: None,
            raw_content: None,
            vector: None,
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
        if let Some(ref r) = patch.label {
            hasher.update(r.value.as_bytes());
            hasher.update(r.clock.wall.to_le_bytes());
            hasher.update(r.clock.logical.to_le_bytes());
            hasher.update(r.clock.actor);
        }
        if let Some(ref r) = patch.pointer_summary {
            hasher.update(r.value.as_bytes());
            hasher.update(r.clock.wall.to_le_bytes());
            hasher.update(r.clock.logical.to_le_bytes());
            hasher.update(r.clock.actor);
        }
        if let Some(ref r) = patch.base_utility {
            hasher.update(r.value.to_le_bytes());
            hasher.update(r.clock.wall.to_le_bytes());
            hasher.update(r.clock.logical.to_le_bytes());
            hasher.update(r.clock.actor);
        }
        if let Some(ref r) = patch.is_pinned {
            hasher.update([r.value as u8]);
            hasher.update(r.clock.wall.to_le_bytes());
            hasher.update(r.clock.logical.to_le_bytes());
            hasher.update(r.clock.actor);
        }
        if let Some(ref r) = patch.fold_result {
            hasher.update(r.value.as_bytes());
            hasher.update(r.clock.wall.to_le_bytes());
            hasher.update(r.clock.logical.to_le_bytes());
            hasher.update(r.clock.actor);
        }
    } else {
        hasher.update(b"no-patch");
    }
    if let Some(ref r) = op.raw_content {
        hasher.update(r.as_bytes());
    } else {
        hasher.update(b"null");
    }
    if let Some(ref v) = op.vector {
        for f in v {
            hasher.update(f.to_le_bytes());
        }
    } else {
        hasher.update(b"no-vec");
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
pub fn apply_op_to_node(op: &MemoryOp, node: &mut Node, clocks: &mut std::collections::HashMap<String, crate::crdt::Hlc>) -> bool {
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
                return patch.apply_to_with_clocks(node, clocks);
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
pub trait SyncEngine: Send + Sync {
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

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crdt::{Hlc, NodePatch};
    use crate::graph::Node;
    use std::collections::HashMap;

    fn test_actor_a() -> [u8; 8] {
        [0xAA; 8]
    }

    fn test_actor_b() -> [u8; 8] {
        [0xBB; 8]
    }

    fn test_node(id: uuid::Uuid) -> Node {
        Node {
            id,
            label: "test-label".to_string(),
            pointer_summary: "test-summary".to_string(),
            base_utility: 0.5,
            current_heat: 0.3,
            is_pinned: false,
            memory_type: "episodic".to_string(),
            modality: Node::default_modality(),
            source_mime: None,
            namespace: Node::default_namespace(),
        }
    }

    // ── Constructor tests ────────────────────────────────────────────────

    #[test]
    fn add_op_carries_full_payload() {
        let id = uuid::Uuid::new_v4();
        let node = test_node(id);
        let op = MemoryOp::add(node.clone(), Some("raw".into()), Some(vec![1.0, 2.0]));

        assert_eq!(op.op, OpType::Add);
        assert_eq!(op.payload.as_ref().unwrap().id, id);
        assert_eq!(op.raw_content.as_deref(), Some("raw"));
        assert_eq!(op.vector.as_deref(), Some(&[1.0, 2.0][..]));
        assert!(op.patch.is_none());
    }

    #[test]
    fn patch_op_carries_sparse_patch() {
        let id = uuid::Uuid::new_v4();
        let clock = Hlc { wall: 100, logical: 0, actor: test_actor_a() };
        let patch = NodePatch::new(id).with_label("new-label", clock);
        let op = MemoryOp::patch(patch.clone());

        assert_eq!(op.op, OpType::Patch);
        assert!(op.payload.is_none());
        assert!(op.raw_content.is_none());
        assert!(op.vector.is_none());
        assert_eq!(op.patch.as_ref().unwrap().node_id, id);
        assert_eq!(op.patch.as_ref().unwrap().label.as_ref().unwrap().value, "new-label");
    }

    #[test]
    fn delete_op_carries_node_id_only() {
        let id = uuid::Uuid::new_v4();
        let op = MemoryOp::delete(id);

        assert_eq!(op.op, OpType::Delete);
        assert_eq!(op.payload.as_ref().unwrap().id, id);
        assert!(op.patch.is_none());
        assert!(op.raw_content.is_none());
        assert!(op.vector.is_none());
        // The payload node should be a skeleton — label is empty
        assert!(op.payload.as_ref().unwrap().label.is_empty());
    }

    // ── Hash determinism tests ───────────────────────────────────────────

    #[test]
    fn op_hash_is_deterministic() {
        let id = uuid::Uuid::new_v4();
        let node = test_node(id);
        let mut op = MemoryOp::add(node, Some("content".into()), Some(vec![0.1, 0.2]));
        // Fix the timestamp so it doesn't affect reproducibility
        op.timestamp = chrono::DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let h1 = compute_op_hash(&op);
        let h2 = compute_op_hash(&op);
        assert_eq!(h1, h2, "same op should always produce the same hash");
    }

    #[test]
    fn op_hash_excludes_timestamp() {
        let id = uuid::Uuid::new_v4();
        let node = test_node(id);

        let mut op1 = MemoryOp::add(node.clone(), None, None);
        op1.timestamp = chrono::DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let mut op2 = MemoryOp::add(node, None, None);
        op2.timestamp = chrono::DateTime::parse_from_rfc3339("2026-06-15T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        assert_eq!(
            compute_op_hash(&op1),
            compute_op_hash(&op2),
            "ops differing only in timestamp should have the same hash (idempotent dedup)"
        );
    }

    #[test]
    fn op_hash_differs_by_op_type() {
        let id = uuid::Uuid::new_v4();
        let node = test_node(id);

        let mut add = MemoryOp::add(node.clone(), None, None);
        add.timestamp = Utc::now();
        let mut del = MemoryOp::delete(id);
        del.timestamp = add.timestamp;

        assert_ne!(
            compute_op_hash(&add),
            compute_op_hash(&del),
            "Add and Delete for the same node must produce different hashes"
        );
    }

    #[test]
    fn op_hash_differs_by_raw_content() {
        let id = uuid::Uuid::new_v4();
        let node = test_node(id);

        let mut op1 = MemoryOp::add(node.clone(), Some("alpha".into()), None);
        let mut op2 = MemoryOp::add(node, Some("beta".into()), None);
        op1.timestamp = Utc::now();
        op2.timestamp = op1.timestamp;

        assert_ne!(
            compute_op_hash(&op1),
            compute_op_hash(&op2),
            "different raw_content should produce different hashes"
        );
    }

    #[test]
    fn op_hash_differs_by_vector() {
        let id = uuid::Uuid::new_v4();
        let node = test_node(id);

        let mut op1 = MemoryOp::add(node.clone(), None, Some(vec![1.0, 0.0]));
        let mut op2 = MemoryOp::add(node, None, Some(vec![0.0, 1.0]));
        op1.timestamp = Utc::now();
        op2.timestamp = op1.timestamp;

        assert_ne!(
            compute_op_hash(&op1),
            compute_op_hash(&op2),
            "different vectors should produce different hashes"
        );
    }

    #[test]
    fn op_hash_for_patch_includes_patch_fields() {
        let id = uuid::Uuid::new_v4();
        let clock = Hlc { wall: 100, logical: 0, actor: test_actor_a() };

        let patch1 = NodePatch::new(id).with_label("label-a", clock);
        let patch2 = NodePatch::new(id).with_label("label-b", clock);

        let mut op1 = MemoryOp::patch(patch1);
        let mut op2 = MemoryOp::patch(patch2);
        op1.timestamp = Utc::now();
        op2.timestamp = op1.timestamp;

        assert_ne!(
            compute_op_hash(&op1),
            compute_op_hash(&op2),
            "patches with different labels must produce different hashes"
        );
    }

    // ── apply_op_to_node tests ───────────────────────────────────────────

    #[test]
    fn apply_add_replaces_node_entirely() {
        let id = uuid::Uuid::new_v4();
        let mut node = test_node(id);
        let replacement = Node {
            id,
            label: "replaced".to_string(),
            pointer_summary: "new-summary".to_string(),
            base_utility: 0.9,
            current_heat: 0.0,
            is_pinned: true,
            memory_type: "semantic".to_string(),
            modality: "image".to_string(),
            source_mime: Some("image/png".to_string()),
            namespace: "project-x".to_string(),
        };
        let op = MemoryOp::add(replacement.clone(), None, None);
        let mut clocks = HashMap::new();

        let changed = apply_op_to_node(&op, &mut node, &mut clocks);

        assert!(changed);
        assert_eq!(node.label, "replaced");
        assert_eq!(node.pointer_summary, "new-summary");
        assert_eq!(node.base_utility, 0.9);
        assert!(node.is_pinned);
    }

    #[test]
    fn apply_patch_only_changes_targeted_fields() {
        let id = uuid::Uuid::new_v4();
        let mut node = test_node(id);
        let original_label = node.label.clone();

        let clock = Hlc { wall: 200, logical: 0, actor: test_actor_a() };
        let patch = NodePatch::new(id).with_summary("patched-summary", clock);
        let op = MemoryOp::patch(patch);
        let mut clocks = HashMap::new();

        let changed = apply_op_to_node(&op, &mut node, &mut clocks);

        assert!(changed);
        assert_eq!(node.pointer_summary, "patched-summary");
        assert_eq!(node.label, original_label, "label should be untouched by patch");
    }

    #[test]
    fn apply_delete_does_not_mutate_node() {
        let id = uuid::Uuid::new_v4();
        let mut node = test_node(id);
        let snapshot = node.clone();
        let op = MemoryOp::delete(id);
        let mut clocks = HashMap::new();

        let changed = apply_op_to_node(&op, &mut node, &mut clocks);

        assert!(!changed, "delete op should not mutate the node (caller handles removal)");
        assert_eq!(node, snapshot);
    }

    #[test]
    fn apply_op_with_no_payload_is_noop() {
        let id = uuid::Uuid::new_v4();
        let mut node = test_node(id);
        let snapshot = node.clone();

        // Manually construct a broken Add op with no payload
        let op = MemoryOp {
            op: OpType::Add,
            payload: None,
            patch: None,
            raw_content: None,
            vector: None,
            timestamp: Utc::now(),
        };
        let mut clocks = HashMap::new();

        let changed = apply_op_to_node(&op, &mut node, &mut clocks);
        assert!(!changed);
        assert_eq!(node, snapshot);
    }

    #[test]
    fn apply_patch_respects_clock_ordering() {
        let id = uuid::Uuid::new_v4();
        let mut node = test_node(id);
        let mut clocks = HashMap::new();

        let clock_old = Hlc { wall: 100, logical: 0, actor: test_actor_a() };
        let clock_new = Hlc { wall: 200, logical: 0, actor: test_actor_b() };

        // Apply the newer patch first
        let patch_new = NodePatch::new(id).with_label("newer", clock_new);
        let op_new = MemoryOp::patch(patch_new);
        apply_op_to_node(&op_new, &mut node, &mut clocks);
        assert_eq!(node.label, "newer");

        // Now try to apply the older patch — it should be rejected
        let patch_old = NodePatch::new(id).with_label("older", clock_old);
        let op_old = MemoryOp::patch(patch_old);
        let changed = apply_op_to_node(&op_old, &mut node, &mut clocks);

        assert!(!changed, "stale patch should be rejected by clock comparison");
        assert_eq!(node.label, "newer", "newer value should survive stale patch");
    }

    // ── Serialization round-trip ─────────────────────────────────────────

    #[test]
    fn memory_op_serde_roundtrip() {
        let id = uuid::Uuid::new_v4();
        let node = test_node(id);
        let op = MemoryOp::add(node, Some("payload-text".into()), Some(vec![0.5]));

        let json = serde_json::to_string(&op).expect("serialize");
        let restored: MemoryOp = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(op, restored);
    }

    #[test]
    fn patch_op_omits_none_fields_in_json() {
        let id = uuid::Uuid::new_v4();
        let clock = Hlc { wall: 1, logical: 0, actor: test_actor_a() };
        let patch = NodePatch::new(id).with_label("only-label", clock);
        let op = MemoryOp::patch(patch);

        let json = serde_json::to_string(&op).expect("serialize");
        // All None fields on the patch should be skipped
        assert!(!json.contains("\"pointer_summary\""), "None fields should be omitted");
        assert!(!json.contains("\"fold_result\""), "None fields should be omitted");
        assert!(json.contains("\"label\""), "set field should be present");
    }
}
