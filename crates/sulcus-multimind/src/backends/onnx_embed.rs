//! ONNX backend for embedding-input models (pre-computed vector → classification).
//!
//! These models accept a float32 embedding vector as input.
//! Used by sulcus-siu v1 (384-dim BGE embeddings → 5-class memory type).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use anyhow::{anyhow, Context};
use ort::session::{Session, builder::GraphOptimizationLevel};
use ort::value::Tensor;

use crate::{ModelBackend, ModelInput, Verdict};

/// ONNX backend for embedding-based classifiers.
///
/// Expects models that take a float32 tensor of shape [1, embedding_dim].
pub struct OnnxEmbedBackend {
    session: Mutex<Session>,
    labels: HashMap<usize, String>,
    embedding_dim: usize,
    min_confidence: f32,
}

impl std::fmt::Debug for OnnxEmbedBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OnnxEmbedBackend")
            .field("labels", &self.labels)
            .field("embedding_dim", &self.embedding_dim)
            .finish()
    }
}

impl OnnxEmbedBackend {
    /// Load an ONNX embedding-input model from file.
    pub fn new(
        model_path: &Path,
        labels: HashMap<usize, String>,
        embedding_dim: usize,
        min_confidence: f32,
    ) -> anyhow::Result<Self> {
        let session = Session::builder()
            .context("failed to create ORT session builder")?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .context("failed to set optimization level")?
            .commit_from_file(model_path)
            .with_context(|| format!("failed to load ONNX model at {}", model_path.display()))?;

        tracing::info!(
            path = %model_path.display(),
            labels = ?labels,
            embedding_dim,
            "OnnxEmbedBackend: model loaded"
        );

        Ok(Self {
            session: Mutex::new(session),
            labels,
            embedding_dim,
            min_confidence,
        })
    }

    /// Load labels from a JSON file: {"0": "label_a", "1": "label_b", ...}
    pub fn load_labels(path: &Path) -> anyhow::Result<HashMap<usize, String>> {
        let json_str = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read labels from {}", path.display()))?;
        let raw: HashMap<String, String> = serde_json::from_str(&json_str)
            .context("failed to parse label map JSON")?;
        Ok(raw.into_iter()
            .filter_map(|(k, v)| k.parse::<usize>().ok().map(|i| (i, v)))
            .collect())
    }
}

impl ModelBackend for OnnxEmbedBackend {
    fn classify(&self, input: &ModelInput) -> anyhow::Result<Verdict> {
        let embedding = match input {
            ModelInput::Embedding(e) => e,
            _ => return Err(anyhow!("OnnxEmbedBackend requires ModelInput::Embedding")),
        };

        if embedding.len() != self.embedding_dim {
            return Err(anyhow!(
                "expected embedding of length {}, got {}",
                self.embedding_dim,
                embedding.len()
            ));
        }

        let input_tensor = Tensor::<f32>::from_array((
            vec![1_usize, self.embedding_dim],
            embedding.to_vec(),
        )).context("failed to create input tensor")?;

        let mut session = self.session.lock()
            .map_err(|_| anyhow!("session mutex poisoned"))?;

        let outputs = session.run(ort::inputs![input_tensor])
            .context("ONNX inference failed")?;

        // Extract raw output — may be logits or probabilities
        let raw: Vec<f32> = if outputs.len() >= 2 {
            // Try second output (sklearn probability matrix)
            if let Ok((_, probs)) = outputs[1].try_extract_tensor::<f32>() {
                probs.iter().take(self.labels.len()).copied().collect()
            } else if let Ok((_, probs)) = outputs[1].try_extract_tensor::<f64>() {
                probs.iter().take(self.labels.len()).map(|&v| v as f32).collect()
            } else {
                // Fall back to first output
                let (_, logits) = outputs[0].try_extract_tensor::<f32>()
                    .context("failed to extract output tensor")?;
                logits.iter().take(self.labels.len()).copied().collect()
            }
        } else {
            let (_, logits) = outputs[0].try_extract_tensor::<f32>()
                .context("failed to extract output tensor")?;
            logits.iter().take(self.labels.len()).copied().collect()
        };

        // Apply softmax if values aren't already probabilities
        let probs = if raw.iter().all(|&v| v >= 0.0 && v <= 1.0) && (raw.iter().sum::<f32>() - 1.0).abs() < 0.1 {
            raw // Already probabilities
        } else {
            softmax(&raw)
        };

        // Find winning label
        let (best_idx, best_conf) = probs.iter()
            .enumerate()
            .fold((0, f32::NEG_INFINITY), |(bi, bv), (i, &v)| {
                if v > bv { (i, v) } else { (bi, bv) }
            });

        let label = self.labels.get(&best_idx)
            .cloned()
            .unwrap_or_else(|| format!("class_{}", best_idx));

        let all_scores: HashMap<String, f32> = probs.iter()
            .enumerate()
            .map(|(i, &p)| {
                let name = self.labels.get(&i)
                    .cloned()
                    .unwrap_or_else(|| format!("class_{}", i));
                (name, p)
            })
            .collect();

        Ok(Verdict {
            label,
            confidence: best_conf,
            all_scores,
        })
    }

    fn reload(&self, path: &Path) -> anyhow::Result<()> {
        let new_session = Session::builder()
            .context("failed to create ORT session builder")?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .context("failed to set optimization level")?
            .commit_from_file(path)
            .with_context(|| format!("failed to reload ONNX model at {}", path.display()))?;

        let mut session = self.session.lock()
            .map_err(|_| anyhow!("session mutex poisoned"))?;
        *session = new_session;

        tracing::info!(path = %path.display(), "OnnxEmbedBackend: model hot-reloaded");
        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "onnx-embed"
    }
}

/// Compute softmax over a logit slice.
fn softmax(logits: &[f32]) -> Vec<f32> {
    let max = logits.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = logits.iter().map(|&x| (x - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    exps.iter().map(|&e| e / sum).collect()
}
