//! sulcus-local — Embedded local storage backend for Sulcus.
//!
//! Uses SQLite with FTS5 for full-text search. Vector similarity search
//! is supported when embeddings are available (see `sulcus-local` feature
//! `embeddings` and Task 4.3).
//!
//! # Architecture
//!
//! - **memories** table: core node storage with heat, type, timestamps
//! - **memories_fts** virtual table: FTS5 full-text index over content
//! - **edges** table: knowledge graph relationships
//! - **triggers** table: reactive trigger definitions
//! - **embeddings** table: optional vector storage (f32 blobs)
//!
//! Heat decay is computed on-read using exponential decay from `updated_at`,
//! matching the cloud thermodynamic model.

pub mod schema;
pub mod store;

pub use store::LocalStore;
