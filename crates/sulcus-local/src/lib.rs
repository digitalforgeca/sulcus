//! Local sidecar for SULCUS.
//!
//! Implements a local SQLite-backed `StorageBackend` and provides the MCP-facing CLI glue
//! in later steps. This crate currently contains the `SqliteStorage` adapter and tests.

pub mod mcp;
pub mod runtime;
pub mod storage;
pub mod thermodynamics;

pub use mcp::McpHandler;
pub use runtime::{serve, start_background};

pub mod sync_http;
pub use storage::SqliteStorage;
pub use sync_http::HttpSyncEngine;
pub use thermodynamics::{spawn_worker, tick};

pub mod sync;
pub use sync::spawn_sync_worker;
pub use sync::LocalSyncClient;
