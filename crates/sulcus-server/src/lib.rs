//! Minimal scaffold for `sulcus-server` agent endpoints (placeholder).

pub mod agent;

use axum::{middleware::from_fn, routing::post, Router};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub mod db;
pub mod middleware;

/// In-memory server state for the "Golden Index" (MVP implementation).
/// - `golden` stores the authoritative `Node` entries keyed by UUID.
/// - `ops` stores the append-only server WAL of `MemoryOp`s (used to answer pulls since a cursor).
///
/// IMPORTANT: this is intentionally NOT global; state is passed into the `Router` and scoped to
/// the application instance so tests and multiple instances remain isolated.
#[derive(Debug)]
pub struct AppState {
    pub golden: Mutex<HashMap<uuid::Uuid, sulcus_core::graph::Node>>,
    pub ops: Mutex<Vec<sulcus_core::sync::MemoryOp>>,
    /// Optional PgPool: when present the server persists WAL + golden index to Postgres.
    pub pg_pool: Option<sqlx::PgPool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            golden: Mutex::new(HashMap::new()),
            ops: Mutex::new(Vec::new()),
            pg_pool: None,
        }
    }

    pub fn new_with_pool(pool: sqlx::PgPool) -> Self {
        Self {
            golden: Mutex::new(HashMap::new()),
            ops: Mutex::new(Vec::new()),
            pg_pool: Some(pool),
        }
    }
}

pub type SharedState = Arc<AppState>;

/// Build a router wired to the provided `state` (useful for tests).
pub fn make_app_with_state(state: SharedState) -> Router<SharedState> {
    let api_routes = Router::new()
        .route("/api/v1/agent/sync", post(agent::handle_sync))
        .layer(from_fn(middleware::require_agent_api_key));

    Router::new().merge(api_routes).with_state(state)
}

/// Default application factory that creates an empty in-memory Golden Index.
pub fn make_app() -> Router<SharedState> {
    let state = Arc::new(AppState::new());
    make_app_with_state(state)
}
