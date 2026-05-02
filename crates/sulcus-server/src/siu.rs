//! Server-side SIU (Semantic Intelligence Unit) — classifies memory types
//! using JSON model weights (LogisticRegression coefficients + StandardScaler).
//!
//! Pure math: scale → dot → sigmoid. No ONNX Runtime needed on server.
//!
//! The model JSON is loaded from `SIU_MODEL_DIR/memory_classifier_multilabel.json`
//! (default: `/opt/sulcus/model/`).
//!
//! Falls back gracefully to `None` if the model isn't available, letting
//! the caller use the client-provided type as-is.

/// Number of embedding dimensions (BGE-Small-EN-V1.5).
const EMBEDDING_DIM: usize = 384;

/// Label index → memory type string.
const LABELS: &[&str] = &["episodic", "preference", "procedural", "semantic", "synthesis"];

/// Confidence threshold for single-label override.
const DEFAULT_THRESHOLD: f32 = 0.70;

/// Threshold for multi-label: any class above this is included.
const DEFAULT_MULTI_THRESHOLD: f32 = 0.50;

/// JSON-based multi-label classifier — uses raw LogisticRegression weights.
/// No ONNX Runtime needed. Pure math: scale → dot → sigmoid.
struct JsonModel {
    scaler_mean: Vec<f32>,
    scaler_scale: Vec<f32>,
    coefficients: Vec<Vec<f32>>,  // [NUM_CLASSES][EMBEDDING_DIM]
    intercepts: Vec<f32>,         // [NUM_CLASSES]
    classes: Vec<String>,
}

pub struct SiuClassifier {
    model: JsonModel,
    threshold: f32,
    multi_threshold: f32,
}

#[derive(Debug)]
pub struct Classification {
    pub memory_type: String,
    pub confidence: f32,
}

#[derive(Debug)]
pub struct MultiClassification {
    pub labels: Vec<Classification>,
    pub primary: Option<String>,
}

impl SiuClassifier {
    /// Try to load the JSON model weights. Returns None if not available.
    pub fn try_new() -> Option<Self> {
        tracing::info!("SIU: attempting to initialize classifier...");
        let model_dir = std::env::var("SIU_MODEL_DIR")
            .unwrap_or_else(|_| "/opt/sulcus/model".to_string());

        let dir = std::path::Path::new(&model_dir);
        let json_path = dir.join("memory_classifier_multilabel.json");

        if !json_path.exists() {
            tracing::info!("SIU: no model JSON at {} — classification disabled", json_path.display());
            return None;
        }

        let json_str = match std::fs::read_to_string(&json_path) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "SIU: failed to read model JSON");
                return None;
            }
        };

        let raw: serde_json::Value = match serde_json::from_str(&json_str) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = %e, "SIU: failed to parse model JSON");
                return None;
            }
        };

        let scaler_mean: Vec<f32> = raw["scaler_mean"].as_array()?
            .iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect();
        let scaler_scale: Vec<f32> = raw["scaler_scale"].as_array()?
            .iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect();
        let intercepts: Vec<f32> = raw["intercepts"].as_array()?
            .iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect();
        let classes: Vec<String> = raw["classes"].as_array()?
            .iter().filter_map(|v| v.as_str().map(String::from)).collect();
        let coefficients: Vec<Vec<f32>> = raw["coefficients"].as_array()?
            .iter().filter_map(|row| {
                row.as_array().map(|arr| {
                    arr.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect()
                })
            }).collect();

        if scaler_mean.len() != EMBEDDING_DIM || coefficients.len() != classes.len() {
            tracing::warn!(
                mean_len = scaler_mean.len(),
                num_classes = classes.len(),
                num_coefs = coefficients.len(),
                "SIU: model dimensions mismatch"
            );
            return None;
        }

        tracing::info!(
            classes = ?classes,
            n_features = EMBEDDING_DIM,
            "SIU classifier loaded (JSON weights, {} classes) from {}",
            classes.len(),
            json_path.display()
        );

        Some(Self {
            model: JsonModel {
                scaler_mean,
                scaler_scale,
                coefficients,
                intercepts,
                classes,
            },
            threshold: DEFAULT_THRESHOLD,
            multi_threshold: DEFAULT_MULTI_THRESHOLD,
        })
    }

    /// Run inference using JSON model weights. Pure math: scale → dot → sigmoid.
    /// Returns per-class probabilities.
    fn run_inference(&self, embedding: &[f32]) -> Option<Vec<f32>> {
        if embedding.len() != EMBEDDING_DIM {
            tracing::warn!("SIU: expected {EMBEDDING_DIM}-dim embedding, got {}", embedding.len());
            return None;
        }

        let m = &self.model;

        // Step 1: Standard scale — (x - mean) / scale
        let scaled: Vec<f32> = embedding.iter()
            .zip(m.scaler_mean.iter().zip(m.scaler_scale.iter()))
            .map(|(&x, (&mean, &scale))| {
                if scale.abs() < 1e-10 { 0.0 } else { (x - mean) / scale }
            })
            .collect();

        // Step 2: For each class, compute logit = dot(coef, scaled) + intercept
        // Step 3: Apply sigmoid to get independent per-class probability
        let probs: Vec<f32> = m.coefficients.iter()
            .zip(m.intercepts.iter())
            .map(|(coef, &intercept)| {
                let logit: f32 = coef.iter().zip(scaled.iter())
                    .map(|(&c, &s)| c * s)
                    .sum::<f32>() + intercept;
                sigmoid(logit)
            })
            .collect();

        tracing::debug!(
            probs = ?m.classes.iter().zip(probs.iter())
                .map(|(c, &p)| format!("{}={:.3}", c, p))
                .collect::<Vec<_>>(),
            "SIU classification probabilities"
        );

        Some(probs)
    }

    /// Single-label classification (backward compatible). Returns the best type
    /// above threshold, or None.
    pub fn classify(&self, embedding: &[f32]) -> Option<Classification> {
        let probs = self.run_inference(embedding)?;
        let (best_idx, confidence) = argmax(&probs);

        let best_type = self.model.classes.get(best_idx)
            .cloned()
            .unwrap_or_else(|| "episodic".to_string());

        tracing::debug!(
            best_type = %best_type,
            confidence,
            threshold = self.threshold,
            "SIU classification result"
        );

        if confidence < self.threshold {
            return None;
        }

        Some(Classification {
            memory_type: best_type,
            confidence,
        })
    }

    /// Multi-label classification. Returns ALL labels above multi_threshold.
    pub fn classify_multi(&self, embedding: &[f32]) -> Option<MultiClassification> {
        let probs = self.run_inference(embedding)?;

        let mut labels: Vec<Classification> = probs
            .iter()
            .enumerate()
            .filter(|(_, &conf)| conf >= self.multi_threshold)
            .map(|(idx, &conf)| Classification {
                memory_type: self.model.classes.get(idx)
                    .cloned()
                    .unwrap_or_else(|| "unknown".to_string()),
                confidence: conf,
            })
            .collect();

        labels.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));

        let primary = labels.first().map(|l| l.memory_type.clone());

        if labels.is_empty() {
            return None;
        }

        Some(MultiClassification { labels, primary })
    }
}

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

fn argmax(probs: &[f32]) -> (usize, f32) {
    probs
        .iter()
        .enumerate()
        .fold((0, f32::NEG_INFINITY), |(bi, bv), (i, &v)| {
            if v > bv { (i, v) } else { (bi, bv) }
        })
}

// ---------------------------------------------------------------------------
// SIU Config REST handlers (feature-gated settings page)
// ---------------------------------------------------------------------------

use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use crate::SharedState;

/// Default SIU config structure for new agents.
fn siu_defaults(has_siu: bool, has_silu: bool) -> serde_json::Value {
    serde_json::json!({
        "siu_enabled": has_siu,
        "siu_confidence_threshold": DEFAULT_THRESHOLD,
        "siu_auto_reclassify": false,
        "silu_enabled": has_silu,
        "silu_entity_extraction": true,
        "silu_classification": true,
        "silu_training_signals": true,
        "type_overrides": {},
    })
}

/// Merge saved config over defaults — ensures all expected fields exist.
fn merge_config(saved: serde_json::Value, defaults: &serde_json::Value) -> serde_json::Value {
    let mut merged = defaults.clone();
    if let (Some(m), Some(s)) = (merged.as_object_mut(), saved.as_object()) {
        for (k, v) in s {
            m.insert(k.clone(), v.clone());
        }
    }
    merged
}

/// GET /api/v1/settings/siu — returns global (tenant-default) SIU config.
pub async fn get_siu_config(
    State(state): State<SharedState>,
) -> (StatusCode, Json<serde_json::Value>) {
    let has_siu = state.siu_available() || state.siu_v2_available();
    let has_silu = state.extraction_config.is_some();

    let db_config: Option<String> = sqlx::query_scalar(
        "SELECT config::text FROM siu_config WHERE tenant_id = 'global' AND namespace IS NULL LIMIT 1"
    )
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    let defaults = siu_defaults(has_siu, has_silu);
    let config = db_config
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .map(|c| merge_config(c, &defaults))
        .unwrap_or_else(|| defaults.clone());

    (StatusCode::OK, Json(serde_json::json!({
        "siu_available": has_siu,
        "silu_available": has_silu,
        "config": config,
        "defaults": defaults,
    })))
}

/// PATCH /api/v1/settings/siu — update global (tenant-default) SIU config.
pub async fn update_siu_config(
    State(state): State<SharedState>,
    Json(body): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    let config_str = serde_json::to_string(&body).unwrap_or_default();

    let result = sqlx::query(
        "INSERT INTO siu_config (tenant_id, config) VALUES ('global', $1::jsonb) \
         ON CONFLICT (tenant_id, COALESCE(namespace, '__global__')) DO UPDATE SET config = $1::jsonb"
    )
    .bind(&config_str)
    .execute(&state.pool)
    .await;

    match result {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

/// GET /api/v1/settings/siu/:namespace — returns per-agent SIU config (merged with defaults).
pub async fn get_agent_siu_config(
    State(state): State<SharedState>,
    axum::extract::Path(namespace): axum::extract::Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let has_siu = state.siu_available() || state.siu_v2_available();
    let has_silu = state.extraction_config.is_some();
    let defaults = siu_defaults(has_siu, has_silu);

    // Load global defaults from DB first
    let global_config: Option<String> = sqlx::query_scalar(
        "SELECT config::text FROM siu_config WHERE tenant_id = 'global' AND namespace IS NULL LIMIT 1"
    )
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    let global = global_config
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .map(|c| merge_config(c, &defaults))
        .unwrap_or_else(|| defaults.clone());

    // Load per-agent overrides
    let agent_config: Option<String> = sqlx::query_scalar(
        "SELECT config::text FROM siu_config WHERE tenant_id = 'global' AND namespace = $1 LIMIT 1"
    )
    .bind(&namespace)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    let has_overrides = agent_config.is_some();
    let effective = agent_config
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .map(|c| merge_config(c, &global))
        .unwrap_or_else(|| global.clone());

    (StatusCode::OK, Json(serde_json::json!({
        "namespace": namespace,
        "siu_available": has_siu,
        "silu_available": has_silu,
        "effective_config": effective,
        "global_defaults": global,
        "has_overrides": has_overrides,
    })))
}

/// PATCH /api/v1/settings/siu/:namespace — set per-agent SIU config overrides.
pub async fn update_agent_siu_config(
    State(state): State<SharedState>,
    axum::extract::Path(namespace): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    let config_str = serde_json::to_string(&body).unwrap_or_default();

    let result = sqlx::query(
        "INSERT INTO siu_config (tenant_id, namespace, config) VALUES ('global', $1, $2::jsonb) \
         ON CONFLICT (tenant_id, COALESCE(namespace, '__global__')) DO UPDATE SET config = $2::jsonb"
    )
    .bind(&namespace)
    .bind(&config_str)
    .execute(&state.pool)
    .await;

    match result {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true, "namespace": namespace }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

/// DELETE /api/v1/settings/siu/:namespace — remove per-agent overrides (revert to global defaults).
pub async fn delete_agent_siu_config(
    State(state): State<SharedState>,
    axum::extract::Path(namespace): axum::extract::Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let result = sqlx::query(
        "DELETE FROM siu_config WHERE tenant_id = 'global' AND namespace = $1"
    )
    .bind(&namespace)
    .execute(&state.pool)
    .await;

    match result {
        Ok(r) => {
            if r.rows_affected() > 0 {
                (StatusCode::OK, Json(serde_json::json!({ "ok": true, "namespace": namespace, "reset_to_defaults": true })))
            } else {
                (StatusCode::OK, Json(serde_json::json!({ "ok": true, "namespace": namespace, "message": "No overrides existed" })))
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}
