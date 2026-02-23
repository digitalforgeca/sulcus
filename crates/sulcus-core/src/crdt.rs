//! State-based CRDT primitives — Last-Writer-Wins Registers at the entity level.
//!
//! # Design
//!
//! We deliberately do NOT use text-level CRDTs (Automerge, etc.) for raw conversation
//! logs. Instead we operate at **Memory Page / Entity** granularity:
//!
//! - Each mutable field of a `Node` is wrapped in a `LwwRegister<T>`.
//! - When an agent learns a new fact it produces a `NodePatch` that surgically targets
//!   only the mutated fields — keeping sync payloads tiny.
//! - Conflict resolution is deterministic: the register with the higher `Hlc` wins.
//!   Ties are broken first by logical counter, then by actor id (lexicographic).
//!
//! # Why state-based?
//!
//! Op-based CRDTs require causal delivery guarantees that are hard to enforce over
//! unreliable P2P channels. State-based LWW registers are idempotent and commutative
//! by construction — any replica can be merged with any other in any order.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;

// ─── Hybrid Logical Clock ────────────────────────────────────────────────────

/// Hybrid Logical Clock timestamp.
///
/// Wall-clock seconds dominate (tolerable skew < 1 s because we use i64 seconds).
/// When two events share the same wall second the `logical` counter breaks the tie.
/// When two actors still tie, their `actor` bytes (big-endian node id prefix) resolve.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hlc {
    /// Unix timestamp in seconds (wall clock).
    pub wall: i64,
    /// Monotonic sequence counter within the same wall second.
    pub logical: u32,
    /// Stable 8-byte actor identifier (e.g. first 8 bytes of the node/agent UUID).
    pub actor: [u8; 8],
}

impl Hlc {
    /// Construct an HLC from the current system time with a given actor id.
    pub fn now(actor: [u8; 8]) -> Self {
        let wall = chrono::Utc::now().timestamp();
        Self {
            wall,
            logical: 0,
            actor,
        }
    }

    /// Advance the logical counter (call when two events occur within the same second).
    #[must_use]
    pub fn advance(self) -> Self {
        Self {
            logical: self.logical.saturating_add(1),
            ..self
        }
    }

    /// Return an HLC that is guaranteed to be strictly after `other`.
    #[must_use]
    pub fn tick_after(self, other: Self) -> Self {
        let wall = self.wall.max(other.wall);
        let logical = if wall == other.wall {
            other.logical.saturating_add(1)
        } else {
            0
        };
        Self {
            wall,
            logical,
            actor: self.actor,
        }
    }
}

impl PartialOrd for Hlc {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Hlc {
    fn cmp(&self, other: &Self) -> Ordering {
        self.wall
            .cmp(&other.wall)
            .then(self.logical.cmp(&other.logical))
            .then(self.actor.cmp(&other.actor))
    }
}

// ─── LWW Register ────────────────────────────────────────────────────────────

/// Last-Writer-Wins Register.
///
/// Carries a typed value plus the clock at which it was written. Concurrently
/// updated registers converge by keeping the value with the higher `Hlc`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LwwRegister<T: Clone> {
    pub value: T,
    pub clock: Hlc,
}

impl<T: Clone> LwwRegister<T> {
    pub fn new(value: T, clock: Hlc) -> Self {
        Self { value, clock }
    }

    /// Merge `other` into `self`. Returns `true` if `self` was updated.
    /// In case of equal clocks the existing value is kept (stable tie-break).
    pub fn merge(&mut self, other: &LwwRegister<T>) -> bool {
        if other.clock > self.clock {
            self.value = other.value.clone();
            self.clock = other.clock;
            true
        } else {
            false
        }
    }
}

// ─── Node Patch ──────────────────────────────────────────────────────────────

/// A sparse, surgical patch for a single `Node` entity.
///
/// Only the fields that actually changed are present. When an agent learns a new
/// fact (e.g. "user prefers dark mode"), it emits a `NodePatch` that contains
/// only the updated `pointer_summary` — the other fields are left `None`.
///
/// Patches propagate to remote replicas via the sync WAL. On receipt, each
/// register field is merged independently using `LwwRegister::merge`, so
/// concurrent patches from different agents automatically converge without
/// coordination.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NodePatch {
    /// The node being patched.
    pub node_id: uuid::Uuid,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<LwwRegister<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pointer_summary: Option<LwwRegister<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_utility: Option<LwwRegister<f32>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_pinned: Option<LwwRegister<bool>>,

    /// Carries the result of an async fold: a dense, condensed summary that
    /// replaces the verbose raw content. Raw content moves to cold storage;
    /// only this dense form remains in the warm cache.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fold_result: Option<LwwRegister<String>>,
}

impl NodePatch {
    pub fn new(node_id: uuid::Uuid) -> Self {
        Self {
            node_id,
            label: None,
            pointer_summary: None,
            base_utility: None,
            is_pinned: None,
            fold_result: None,
        }
    }

    pub fn with_label(mut self, value: impl Into<String>, clock: Hlc) -> Self {
        self.label = Some(LwwRegister::new(value.into(), clock));
        self
    }

    pub fn with_summary(mut self, value: impl Into<String>, clock: Hlc) -> Self {
        self.pointer_summary = Some(LwwRegister::new(value.into(), clock));
        self
    }

    pub fn with_utility(mut self, value: f32, clock: Hlc) -> Self {
        self.base_utility = Some(LwwRegister::new(value, clock));
        self
    }

    pub fn with_pinned(mut self, value: bool, clock: Hlc) -> Self {
        self.is_pinned = Some(LwwRegister::new(value, clock));
        self
    }

    pub fn with_fold_result(mut self, dense_summary: impl Into<String>, clock: Hlc) -> Self {
        self.fold_result = Some(LwwRegister::new(dense_summary.into(), clock));
        self
    }

    /// Apply patch fields to a `Node`. Returns `true` if any field was updated.
    /// `fold_result` (if set) replaces `pointer_summary` — the dense fold wins.
    pub fn apply_to(&self, node: &mut crate::graph::Node) -> bool {
        let mut changed = false;
        if let Some(ref r) = self.label {
            node.label = r.value.clone();
            changed = true;
        }
        if let Some(ref r) = self.pointer_summary {
            node.pointer_summary = r.value.clone();
            changed = true;
        }
        if let Some(ref r) = self.base_utility {
            node.base_utility = r.value;
            changed = true;
        }
        if let Some(ref r) = self.is_pinned {
            node.is_pinned = r.value;
            changed = true;
        }
        // fold_result supersedes pointer_summary; dense fold replaces verbose summary
        if let Some(ref r) = self.fold_result {
            node.pointer_summary = r.value.clone();
            changed = true;
        }
        changed
    }

    /// Clock-aware apply: only write a field if the incoming patch's `Hlc` is
    /// strictly newer than the stored clock for that field.
    ///
    /// `stored_clocks` is a per-field clock map persisted in the `crdt_clocks`
    /// DB column (keyed by field name: `"label"`, `"pointer_summary"`, etc.).
    /// After the call, `stored_clocks` is updated in-place so the caller can
    /// flush it back to the database.
    ///
    /// This is the correct entry-point for sync applies — use plain `apply_to`
    /// only for local in-process mutations where no concurrent writers exist.
    pub fn apply_to_with_clocks(
        &self,
        node: &mut crate::graph::Node,
        stored_clocks: &mut HashMap<String, Hlc>,
    ) -> bool {
        let mut changed = false;

        macro_rules! apply_field {
            ($register:expr, $field:expr, $key:expr) => {
                if let Some(ref r) = $register {
                    let stored = stored_clocks.get($key).copied();
                    let incoming_wins = match stored {
                        Some(sc) => r.clock > sc,
                        None => true, // no stored clock → always accept
                    };
                    if incoming_wins {
                        $field = r.value.clone();
                        stored_clocks.insert($key.to_string(), r.clock);
                        changed = true;
                    }
                }
            };
        }

        apply_field!(self.label, node.label, "label");
        apply_field!(
            self.pointer_summary,
            node.pointer_summary,
            "pointer_summary"
        );

        if let Some(ref r) = self.base_utility {
            let stored = stored_clocks.get("base_utility").copied();
            let wins = stored.map_or(true, |sc| r.clock > sc);
            if wins {
                node.base_utility = r.value;
                stored_clocks.insert("base_utility".to_string(), r.clock);
                changed = true;
            }
        }
        if let Some(ref r) = self.is_pinned {
            let stored = stored_clocks.get("is_pinned").copied();
            let wins = stored.map_or(true, |sc| r.clock > sc);
            if wins {
                node.is_pinned = r.value;
                stored_clocks.insert("is_pinned".to_string(), r.clock);
                changed = true;
            }
        }
        // fold_result supersedes pointer_summary
        if let Some(ref r) = self.fold_result {
            let stored = stored_clocks.get("fold_result").copied();
            let wins = stored.map_or(true, |sc| r.clock > sc);
            if wins {
                node.pointer_summary = r.value.clone();
                stored_clocks.insert("fold_result".to_string(), r.clock);
                changed = true;
            }
        }
        changed
    }

    /// Merge another patch's registers into this one (keeps higher-clock values).
    /// After merging, `self` is the CRDT join (⊔) of both patches.
    pub fn merge_from(&mut self, other: &NodePatch) {
        merge_register_field(&mut self.label, &other.label);
        merge_register_field(&mut self.pointer_summary, &other.pointer_summary);
        merge_register_field(&mut self.base_utility, &other.base_utility);
        merge_register_field(&mut self.is_pinned, &other.is_pinned);
        merge_register_field(&mut self.fold_result, &other.fold_result);
    }

    /// Returns `true` if no fields are set (patch carries no changes).
    pub fn is_empty(&self) -> bool {
        self.label.is_none()
            && self.pointer_summary.is_none()
            && self.base_utility.is_none()
            && self.is_pinned.is_none()
            && self.fold_result.is_none()
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn merge_register_field<T: Clone>(dest: &mut Option<LwwRegister<T>>, src: &Option<LwwRegister<T>>) {
    if let Some(ref o) = src {
        match dest {
            Some(ref mut s) => {
                s.merge(o);
            }
            None => *dest = Some(o.clone()),
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn actor(n: u8) -> [u8; 8] {
        [n; 8]
    }

    #[test]
    fn hlc_ordering() {
        let a = Hlc::now(actor(1));
        let b = a.advance();
        assert!(b > a);

        let c = Hlc {
            wall: a.wall + 1,
            logical: 0,
            actor: actor(1),
        };
        assert!(c > b);
    }

    #[test]
    fn lww_merge_keeps_later_clock() {
        let mut r1: LwwRegister<&str> = LwwRegister::new("old", Hlc::now(actor(1)));
        let r2 = LwwRegister::new("new", r1.clock.advance());
        assert!(r1.merge(&r2));
        assert_eq!(r1.value, "new");
    }

    #[test]
    fn lww_merge_keeps_self_when_same_clock() {
        let clock = Hlc::now(actor(1));
        let mut r1 = LwwRegister::new("a", clock);
        let r2 = LwwRegister::new("b", clock);
        assert!(!r1.merge(&r2));
        assert_eq!(r1.value, "a");
    }

    #[test]
    fn node_patch_merge() {
        let id = uuid::Uuid::now_v7();
        let t1 = Hlc::now(actor(1));
        let t2 = t1.advance();

        let mut p1 = NodePatch::new(id)
            .with_label("v1-label", t1)
            .with_summary("v1-summary", t1);

        let p2 = NodePatch::new(id)
            .with_summary("v2-summary", t2) // later clock → wins
            .with_utility(0.8, t1);

        p1.merge_from(&p2);

        assert_eq!(p1.label.as_ref().unwrap().value, "v1-label"); // unchanged
        assert_eq!(p1.pointer_summary.as_ref().unwrap().value, "v2-summary"); // updated
        assert!((p1.base_utility.as_ref().unwrap().value - 0.8).abs() < 1e-6);
    }

    #[test]
    fn node_patch_apply_fold_result() {
        let id = uuid::Uuid::now_v7();
        let mut node = crate::graph::Node {
            id,
            label: "raw".to_string(),
            pointer_summary: "verbose log...".to_string(),
            base_utility: 0.0,
            current_heat: 0.3,
            is_pinned: false,
            memory_type: "episodic".to_string(),
        };
        let clock = Hlc::now(actor(2));
        let patch = NodePatch::new(id).with_fold_result("dense semantic summary", clock);

        assert!(patch.apply_to(&mut node));
        assert_eq!(node.pointer_summary, "dense semantic summary");
    }
}
