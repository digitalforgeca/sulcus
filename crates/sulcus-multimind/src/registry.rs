//! Model registry — load, manage, and query models by ID.
//!
//! Models are loaded lazily on first `classify()` call and cached in an
//! `Arc<RwLock<>>`. Hot-reload replaces the model in-place without
//! dropping the registry.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use anyhow::{anyhow, Context};

use crate::backends::onnx_embed::OnnxEmbedBackend;
use crate::backends::onnx_text::OnnxTextBackend;
use crate::config::{ModelConfig, MultimindConfig};
use crate::{ModelBackend, ModelInput, Verdict};

/// A loaded model instance.
struct LoadedModel {
    backend: Box<dyn ModelBackend>,
    config: ModelConfig,
}

/// The model registry. Thread-safe, supports lazy loading and hot-reload.
pub struct ModelRegistry {
    config: MultimindConfig,
    model_root: PathBuf,
    models: RwLock<HashMap<String, Arc<LoadedModel>>>,
}

impl ModelRegistry {
    /// Create a new registry from config. Models are NOT loaded yet — they
    /// load lazily on first `classify()` call.
    pub fn new(config: MultimindConfig, model_root: impl Into<PathBuf>) -> Self {
        Self {
            config,
            model_root: model_root.into(),
            models: RwLock::new(HashMap::new()),
        }
    }

    /// Create from a TOML config file.
    pub fn from_file(config_path: &Path, model_root: impl Into<PathBuf>) -> anyhow::Result<Self> {
        let config = MultimindConfig::from_file(config_path)?;
        Ok(Self::new(config, model_root))
    }

    /// List all registered model IDs (from config, whether loaded or not).
    pub fn model_ids(&self) -> Vec<String> {
        self.config.models.iter().map(|m| m.id.clone()).collect()
    }

    /// Check if a model is currently loaded (vs. just configured).
    pub fn is_loaded(&self, model_id: &str) -> bool {
        self.models.read()
            .map(|m| m.contains_key(model_id))
            .unwrap_or(false)
    }

    /// Classify input using a specific model. Loads the model lazily if needed.
    pub fn classify(&self, model_id: &str, input: &ModelInput) -> anyhow::Result<Verdict> {
        // Fast path: model already loaded
        {
            let models = self.models.read()
                .map_err(|_| anyhow!("models RwLock poisoned"))?;
            if let Some(loaded) = models.get(model_id) {
                return loaded.backend.classify(input);
            }
        }

        // Slow path: load the model
        self.load_model(model_id)?;

        let models = self.models.read()
            .map_err(|_| anyhow!("models RwLock poisoned"))?;
        models.get(model_id)
            .ok_or_else(|| anyhow!("model '{}' failed to load", model_id))?
            .backend.classify(input)
    }

    /// Explicitly load a model by ID. No-op if already loaded.
    pub fn load_model(&self, model_id: &str) -> anyhow::Result<()> {
        // Check if already loaded
        {
            let models = self.models.read()
                .map_err(|_| anyhow!("models RwLock poisoned"))?;
            if models.contains_key(model_id) {
                return Ok(());
            }
        }

        let model_config = self.config.get_model(model_id)
            .ok_or_else(|| anyhow!("no model with id '{}' in config", model_id))?
            .clone();

        let model_path = self.model_root.join(&model_config.path);
        let backend: Box<dyn ModelBackend> = match model_config.backend.as_str() {
            "onnx-text" => {
                let labels = if let Some(ref labels_path) = model_config.labels {
                    let full_path = self.model_root.join(labels_path);
                    OnnxTextBackend::load_labels(&full_path)
                        .with_context(|| format!("failed to load labels for model '{}'", model_id))?
                } else {
                    HashMap::new()
                };
                Box::new(OnnxTextBackend::new(
                    &model_path,
                    labels,
                    model_config.min_confidence,
                )?)
            }
            "onnx-embed" => {
                let labels = if let Some(ref labels_path) = model_config.labels {
                    let full_path = self.model_root.join(labels_path);
                    OnnxEmbedBackend::load_labels(&full_path)
                        .with_context(|| format!("failed to load labels for model '{}'", model_id))?
                } else {
                    HashMap::new()
                };
                Box::new(OnnxEmbedBackend::new(
                    &model_path,
                    labels,
                    model_config.embedding_dim,
                    model_config.min_confidence,
                )?)
            }
            other => {
                return Err(anyhow!("unsupported backend type '{}' for model '{}'", other, model_id));
            }
        };

        tracing::info!(model_id, backend = model_config.backend.as_str(), "ModelRegistry: model loaded");

        let loaded = Arc::new(LoadedModel {
            backend,
            config: model_config,
        });

        let mut models = self.models.write()
            .map_err(|_| anyhow!("models RwLock poisoned"))?;
        models.insert(model_id.to_string(), loaded);

        Ok(())
    }

    /// Hot-reload a model from a new path. The model must already be configured.
    pub fn reload_model(&self, model_id: &str, new_path: &Path) -> anyhow::Result<()> {
        let models = self.models.read()
            .map_err(|_| anyhow!("models RwLock poisoned"))?;

        let loaded = models.get(model_id)
            .ok_or_else(|| anyhow!("model '{}' not loaded, can't reload", model_id))?;

        loaded.backend.reload(new_path)?;
        tracing::info!(model_id, path = %new_path.display(), "ModelRegistry: model hot-reloaded");
        Ok(())
    }

    /// Unload a model, freeing its memory.
    pub fn unload_model(&self, model_id: &str) -> anyhow::Result<bool> {
        let mut models = self.models.write()
            .map_err(|_| anyhow!("models RwLock poisoned"))?;
        let removed = models.remove(model_id).is_some();
        if removed {
            tracing::info!(model_id, "ModelRegistry: model unloaded");
        }
        Ok(removed)
    }

    /// Get the config for a model.
    pub fn get_model_config(&self, model_id: &str) -> Option<ModelConfig> {
        self.config.get_model(model_id).cloned()
    }

    /// Replace the entire config (e.g. on TOML hot-reload).
    /// Does NOT unload existing models — they stay loaded until explicitly
    /// unloaded or the registry is dropped.
    pub fn update_config(&mut self, config: MultimindConfig) {
        self.config = config;
        tracing::info!("ModelRegistry: config updated");
    }
}
