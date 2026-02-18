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
