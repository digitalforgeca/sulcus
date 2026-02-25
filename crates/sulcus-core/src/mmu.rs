// vMMU models — token-aware, session-scoped Page Tables.
//
// Models are intentionally minimal and serde-friendly for DB mapping and MCP I/O.
// UUID generation uses v7 timestamps to improve sortability in the DB.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A physical namespace that can be mounted by agents.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Space {
    pub id: Uuid,
    pub name: String,
}

impl Space {
    /// Create a new `Space` with a UUID v7 id.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: Uuid::now_v7(),
            name: name.into(),
        }
    }

    /// Construct with explicit id (useful for DB hydration).
    pub fn with_id(id: Uuid, name: impl Into<String>) -> Self {
        Self {
            id,
            name: name.into(),
        }
    }
}

/// Immutable chunk of territory stored in a `Space`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Page {
    pub id: Uuid,
    pub space_id: Uuid,
    pub content: String,
    /// Approximate token count for this `content` (token-bounded paging).
    pub token_count: usize,
}

impl Page {
    /// Create a new `Page` with an explicit token count. IDs use UUID v7.
    pub fn new(space_id: Uuid, content: impl Into<String>, token_count: usize) -> Self {
        Self {
            id: Uuid::now_v7(),
            space_id,
            content: content.into(),
            token_count,
        }
    }

    /// Hydrate a `Page` from DB with an explicit id.
    pub fn with_id(
        id: Uuid,
        space_id: Uuid,
        content: impl Into<String>,
        token_count: usize,
    ) -> Self {
        Self {
            id,
            space_id,
            content: content.into(),
            token_count,
        }
    }
}

/// Session-scoped Page Table entry (virtual memory mapping / attention record).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageTableEntry {
    pub session_id: Uuid,
    pub page_id: Uuid,
    /// 0.0 ..= 1.0 (higher == hotter)
    pub heat: f32,
    /// i64 unix timestamp (seconds)
    pub accessed_at: i64,
}

impl PageTableEntry {
    /// Start hot by default.
    pub fn new(session_id: Uuid, page_id: Uuid) -> Self {
        Self {
            session_id,
            page_id,
            heat: 1.0_f32,
            accessed_at: Utc::now().timestamp(),
        }
    }

    /// Bump heat (clamped) and refresh access time.
    pub fn bump(&mut self, delta: f32) {
        self.heat = (self.heat + delta).clamp(0.0, 1.0);
        self.accessed_at = Utc::now().timestamp();
    }

    /// Touch without changing heat.
    pub fn touch(&mut self) {
        self.accessed_at = Utc::now().timestamp();
    }
}

// ─── Page Fault Hook ────────────────────────────────────────────────────────

/// Trait invoked by the thermodynamics engine when a cold node is accessed
/// ("page fault") or evicted from the active context window.
///
/// Implementations decide whether to restore the node from cold_storage
/// (`on_page_fault`) or archive it (`on_eviction`).
///
/// # Example
///
/// ```rust
/// // In sulcus-local the concrete LocalStorage implements this trait so that
/// // the thermodynamics engine can page nodes in/out without knowing about SQL.
/// ```
#[async_trait::async_trait]
pub trait PageFaultHandler: Send + Sync {
    /// Called when a cold node is accessed and must be paged back into the
    /// active context window.  Return `Ok(Some(node))` if the node was found
    /// in cold storage, `Ok(None)` to signal a hard miss.
    async fn on_page_fault(
        &self,
        node_id: uuid::Uuid,
    ) -> anyhow::Result<Option<crate::graph::Node>>;

    /// Called when the LRU eviction loop marks a node as cold.  Implementations
    /// should archive the payload and update tombstone metadata.
    async fn on_eviction(&self, node_id: uuid::Uuid, final_heat: f32) -> anyhow::Result<()>;
}

/// No-op `PageFaultHandler` — always reports a hard miss and ignores evictions.
/// Useful in test doubles, benchmarks, or build targets that do not require
/// real cold storage (e.g. WASM).
pub struct PassthroughMmu;

#[async_trait::async_trait]
impl PageFaultHandler for PassthroughMmu {
    async fn on_page_fault(
        &self,
        _node_id: uuid::Uuid,
    ) -> anyhow::Result<Option<crate::graph::Node>> {
        Ok(None)
    }

    async fn on_eviction(&self, _node_id: uuid::Uuid, _final_heat: f32) -> anyhow::Result<()> {
        Ok(())
    }
}

// ─── Context budget packer ────────────────────────────────────────────────────

/// Character-budget configuration for context assembly.
///
/// Designed for small CPU models (e.g. 4 k-token local LLMs) that cannot
/// absorb a full knowledge-graph dump. The packer fits the hottest nodes into
/// `max_chars`, subtracting a fixed reservation for the tool directory injected
/// by the OpenClaw skill layer.
///
/// # Defaults
/// A 4 k-token model with ~4 chars/token allows ≈ 16 000 raw chars.  We set
/// `max_chars = 12_000` as a conservative safe limit and reserve `800` chars
/// for the tool directory, giving `11_200` chars of usable node content.
#[derive(Debug, Clone)]
pub struct ContextBudget {
    /// Total character allowance for the assembled context block.
    pub max_chars: usize,
    /// Characters reserved for the tool directory injected by the caller.
    /// Subtracted from `max_chars` before node content is packed.
    pub tool_directory_chars: usize,
    /// Upper bound on the number of nodes to include, regardless of budget.
    pub max_nodes: usize,
}

impl Default for ContextBudget {
    fn default() -> Self {
        Self {
            max_chars: 12_000,
            tool_directory_chars: 800,
            max_nodes: 20,
        }
    }
}

impl ContextBudget {
    /// Characters available for node payloads after subtracting the tool reservation.
    #[inline]
    pub fn content_budget(&self) -> usize {
        self.max_chars.saturating_sub(self.tool_directory_chars)
    }
}

/// A single node entry returned by `pack_context`, trimmed to fit within the budget.
#[derive(Debug, Clone)]
pub struct PagedNode {
    pub id: Uuid,
    pub heat: f32,
    /// Content, possibly truncated to honour the per-node char limit.
    pub content: String,
    /// `true` when `content` was hard-truncated from the original payload.
    pub truncated: bool,
}

/// Pack the hottest nodes into a context string bounded by `budget`.
///
/// Nodes are consumed in the order provided (caller should sort by heat desc).
/// Each node's payload is hard-trimmed at `content_budget / max_nodes` chars
/// to prevent a single large node from evicting all others.
///
/// This is a pure function — no I/O, no SQL. It is called by the MCP
/// `build_context` handler after fetching sorted node rows from the DB.
///
/// # Arguments
/// * `nodes` – `(uuid, heat, payload)` tuples, hottest first.
/// * `budget` – char limits for this call.
pub fn pack_context(nodes: &[(Uuid, f32, String)], budget: &ContextBudget) -> Vec<PagedNode> {
    let content_budget = budget.content_budget();
    // Per-node ceiling: divide evenly so no single node dominates.
    let per_node_max = if budget.max_nodes > 0 {
        content_budget / budget.max_nodes
    } else {
        content_budget
    };

    let mut remaining = content_budget;
    let mut out = Vec::with_capacity(budget.max_nodes.min(nodes.len()));

    for (id, heat, payload) in nodes.iter().take(budget.max_nodes) {
        if remaining == 0 {
            break;
        }
        let limit = per_node_max.min(remaining);
        let (content, truncated) = if payload.len() > limit {
            (payload[..limit].to_string(), true)
        } else {
            (payload.clone(), false)
        };
        remaining = remaining.saturating_sub(content.len());
        out.push(PagedNode {
            id: *id,
            heat: *heat,
            content,
            truncated,
        });
    }

    out
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_budget_content_budget_subtracts_tool_reservation() {
        let b = ContextBudget {
            max_chars: 12_000,
            tool_directory_chars: 800,
            max_nodes: 20,
        };
        assert_eq!(b.content_budget(), 11_200);
    }

    #[test]
    fn context_budget_default_is_safe_for_4k_model() {
        let b = ContextBudget::default();
        assert_eq!(b.max_chars, 12_000);
        assert_eq!(b.content_budget(), 11_200);
    }

    #[test]
    fn pack_context_total_chars_fits_content_budget() {
        let budget = ContextBudget {
            max_chars: 1_000,
            tool_directory_chars: 0,
            max_nodes: 5,
        };
        // 10 nodes each with 300-char payloads — total would be 3 000 without truncation.
        let nodes: Vec<(Uuid, f32, String)> = (0..10u128)
            .map(|i| (Uuid::from_u128(i), 1.0 - i as f32 * 0.05, "x".repeat(300)))
            .collect();
        let paged = pack_context(&nodes, &budget);
        let total: usize = paged.iter().map(|n| n.content.len()).sum();
        assert!(total <= 1_000, "total={total} exceeds budget of 1000");
        assert!(!paged.is_empty(), "should return at least one node");
    }

    #[test]
    fn pack_context_truncates_single_fat_node() {
        let budget = ContextBudget {
            max_chars: 500,
            tool_directory_chars: 0,
            max_nodes: 1,
        };
        let nodes = vec![(Uuid::from_u128(1), 1.0_f32, "y".repeat(2_000))];
        let paged = pack_context(&nodes, &budget);
        assert_eq!(paged.len(), 1);
        assert!(
            paged[0].truncated,
            "single fat node must be flagged truncated"
        );
        assert!(paged[0].content.len() <= 500, "content exceeded budget");
    }

    #[test]
    fn pack_context_empty_nodes_returns_empty() {
        let budget = ContextBudget::default();
        let paged = pack_context(&[], &budget);
        assert!(paged.is_empty());
    }

    #[test]
    fn pack_context_respects_max_nodes_cap() {
        let budget = ContextBudget {
            max_chars: 100_000,
            tool_directory_chars: 0,
            max_nodes: 3,
        };
        let nodes: Vec<(Uuid, f32, String)> = (0..10u128)
            .map(|i| (Uuid::from_u128(i), 1.0, "Z".repeat(100)))
            .collect();
        let paged = pack_context(&nodes, &budget);
        assert_eq!(paged.len(), 3, "should cap at max_nodes=3");
    }
}
