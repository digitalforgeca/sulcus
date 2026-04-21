//! ONNX backend for string-input models (TF-IDF + SGD pipeline).
//!
//! These models accept raw text as a string tensor — no pre-embedding needed.
//! Used by SIU v2 (SIVU quality gate, SICU type classifier) and Guardian adjudicators.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use anyhow::{anyhow, Context};
use ort::session::Session;
use ort::value::Tensor;

use crate::{ModelBackend, ModelInput, Verdict};

/// ONNX backend for TF-IDF text classification models.
///
/// Expects models exported from scikit-learn with a string input tensor.
/// Output: label tensor + probability tensor (from predict_proba).
pub struct OnnxTextBackend {
    session: Mutex<Session>,
    labels: HashMap<i64, String>,
    min_confidence: f32,
}

impl std::fmt::Debug for OnnxTextBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OnnxTextBackend")
            .field("labels", &self.labels)
            .field("min_confidence", &self.min_confidence)
            .finish()
    }
}

impl OnnxTextBackend {
    /// Load an ONNX string-input model from file.
    pub fn new(
        model_path: &Path,
        labels: HashMap<i64, String>,
        min_confidence: f32,
    ) -> anyhow::Result<Self> {
        let session = Session::builder()
            .context("failed to create ORT session builder")?
            .commit_from_file(model_path)
            .with_context(|| format!("failed to load ONNX model at {}", model_path.display()))?;

        tracing::info!(
            path = %model_path.display(),
            labels = ?labels,
            "OnnxTextBackend: model loaded"
        );

        Ok(Self {
            session: Mutex::new(session),
            labels,
            min_confidence,
        })
    }

    /// Load labels from a JSON file: {"0": "label_a", "1": "label_b", ...}
    pub fn load_labels(path: &Path) -> anyhow::Result<HashMap<i64, String>> {
        let json_str = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read labels from {}", path.display()))?;
        let raw: HashMap<String, String> = serde_json::from_str(&json_str)
            .context("failed to parse label map JSON")?;
        Ok(raw.into_iter()
            .filter_map(|(k, v)| k.parse::<i64>().ok().map(|i| (i, v)))
            .collect())
    }

    /// Run string-input ONNX inference and return (label, per-class probabilities).
    fn run_inference(&self, text: &str) -> anyhow::Result<(String, HashMap<String, f32>)> {
        let strings: Vec<String> = vec![text.to_string()];
        let input = Tensor::from_string_array(([1usize, 1], strings.as_slice()))
            .context("failed to create string input tensor")?;

        let mut session = self.session.lock()
            .map_err(|_| anyhow!("session mutex poisoned"))?;

        let outputs = session.run(ort::inputs![input])
            .context("ONNX inference failed")?;

        // Output 0: predicted label (i64)
        // Output 1: probability matrix (f32 or f64)
        let label_idx: i64 = if let Ok((_, labels)) = outputs[0].try_extract_tensor::<i64>() {
            labels[0]
        } else {
            return Err(anyhow!("failed to extract label tensor"));
        };

        let label = self.labels.get(&label_idx)
            .cloned()
            .unwrap_or_else(|| format!("class_{}", label_idx));

        // Extract probabilities
        let mut probs = HashMap::new();
        if outputs.len() >= 2 {
            // Try f32 first, then f64
            if let Ok((_, prob_tensor)) = outputs[1].try_extract_tensor::<f32>() {
                for (&idx, name) in &self.labels {
                    if let Some(&p) = prob_tensor.get(idx as usize) {
                        probs.insert(name.clone(), p);
                    }
                }
            } else if let Ok((_, prob_tensor)) = outputs[1].try_extract_tensor::<f64>() {
                for (&idx, name) in &self.labels {
                    if let Some(&p) = prob_tensor.get(idx as usize) {
                        probs.insert(name.clone(), p as f32);
                    }
                }
            }
        }

        // If we couldn't extract probs, at least set the winning label to 1.0
        if probs.is_empty() {
            probs.insert(label.clone(), 1.0);
        }

        Ok((label, probs))
    }
}

impl ModelBackend for OnnxTextBackend {
    fn classify(&self, input: &ModelInput) -> anyhow::Result<Verdict> {
        let text = match input {
            ModelInput::Text(t) => t.as_str(),
            _ => return Err(anyhow!("OnnxTextBackend requires ModelInput::Text")),
        };

        let (label, all_scores) = self.run_inference(text)?;
        let confidence = all_scores.get(&label).copied().unwrap_or(0.0);

        Ok(Verdict {
            label,
            confidence,
            all_scores,
        })
    }

    fn reload(&self, path: &Path) -> anyhow::Result<()> {
        let new_session = Session::builder()
            .context("failed to create ORT session builder")?
            .commit_from_file(path)
            .with_context(|| format!("failed to reload ONNX model at {}", path.display()))?;

        let mut session = self.session.lock()
            .map_err(|_| anyhow!("session mutex poisoned"))?;
        *session = new_session;

        tracing::info!(path = %path.display(), "OnnxTextBackend: model hot-reloaded");
        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "onnx-text"
    }
}
