//! Local sidecar for SULCUS.
//!
//! Implements a local PostgreSQL-backed `StorageBackend` (PGlite-compatible) and
//! provides the MCP-facing CLI glue. This crate contains the `LocalStorage` adapter
//! (exported as `SqliteStorage` for backward compatibility) and tests.

pub mod config;
pub mod embeddings;
pub mod folds;
pub mod mcp;
pub mod metrics;
pub mod runtime;
pub mod storage;
pub mod thermodynamics;
pub mod tokenizer;

pub use config::Config;
pub use embeddings::{EmbeddingProvider, FastEmbedProvider, MockEmbeddingProvider};
pub use folds::{export_fold, import_fold};
pub use mcp::McpHandler;
pub use runtime::{serve, serve_stdio, start_background};

pub use embeddings::embed_text;
pub use tokenizer::count_tokens;

pub mod sync_http;
pub use storage::SqliteStorage;
pub use sync_http::HttpSyncEngine;
pub use thermodynamics::{spawn_worker, tick};

pub mod sync;
pub use sync::spawn_sync_worker;
pub use sync::LocalSyncClient;
