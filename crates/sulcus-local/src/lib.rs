//! Local sidecar for SULCUS.
//!
//! Implements a local PostgreSQL-backed `StorageBackend` (PGlite-compatible) and
//! provides the MCP-facing CLI glue. This crate contains the `LocalStorage` adapter
//! and tests.

pub mod config;
pub mod consolidation;
pub mod embeddings;
pub mod folds;
pub mod local_api;
pub mod manifest;
pub mod mcp;
pub mod metrics;
pub mod panel;
pub mod plugin;
pub mod progressive;
pub mod runtime;
pub mod storage;
pub mod telemetry;
pub mod thermodynamics;
pub mod tokenizer;
pub mod triggers;

pub use config::Config;
pub use consolidation::consolidate_hot_clusters;
pub use embeddings::{EmbeddingProvider, FastEmbedProvider, MockEmbeddingProvider};
pub use folds::{export_fold, import_fold};
pub use mcp::McpHandler;
pub use runtime::{
    initialize, reinitialize_local, serve, serve_stdio, serve_stdio_with_limits, serve_with_limits,
    shutdown_embedded_postgres, start_background,
};

pub use embeddings::embed_text;
pub use storage::LocalStorage;
pub use thermodynamics::{spawn_worker, tick};
pub use tokenizer::count_tokens;
