//! # sulcus-multimind
//!
//! Generic ONNX (and future: API, GGUF) model registry for inference,
//! training signals, and hot-reload.
//!
//! This crate has **zero knowledge of Sulcus tables, tenants, or HTTP**.
//! Consumers (sulcus-server, guardian-server) wire it into their own
//! routing and storage layers.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────┐
//! │              ModelRegistry                   │
//! │  ┌─────────────┐  ┌─────────────┐           │
//! │  │ OnnxText    │  │ OnnxEmbed   │  ...      │
//! │  │ (TF-IDF+SGD)│  │ (384-dim)   │           │
//! │  └──────┬──────┘  └──────┬──────┘           │
//! │         │ ModelBackend   │                   │
//! │         └────────┬───────┘                   │
//! │                  ▼                           │
//! │           classify(input) → Verdict          │
//! └─────────────────────────────────────────────┘
//! ```

pub mod backends;
pub mod config;
pub mod registry;

// Re-exports for convenience
pub use config::MultimindConfig;
pub use registry::ModelRegistry;

use std::collections::HashMap;
use std::path::Path;

// ── Core trait ──────────────────────────────────────────────────────────────

/// Input to a model. Backends accept one or more of these.
#[derive(Debug, Clone)]
pub enum ModelInput {
    /// Raw text — for TF-IDF ONNX models that accept string tensors.
    Text(String),
    /// Pre-computed embedding vector — for embedding-based ONNX models.
    Embedding(Vec<f32>),
    /// Structured JSON — for API-backed models (future).
    Structured(serde_json::Value),
}

/// The output of a single model inference call.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Verdict {
    /// Winning label (e.g. "store", "episodic", "SAFE").
    pub label: String,
    /// Confidence in the winning label (0.0 – 1.0).
    pub confidence: f32,
    /// Per-class scores (label → probability). Empty if the backend
    /// doesn't support per-class output.
    pub all_scores: HashMap<String, f32>,
}

/// A model backend that can classify inputs.
///
/// Implementations must be `Send + Sync` for use inside `Arc<ModelRegistry>`.
pub trait ModelBackend: Send + Sync {
    /// Run inference on the given input.
    fn classify(&self, input: &ModelInput) -> anyhow::Result<Verdict>;

    /// Hot-reload the model from a new path.
    /// Returns `Ok(())` if reload succeeded, `Err` if not (old model stays loaded).
    fn reload(&self, path: &Path) -> anyhow::Result<()>;

    /// Human-readable backend name (e.g. "onnx-text", "onnx-embed").
    fn backend_name(&self) -> &'static str;
}

// ── Signal trait ────────────────────────────────────────────────────────────

/// A correction signal for model improvement.
/// The consuming service records these; the retrain logic reads them.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrainingSignal {
    /// Which model produced the original verdict.
    pub model_id: String,
    /// The input that was classified.
    pub input_text: String,
    /// The model's original prediction.
    pub predicted_label: String,
    /// The corrected label (ground truth from user/system).
    pub corrected_label: String,
    /// Optional confidence of the original prediction.
    pub original_confidence: Option<f32>,
}

/// Storage backend for training signals.
/// Sulcus implements this with Postgres. Guardian could use SQLite or JSONL.
pub trait SignalStore: Send + Sync {
    /// Record a correction signal.
    fn record(&self, signal: &TrainingSignal) -> anyhow::Result<()>;

    /// Count signals for a given model since last retrain.
    fn count_pending(&self, model_id: &str) -> anyhow::Result<usize>;

    /// Export pending signals for retraining.
    fn export_pending(&self, model_id: &str) -> anyhow::Result<Vec<TrainingSignal>>;

    /// Mark signals as consumed (after successful retrain).
    fn mark_consumed(&self, model_id: &str) -> anyhow::Result<()>;
}
