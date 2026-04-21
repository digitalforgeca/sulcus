//! TOML-based configuration for the model registry.
//!
//! Example config:
//! ```toml
//! [[models]]
//! id = "sivu"
//! backend = "onnx-text"
//! path = "models/siu-v2/sivu_model.onnx"
//! labels = "models/siu-v2/sivu_model_labels.json"
//! classes = ["store", "reject"]
//!
//! [[models]]
//! id = "sicu"
//! backend = "onnx-text"
//! path = "models/siu-v2/sicu_model.onnx"
//! labels = "models/siu-v2/sicu_model_labels.json"
//!
//! [[models]]
//! id = "vibeguard"
//! backend = "onnx-text"
//! path = "models/guardian/vibeguard.onnx"
//! labels = "models/guardian/vibeguard_labels.json"
//! classes = ["SAFE", "UNSAFE", "REVIEW"]
//! ```

use serde::{Deserialize, Serialize};

/// Top-level multimind configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultimindConfig {
    /// Registered models.
    #[serde(default)]
    pub models: Vec<ModelConfig>,
}

/// Configuration for a single model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    /// Unique identifier for this model (e.g. "sivu", "vibeguard").
    pub id: String,

    /// Backend type: "onnx-text", "onnx-embed", "api" (future).
    pub backend: String,

    /// Path to the model file (ONNX, GGUF, etc.). Relative to model root.
    pub path: String,

    /// Path to the label map JSON file. Optional — some backends have defaults.
    pub labels: Option<String>,

    /// Expected class names. Optional — derived from labels file if not set.
    pub classes: Option<Vec<String>>,

    /// Minimum confidence to accept a classification. Default: 0.5.
    #[serde(default = "default_min_confidence")]
    pub min_confidence: f32,

    /// Number of embedding dimensions (for onnx-embed backend). Default: 384.
    #[serde(default = "default_embedding_dim")]
    pub embedding_dim: usize,

    /// Retrain configuration. Optional.
    pub retrain: Option<RetrainConfig>,
}

/// When to trigger a retrain for this model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrainConfig {
    /// Minimum number of correction signals before retraining.
    #[serde(default = "default_min_signals")]
    pub min_signals: usize,

    /// Minimum number of classification sessions before retraining.
    #[serde(default = "default_min_sessions")]
    pub min_sessions: usize,
}

fn default_min_confidence() -> f32 { 0.5 }
fn default_embedding_dim() -> usize { 384 }
fn default_min_signals() -> usize { 10 }
fn default_min_sessions() -> usize { 20 }

impl MultimindConfig {
    /// Parse from a TOML string.
    pub fn from_toml(toml_str: &str) -> anyhow::Result<Self> {
        Ok(toml::from_str(toml_str)?)
    }

    /// Parse from a TOML file path.
    pub fn from_file(path: &std::path::Path) -> anyhow::Result<Self> {
        let contents = std::fs::read_to_string(path)?;
        Self::from_toml(&contents)
    }

    /// Find a model config by ID.
    pub fn get_model(&self, id: &str) -> Option<&ModelConfig> {
        self.models.iter().find(|m| m.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_minimal_config() {
        let toml = r#"
            [[models]]
            id = "sivu"
            backend = "onnx-text"
            path = "models/sivu.onnx"
        "#;
        let config = MultimindConfig::from_toml(toml).unwrap();
        assert_eq!(config.models.len(), 1);
        assert_eq!(config.models[0].id, "sivu");
        assert_eq!(config.models[0].backend, "onnx-text");
        assert_eq!(config.models[0].min_confidence, 0.5);
    }

    #[test]
    fn test_parse_full_config() {
        let toml = r#"
            [[models]]
            id = "vibeguard"
            backend = "onnx-text"
            path = "models/vibeguard.onnx"
            labels = "models/vibeguard_labels.json"
            classes = ["SAFE", "UNSAFE", "REVIEW"]
            min_confidence = 0.7

            [models.retrain]
            min_signals = 50
            min_sessions = 100
        "#;
        let config = MultimindConfig::from_toml(toml).unwrap();
        let m = &config.models[0];
        assert_eq!(m.id, "vibeguard");
        assert_eq!(m.classes.as_ref().unwrap().len(), 3);
        assert_eq!(m.min_confidence, 0.7);
        assert_eq!(m.retrain.as_ref().unwrap().min_signals, 50);
    }
}
