//! ONNX session management, softmax/sigmoid, and label mapping.
//!
//! Supports two model types:
//! - Single-label (legacy `memory_classifier.onnx`): softmax → argmax → one label
//! - Multi-label (`memory_classifier_multilabel.onnx`): sigmoid per class → multiple labels

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use anyhow::{anyhow, Context, Result};
use ort::session::{Session, builder::GraphOptimizationLevel};
use ort::value::Tensor;

use crate::types::{ClassificationResult, LabelScore, MultiLabelResult};

/// Number of embedding dimensions expected by the classifier.
const EMBEDDING_DIM: usize = 384;
/// Number of output classes.
const NUM_CLASSES: usize = 5;

/// Label map: index → MemoryType string.
type LabelMap = HashMap<usize, String>;

/// Which model type is loaded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelType {
    SingleLabel,
    MultiLabel,
}

pub struct Classifier {
    session: Mutex<Session>,
    label_map: LabelMap,
    pub confidence_threshold: f32,
    pub multi_label_threshold: f32,
    pub model_type: ModelType,
}

impl Classifier {
    /// Load the ONNX model and label map from `model_dir`.
    ///
    /// Tries multi-label model first (`memory_classifier_multilabel.onnx`),
    /// falls back to single-label (`memory_classifier.onnx`).
    pub fn new(model_dir: &Path) -> Result<Self> {
        let multilabel_path = model_dir.join("memory_classifier_multilabel.onnx");
        let singlelabel_path = model_dir.join("memory_classifier.onnx");
        // Also accept the BGE-specific name
        let bge_path = model_dir.join("memory_classifier_bge.onnx");

        let (onnx_path, model_type) = if multilabel_path.exists() {
            (multilabel_path, ModelType::MultiLabel)
        } else if singlelabel_path.exists() {
            (singlelabel_path, ModelType::SingleLabel)
        } else if bge_path.exists() {
            (bge_path, ModelType::SingleLabel)
        } else {
            return Err(anyhow!(
                "no ONNX model found in {}. Expected memory_classifier_multilabel.onnx, memory_classifier.onnx, or memory_classifier_bge.onnx",
                model_dir.display()
            ));
        };

        let label_path = model_dir.join("label_map.json");

        // Load label map: {"0": "episodic", "1": "preference", ...}
        let label_json = std::fs::read_to_string(&label_path)
            .with_context(|| format!("failed to read label_map.json at {}", label_path.display()))?;
        let raw_map: HashMap<String, String> = serde_json::from_str(&label_json)
            .context("failed to parse label_map.json")?;
        let label_map: LabelMap = raw_map
            .into_iter()
            .filter_map(|(k, v)| k.parse::<usize>().ok().map(|i| (i, v)))
            .collect();

        if label_map.len() != NUM_CLASSES {
            return Err(anyhow!(
                "expected {} classes in label_map.json, got {}",
                NUM_CLASSES,
                label_map.len()
            ));
        }

        // Build ONNX session.
        let session = Session::builder()
            .context("failed to create ORT session builder")?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .context("failed to set optimization level")?
            .commit_from_file(&onnx_path)
            .with_context(|| format!("failed to load ONNX model at {}", onnx_path.display()))?;

        eprintln!(
            "[sulcus-siu] loaded {} model from {}",
            match model_type {
                ModelType::SingleLabel => "single-label",
                ModelType::MultiLabel => "multi-label",
            },
            onnx_path.display()
        );

        Ok(Self {
            session: Mutex::new(session),
            label_map,
            confidence_threshold: 0.70,
            multi_label_threshold: 0.50,
            model_type,
        })
    }

    /// Run ONNX inference and return raw logits/probabilities for all classes.
    fn run_inference(&self, embedding: &[f32]) -> Result<Vec<f32>> {
        if embedding.len() != EMBEDDING_DIM {
            return Err(anyhow!(
                "expected embedding of length {}, got {}",
                EMBEDDING_DIM,
                embedding.len()
            ));
        }

        let input_tensor = Tensor::<f32>::from_array((
            vec![1_usize, EMBEDDING_DIM],
            embedding.to_vec(),
        ))
        .context("failed to create input tensor")?;

        let mut session = self.session.lock().map_err(|_| anyhow!("session mutex poisoned"))?;

        let outputs = session
            .run(ort::inputs![input_tensor])
            .context("ONNX inference failed")?;

        // The model may output:
        // - Single-label: [1, NUM_CLASSES] logits (first output)
        // - Multi-label (OVR): labels (first output) + probabilities (second output)
        //   or just [1, NUM_CLASSES] logits

        // Try second output first (probability matrix from OVR export)
        if outputs.len() >= 2 {
            // Second output is typically the probability dict/list from sklearn
            // Try extracting as f32 tensor
            if let Ok((_, probs)) = outputs[1].try_extract_tensor::<f32>() {
                if probs.len() >= NUM_CLASSES {
                    return Ok(probs[..NUM_CLASSES].to_vec());
                }
            }
            // Try as f64 (some sklearn exports use f64)
            if let Ok((_, probs)) = outputs[1].try_extract_tensor::<f64>() {
                if probs.len() >= NUM_CLASSES {
                    return Ok(probs[..NUM_CLASSES].iter().map(|&v| v as f32).collect());
                }
            }
        }

        // Fall back to first output (logits)
        let (_, logits_slice) = outputs[0]
            .try_extract_tensor::<f32>()
            .context("failed to extract output tensor")?;

        if logits_slice.len() < NUM_CLASSES {
            // Try i64 (class labels from OVR)
            if let Ok((_, labels)) = outputs[0].try_extract_tensor::<i64>() {
                // This is just class labels, not probabilities.
                // Create one-hot-ish from labels. But this loses confidence info.
                // Better to return an error and use the JSON model fallback.
                let _ = labels;
                return Err(anyhow!("ONNX model only returned class labels, not probabilities"));
            }
            return Err(anyhow!(
                "expected {} logits, got {}",
                NUM_CLASSES,
                logits_slice.len()
            ));
        }

        Ok(logits_slice[..NUM_CLASSES].to_vec())
    }

    /// Classify a 384-dim embedding → single best label (backward compatible).
    pub fn classify(&self, embedding: &[f32]) -> Result<ClassificationResult> {
        let raw = self.run_inference(embedding)?;

        let probs = match self.model_type {
            ModelType::SingleLabel => softmax(&raw),
            ModelType::MultiLabel => {
                // For multi-label, use sigmoid per class
                let sigs = sigmoid_vec(&raw);
                // But for single-label output, pick the best via raw scores
                sigs
            }
        };

        let (best_idx, confidence) = argmax(&probs);
        let memory_type = self
            .label_map
            .get(&best_idx)
            .cloned()
            .unwrap_or_else(|| "unknown".to_string());

        Ok(ClassificationResult {
            memory_type,
            confidence,
        })
    }

    /// Multi-label classification: returns ALL labels above the threshold.
    pub fn classify_multi(&self, embedding: &[f32]) -> Result<MultiLabelResult> {
        let raw = self.run_inference(embedding)?;

        // For multi-label, apply sigmoid to get independent per-class probabilities
        // For single-label model, use softmax (still works, just usually only one label will be high)
        let probs = match self.model_type {
            ModelType::MultiLabel => {
                // The OVR model outputs are already probabilities from predict_proba
                // Check if values are already in [0,1] range
                if raw.iter().all(|&v| v >= 0.0 && v <= 1.0) {
                    raw.clone()
                } else {
                    sigmoid_vec(&raw)
                }
            }
            ModelType::SingleLabel => softmax(&raw),
        };

        let mut labels: Vec<LabelScore> = probs
            .iter()
            .enumerate()
            .filter(|(_, &conf)| conf >= self.multi_label_threshold)
            .map(|(idx, &conf)| LabelScore {
                memory_type: self
                    .label_map
                    .get(&idx)
                    .cloned()
                    .unwrap_or_else(|| "unknown".to_string()),
                confidence: conf,
            })
            .collect();

        // Sort by confidence descending
        labels.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));

        let primary = labels.first().map(|l| l.memory_type.clone());

        Ok(MultiLabelResult { labels, primary })
    }
}

// ── Math helpers ──────────────────────────────────────────────────────────────

/// Compute softmax over a logit slice.
fn softmax(logits: &[f32]) -> Vec<f32> {
    let max = logits.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = logits.iter().map(|&x| (x - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    exps.iter().map(|&e| e / sum).collect()
}

/// Compute sigmoid for each element independently.
fn sigmoid_vec(logits: &[f32]) -> Vec<f32> {
    logits.iter().map(|&x| 1.0 / (1.0 + (-x).exp())).collect()
}

/// Returns (index, value) of the maximum element.
fn argmax(probs: &[f32]) -> (usize, f32) {
    probs
        .iter()
        .enumerate()
        .fold((0, f32::NEG_INFINITY), |(best_i, best_v), (i, &v)| {
            if v > best_v { (i, v) } else { (best_i, best_v) }
        })
}
