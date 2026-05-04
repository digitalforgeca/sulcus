//! SIU v2 — ONNX-based classifiers (SIVU + SICU) + REST endpoints
//!
//! SIVU (SI Value Unit): Binary store/reject quality gate
//! SICU (SI Classification Unit): 5-class memory type classifier
//! SITU (SI Trigger Unit): Future — trigger fire evaluator
//!
//! Both models are scikit-learn TF-IDF + SGDClassifier pipelines exported
//! to ONNX. They take raw text as input (string tensor) — no embeddings needed.
//!
//! Model directory: `SIU_V2_MODEL_DIR` env var (default: `/opt/sulcus/models/siu-v2/`)
//! Expected files: sivu_model.onnx, sicu_model.onnx, sivu_model_labels.json, sicu_model_labels.json

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use crate::SharedState;
use crate::middleware::TenantContext;

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/// Result of running both SIVU + SICU in sequence.
#[derive(Debug, Clone, Serialize)]
pub struct SiuV2Result {
    /// "store" or "reject"
    pub quality: String,
    /// Confidence in quality decision (0.0 - 1.0)
    pub quality_confidence: f32,
    /// Memory type (only set if quality == "store")
    pub memory_type: Option<String>,
    /// Confidence in type classification (0.0 - 1.0)
    pub type_confidence: Option<f32>,
    /// Per-class probabilities from SICU (if available)
    pub type_probabilities: Option<HashMap<String, f32>>,
}

// ---------------------------------------------------------------------------
// ONNX classifier
// ---------------------------------------------------------------------------

/// ONNX-based SIU v2 classifier. Holds SIVU, SICU, and optionally SITU sessions.
/// Sessions are wrapped in Mutex because ort 2.0 requires `&mut self` for `run()`.
pub struct SiuV2Classifier {
    sivu_session: std::sync::Mutex<ort::session::Session>,
    sicu_session: std::sync::Mutex<ort::session::Session>,
    situ_session: Option<std::sync::Mutex<ort::session::Session>>,
    #[allow(dead_code)]
    sivu_labels: HashMap<i64, String>,
    #[allow(dead_code)]
    sicu_labels: HashMap<i64, String>,
    #[allow(dead_code)]
    situ_labels: HashMap<i64, String>,
    /// Minimum confidence to accept a reject decision (below this → default to store)
    min_reject_confidence: f32,
    /// Minimum confidence for SITU to skip a trigger (below this → evaluate anyway)
    min_situ_skip_confidence: f32,
}

impl std::fmt::Debug for SiuV2Classifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SiuV2Classifier")
            .field("sivu_labels", &self.sivu_labels)
            .field("sicu_labels", &self.sicu_labels)
            .finish()
    }
}

impl SiuV2Classifier {
    /// Try to load ONNX models from the default model directory.
    /// Returns None if models aren't available (graceful degradation).
    pub fn try_new() -> Option<Arc<Self>> {
        let model_dir = std::env::var("SIU_V2_MODEL_DIR")
            .unwrap_or_else(|_| "/opt/sulcus/models/siu-v2".to_string());
        let dir = Path::new(&model_dir);

        let sivu_path = dir.join("sivu_model.onnx");
        let sicu_path = dir.join("sicu_model.onnx");
        let situ_path = dir.join("situ_model.onnx");
        let sivu_labels_path = dir.join("sivu_model_labels.json");
        let sicu_labels_path = dir.join("sicu_model_labels.json");
        let situ_labels_path = dir.join("situ_model_labels.json");

        // Verbose startup diagnostic — log existence + size of every expected file
        tracing::info!(
            model_dir = %dir.display(),
            dir_exists = dir.exists(),
            sivu_exists = sivu_path.exists(),
            sivu_bytes = sivu_path.metadata().map(|m| m.len()).unwrap_or(0),
            sicu_exists = sicu_path.exists(),
            sicu_bytes = sicu_path.metadata().map(|m| m.len()).unwrap_or(0),
            situ_exists = situ_path.exists(),
            situ_bytes = situ_path.metadata().map(|m| m.len()).unwrap_or(0),
            sivu_labels_exists = sivu_labels_path.exists(),
            sicu_labels_exists = sicu_labels_path.exists(),
            situ_labels_exists = situ_labels_path.exists(),
            ort_dylib = %std::env::var("ORT_DYLIB_PATH").unwrap_or_else(|_| "unset".into()),
            "SIU v2: model directory probe"
        );

        if !sivu_path.exists() || !sicu_path.exists() {
            tracing::warn!(
                "SIU v2: ONNX models NOT FOUND at {} — v2 classification DISABLED. \
                Ensure models/siu-v2/ is included in Docker build context.",
                dir.display()
            );
            return None;
        }

        // Load SIVU model
        let sivu_session = match ort::session::Session::builder()
            .and_then(|b| b.commit_from_file(&sivu_path))
        {
            Ok(s) => {
                tracing::info!(path = %sivu_path.display(), "SIU v2: SIVU ONNX model loaded successfully");
                s
            }
            Err(e) => {
                tracing::error!(error = %e, path = %sivu_path.display(), "SIU v2: FAILED to load SIVU ONNX model");
                return None;
            }
        };

        // Load SICU model
        let sicu_session = match ort::session::Session::builder()
            .and_then(|b| b.commit_from_file(&sicu_path))
        {
            Ok(s) => {
                tracing::info!(path = %sicu_path.display(), "SIU v2: SICU ONNX model loaded successfully");
                s
            }
            Err(e) => {
                tracing::error!(error = %e, path = %sicu_path.display(), "SIU v2: FAILED to load SICU ONNX model");
                return None;
            }
        };

        // Load label maps
        let sivu_labels = load_labels(&sivu_labels_path).unwrap_or_else(|| {
            tracing::info!("SIU v2: using default SIVU labels");
            HashMap::from([(0, "reject".to_string()), (1, "store".to_string())])
        });

        let sicu_labels = load_labels(&sicu_labels_path).unwrap_or_else(|| {
            tracing::info!("SIU v2: using default SICU labels");
            HashMap::from([
                (0, "episodic".to_string()),
                (1, "fact".to_string()),
                (2, "preference".to_string()),
                (3, "procedural".to_string()),
                (4, "semantic".to_string()),
            ])
        });

        // Load SITU model (optional — trigger evaluation degrades to rule-based without it)
        let (situ_session, situ_labels) = if situ_path.exists() {
            match ort::session::Session::builder()
                .and_then(|b| b.commit_from_file(&situ_path))
            {
                Ok(s) => {
                    tracing::info!(path = %situ_path.display(), "SIU v2: SITU ONNX model loaded successfully");
                    let labels = load_labels(&situ_labels_path).unwrap_or_else(|| {
                        tracing::info!("SIU v2: using default SITU labels");
                        HashMap::from([(0, "fire".to_string()), (1, "no_fire".to_string())])
                    });
                    (Some(std::sync::Mutex::new(s)), labels)
                }
                Err(e) => {
                    tracing::warn!(error = %e, "SIU v2: SITU model found but failed to load — trigger pre-filter disabled");
                    (None, HashMap::from([(0, "fire".to_string()), (1, "no_fire".to_string())]))
                }
            }
        } else {
            tracing::info!("SIU v2: SITU model not found — trigger pre-filter disabled (rule-based fallback)");
            (None, HashMap::from([(0, "fire".to_string()), (1, "no_fire".to_string())]))
        };

        tracing::info!(
            sivu_labels = ?sivu_labels,
            sicu_labels = ?sicu_labels,
            situ_available = situ_session.is_some(),
            "SIU v2 classifier loaded (ONNX) from {}",
            dir.display()
        );

        Some(Arc::new(Self {
            sivu_session: std::sync::Mutex::new(sivu_session),
            sicu_session: std::sync::Mutex::new(sicu_session),
            situ_session,
            sivu_labels,
            sicu_labels,
            situ_labels,
            min_reject_confidence: 0.6,
            min_situ_skip_confidence: 0.85,
        }))
    }

    /// Try to load ONNX models from a specific directory.
    /// Used for per-agent model repos.
    pub fn try_from_dir(dir: &Path) -> Option<Arc<Self>> {
        let sivu_path = dir.join("sivu_model.onnx");
        let sicu_path = dir.join("sicu_model.onnx");
        let situ_path = dir.join("situ_model.onnx");
        let sivu_labels_path = dir.join("sivu_model_labels.json");
        let sicu_labels_path = dir.join("sicu_model_labels.json");
        let situ_labels_path = dir.join("situ_model_labels.json");

        if !sivu_path.exists() || !sicu_path.exists() {
            return None;
        }

        let sivu_session = ort::session::Session::builder()
            .and_then(|b| b.commit_from_file(&sivu_path))
            .ok()?;
        let sicu_session = ort::session::Session::builder()
            .and_then(|b| b.commit_from_file(&sicu_path))
            .ok()?;

        let situ_session = if situ_path.exists() {
            ort::session::Session::builder()
                .and_then(|b| b.commit_from_file(&situ_path))
                .ok()
                .map(std::sync::Mutex::new)
        } else {
            None
        };

        let sivu_labels = load_labels(&sivu_labels_path).unwrap_or_else(|| {
            HashMap::from([(0, "reject".to_string()), (1, "store".to_string())])
        });
        let sicu_labels = load_labels(&sicu_labels_path).unwrap_or_else(|| {
            HashMap::from([
                (0, "episodic".to_string()), (1, "fact".to_string()),
                (2, "preference".to_string()), (3, "procedural".to_string()),
                (4, "semantic".to_string()),
            ])
        });
        let situ_labels = load_labels(&situ_labels_path).unwrap_or_else(|| {
            HashMap::from([(0, "fire".to_string()), (1, "no_fire".to_string())])
        });

        tracing::info!(situ_available = situ_session.is_some(), "SIU v2: loaded per-agent model from {}", dir.display());
        Some(Arc::new(Self {
            sivu_session: std::sync::Mutex::new(sivu_session),
            sicu_session: std::sync::Mutex::new(sicu_session),
            situ_session,
            sivu_labels, sicu_labels, situ_labels,
            min_reject_confidence: 0.6,
            min_situ_skip_confidence: 0.85,
        }))
    }

    /// Run the full SIU v2 pipeline: quality gate → type classification.
    pub fn classify(&self, text: &str) -> Option<SiuV2Result> {
        // Step 0: Heuristic pre-filter — reject trivially short/empty inputs
        // before burning ONNX inference cycles on them.
        let trimmed = text.trim();
        let word_count = trimmed.split_whitespace().count();
        if trimmed.len() < 4 || word_count < 2 {
            tracing::debug!(
                text_len = trimmed.len(),
                word_count,
                "SIU v2 heuristic reject: input too short"
            );
            return Some(SiuV2Result {
                quality: "reject".to_string(),
                quality_confidence: 0.99,
                memory_type: None,
                type_confidence: None,
                type_probabilities: None,
            });
        }

        // Step 1: SIVU quality gate
        let (quality, quality_confidence) = self.run_sivu(text)?;

        if quality == "reject" && quality_confidence >= self.min_reject_confidence {
            return Some(SiuV2Result {
                quality,
                quality_confidence,
                memory_type: None,
                type_confidence: None,
                type_probabilities: None,
            });
        }

        // Step 2: SICU type classification (only for "store" or low-confidence rejections)
        let (memory_type, type_confidence, type_probs) = self.run_sicu(text)
            .unwrap_or(("episodic".to_string(), 0.0, HashMap::new()));

        Some(SiuV2Result {
            quality: "store".to_string(),
            quality_confidence,
            memory_type: Some(memory_type),
            type_confidence: Some(type_confidence),
            type_probabilities: Some(type_probs),
        })
    }

    /// Run SIVU (quality gate) only.
    pub fn run_sivu(&self, text: &str) -> Option<(String, f32)> {
        let mut session = self.sivu_session.lock().ok()?;
        let result = run_string_model(&mut session, text);
        match result {
            Ok((label, probs)) => {
                let confidence = probs.get(&label).copied().unwrap_or(0.0);
                tracing::debug!(label = %label, confidence, "SIU v2 SIVU result");
                Some((label, confidence))
            }
            Err(e) => {
                tracing::warn!(error = %e, "SIU v2 SIVU inference failed");
                None
            }
        }
    }

    /// Check if SITU model is loaded and available.
    pub fn situ_available(&self) -> bool {
        self.situ_session.is_some()
    }

    /// Run SITU (trigger fire evaluator) on a trigger context string.
    ///
    /// Input text format: "{event}: {memory_label} [trigger: {name}, filters: {filter_str}, mem_type: {type}, heat={heat}]"
    /// Returns: (prediction, confidence) where prediction is "fire" or "no_fire"
    pub fn run_situ(&self, text: &str) -> Option<(String, f32)> {
        let session_mutex = self.situ_session.as_ref()?;
        let mut session = session_mutex.lock().ok()?;
        let result = run_string_model(&mut session, text);
        match result {
            Ok((label, probs)) => {
                let confidence = probs.get(&label).copied().unwrap_or(0.0);
                tracing::debug!(label = %label, confidence, "SIU v2 SITU result");
                Some((label, confidence))
            }
            Err(e) => {
                tracing::warn!(error = %e, "SIU v2 SITU inference failed");
                None
            }
        }
    }

    /// Ask SITU whether a trigger should fire for the given event context.
    /// Returns true if SITU predicts the trigger SHOULD fire (or if SITU is unavailable/uncertain).
    /// Returns false only if SITU is confident the trigger will NOT fire.
    pub fn should_trigger_fire(&self, event: &str, memory_label: &str, trigger_name: &str,
                                filter_str: &str, memory_type: &str, heat: f32) -> bool {
        if self.situ_session.is_none() {
            return true; // No model → always evaluate (rule-based fallback)
        }

        let text = format!(
            "{}: {} [trigger: {}, filters: {}, mem_type: {}, heat={:.2}]",
            event, &memory_label[..memory_label.len().min(200)],
            trigger_name, filter_str, memory_type, heat
        );

        match self.run_situ(&text) {
            Some((label, confidence)) => {
                if label == "no_fire" && confidence >= self.min_situ_skip_confidence {
                    tracing::debug!(
                        trigger = %trigger_name,
                        confidence,
                        "SITU: skipping trigger (predicted no_fire with high confidence)"
                    );
                    false
                } else {
                    true // fire or low confidence → evaluate normally
                }
            }
            None => true, // inference failed → evaluate normally
        }
    }

    /// Run SICU (type classifier) only.
    pub fn run_sicu(&self, text: &str) -> Option<(String, f32, HashMap<String, f32>)> {
        let mut session = self.sicu_session.lock().ok()?;
        let result = run_string_model(&mut session, text);
        match result {
            Ok((label, probs)) => {
                let confidence = probs.get(&label).copied().unwrap_or(0.0);
                tracing::debug!(label = %label, confidence, probs = ?probs, "SIU v2 SICU result");
                Some((label, confidence, probs))
            }
            Err(e) => {
                tracing::warn!(error = %e, "SIU v2 SICU inference failed");
                None
            }
        }
    }
}

/// Run a string-input ONNX model and extract the output label + probability map.
fn run_string_model(
    session: &mut ort::session::Session,
    text: &str,
) -> Result<(String, HashMap<String, f32>), Box<dyn std::error::Error + Send + Sync>> {
    use ort::value::Tensor;

    // Create string input tensor: shape [1, 1]
    let strings: Vec<String> = vec![text.to_string()];
    let input = Tensor::from_string_array(([1usize, 1], strings.as_slice()))?;

    // Run inference
    let outputs = session.run(ort::inputs![input])?;

    // Output 0: predicted label (string tensor)
    let label_output = &outputs[0];
    let label: String = label_output
        .try_extract_strings()
        .map(|(_, data)| data.into_iter().next().unwrap_or_default())
        .unwrap_or_default();

    // Output 1: probability map (sequence of maps: [{label: prob, ...}])
    // ort 2.0.0-rc.11 requires an allocator for sequence extraction
    let mut probs = HashMap::new();
    let allocator = ort::memory::Allocator::default();
    if let Ok(seq) = outputs[1].try_extract_sequence::<ort::value::DynValueTypeMarker>(&allocator) {
        if let Some(first_map) = seq.first() {
            if let Ok(map) = first_map.try_extract_map::<String, f32>() {
                for (k, v) in map.iter() {
                    probs.insert(k.clone(), *v);
                }
            }
        }
    }

    if probs.is_empty() {
        tracing::debug!("SIU v2: probability extraction fell back to empty map");
    }

    Ok((label, probs))
}

/// Load label map from JSON file.
fn load_labels(path: &Path) -> Option<HashMap<i64, String>> {
    let content = std::fs::read_to_string(path).ok()?;
    let raw: HashMap<String, String> = serde_json::from_str(&content).ok()?;
    Some(
        raw.into_iter()
            .filter_map(|(k, v)| k.parse::<i64>().ok().map(|idx| (idx, v)))
            .collect(),
    )
}

// ===========================================================================
// REST endpoint handlers
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /api/v2/siu/label — classify text through SIVU + SICU
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct LabelRequest {
    pub text: String,
    /// If true, only run SIVU (quality gate). Default: run both.
    #[serde(default)]
    pub quality_only: bool,
}

#[derive(Serialize)]
pub struct LabelResponse {
    pub quality: String,
    pub quality_confidence: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_confidence: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_probabilities: Option<HashMap<String, f32>>,
    pub model_version: String,
    pub engine: String,
}

pub async fn label(
    State(state): State<SharedState>,
    Extension(_tenant): Extension<TenantContext>,
    Json(body): Json<LabelRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    // Try v2 (ONNX) first
    if let Some(ref v2) = state.siu_v2_classifier {
        if body.quality_only {
            if let Some((quality, confidence)) = v2.run_sivu(&body.text) {
                return (StatusCode::OK, Json(serde_json::json!({
                    "quality": quality,
                    "quality_confidence": confidence,
                    "model_version": "v2.0-base",
                    "engine": "onnx",
                })));
            }
        } else if let Some(result) = v2.classify(&body.text) {
            return (StatusCode::OK, Json(serde_json::json!({
                "quality": result.quality,
                "quality_confidence": result.quality_confidence,
                "memory_type": result.memory_type,
                "type_confidence": result.type_confidence,
                "type_probabilities": result.type_probabilities,
                "model_version": "v2.0-base",
                "engine": "onnx",
            })));
        }
    }

    // Fall back to v1 (embedding-based, type classification only — no quality gate)
    if let Some(classification) = state.classify_memory(&body.text) {
        return (StatusCode::OK, Json(serde_json::json!({
            "quality": "store",
            "quality_confidence": 1.0,
            "memory_type": classification.memory_type,
            "type_confidence": classification.confidence,
            "model_version": "v1.0-json",
            "engine": "embedding",
        })));
    }

    (StatusCode::OK, Json(serde_json::json!({
        "quality": "store",
        "quality_confidence": 0.0,
        "memory_type": "episodic",
        "type_confidence": 0.0,
        "model_version": "none",
        "engine": "fallback",
    })))
}

// ---------------------------------------------------------------------------
// POST /api/v2/siu/signal — record a training signal (user/agent correction)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SignalRequest {
    /// UUID of the memory being corrected
    #[serde(alias = "node_id")]
    pub memory_id: String,
    /// Signal type: "reclassify", "accept", "reject", "override"
    #[serde(alias = "signal")]
    pub signal_type: String,
    /// What the model originally predicted
    #[serde(default)]
    pub predicted_type: Option<String>,
    /// Whether the model originally said to store
    #[serde(default)]
    pub predicted_store: Option<bool>,
    /// Model confidence at prediction time
    #[serde(default)]
    pub predicted_conf: Option<f32>,
    /// What the human/agent corrected to (for reclassify)
    #[serde(default)]
    pub corrected_type: Option<String>,
    /// For SIVU overrides: should it have been stored?
    #[serde(default)]
    pub corrected_store: Option<bool>,
    /// Snapshot of the content at correction time
    #[serde(default)]
    pub content_snapshot: Option<String>,
    /// Source: "plugin", "dashboard", "api", "mcp"
    #[serde(default = "default_source")]
    pub source: String,
    /// Optional namespace context
    #[serde(default)]
    pub namespace: Option<String>,
}

fn default_source() -> String {
    "api".to_string()
}

const VALID_SIGNAL_TYPES: &[&str] = &["reclassify", "accept", "reject", "override", "disagree"];
const VALID_MEMORY_TYPES: &[&str] = &["episodic", "fact", "preference", "procedural", "semantic"];

pub async fn record_signal(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Json(body): Json<SignalRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    // Validate signal_type
    if !VALID_SIGNAL_TYPES.contains(&body.signal_type.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": format!("invalid signal_type: {}. Must be one of: {:?}", body.signal_type, VALID_SIGNAL_TYPES),
        })));
    }

    // Validate corrected_type if present
    if let Some(ref ct) = body.corrected_type {
        if !VALID_MEMORY_TYPES.contains(&ct.as_str()) {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
                "error": format!("invalid corrected_type: {}. Must be one of: {:?}", ct, VALID_MEMORY_TYPES),
            })));
        }
    }

    // Parse memory_id
    let memory_id = match uuid::Uuid::parse_str(&body.memory_id) {
        Ok(id) => id,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "invalid memory_id: must be a valid UUID",
        }))),
    };

    let result = sqlx::query(
        "INSERT INTO training_signals \
            (memory_id, tenant_id, namespace, signal_type, \
             predicted_type, predicted_store, predicted_conf, \
             corrected_type, corrected_store, content_snapshot, source) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"
    )
    .bind(memory_id)
    .bind(&tenant.id)
    .bind(&body.namespace)
    .bind(&body.signal_type)
    .bind(&body.predicted_type)
    .bind(body.predicted_store)
    .bind(body.predicted_conf)
    .bind(&body.corrected_type)
    .bind(body.corrected_store)
    .bind(&body.content_snapshot)
    .bind(&body.source)
    .execute(&state.pool)
    .await;

    match result {
        Ok(_) => {
            tracing::info!(
                tenant = %tenant.id,
                memory_id = %body.memory_id,
                signal_type = %body.signal_type,
                "SIU training signal recorded"
            );
            (StatusCode::CREATED, Json(serde_json::json!({
                "ok": true,
                "signal_type": body.signal_type,
                "memory_id": body.memory_id,
            })))
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to record training signal");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                "error": e.to_string(),
            })))
        }
    }
}

// ---------------------------------------------------------------------------
// GET /api/v2/siu/signals — list training signals for this tenant
// ---------------------------------------------------------------------------

pub async fn list_signals(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Query(params): Query<ListSignalsParams>,
) -> (StatusCode, Json<serde_json::Value>) {
    let limit = params.limit.unwrap_or(50).min(200);
    let offset = params.offset.unwrap_or(0);

    let rows = sqlx::query_as::<_, SignalRow>(
        "SELECT id, memory_id, signal_type, predicted_type, predicted_store, predicted_conf, \
                corrected_type, corrected_store, source, created_at \
         FROM training_signals \
         WHERE tenant_id = $1 \
         ORDER BY created_at DESC \
         LIMIT $2 OFFSET $3"
    )
    .bind(&tenant.id)
    .bind(limit as i64)
    .bind(offset as i64)
    .fetch_all(&state.pool)
    .await;

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM training_signals WHERE tenant_id = $1"
    )
    .bind(&tenant.id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    match rows {
        Ok(signals) => {
            let items: Vec<serde_json::Value> = signals.iter().map(|s| serde_json::json!({
                "id": s.id,
                "memory_id": s.memory_id,
                "signal_type": s.signal_type,
                "predicted_type": s.predicted_type,
                "predicted_store": s.predicted_store,
                "predicted_conf": s.predicted_conf,
                "corrected_type": s.corrected_type,
                "corrected_store": s.corrected_store,
                "source": s.source,
                "created_at": s.created_at.to_rfc3339(),
            })).collect();

            (StatusCode::OK, Json(serde_json::json!({
                "signals": items,
                "total": count,
                "limit": limit,
                "offset": offset,
            })))
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to list training signals");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                "error": e.to_string(),
            })))
        }
    }
}

#[derive(Deserialize)]
pub struct ListSignalsParams {
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

#[derive(sqlx::FromRow)]
struct SignalRow {
    id: uuid::Uuid,
    memory_id: uuid::Uuid,
    signal_type: String,
    predicted_type: Option<String>,
    predicted_store: Option<bool>,
    predicted_conf: Option<f32>,
    corrected_type: Option<String>,
    corrected_store: Option<bool>,
    source: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
}

// ---------------------------------------------------------------------------
// GET /api/v2/siu/status — SIU system status
// ---------------------------------------------------------------------------

pub async fn status(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
) -> (StatusCode, Json<serde_json::Value>) {
    let v1_available = state.siu_available();
    let v2_available = state.siu_v2_available();
    let situ_available = state.siu_v2_classifier.as_ref()
        .map(|c| c.situ_available()).unwrap_or(false);

    // Count training signals for this tenant
    let signal_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM training_signals WHERE tenant_id = $1"
    )
    .bind(&tenant.id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    // Count per signal type
    let signal_breakdown = sqlx::query_as::<_, (String, i64)>(
        "SELECT signal_type, COUNT(*) as cnt \
         FROM training_signals \
         WHERE tenant_id = $1 \
         GROUP BY signal_type"
    )
    .bind(&tenant.id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let breakdown: HashMap<String, i64> = signal_breakdown.into_iter().collect();

    // Trigger feedback stats (for SITU training readiness)
    let trigger_fire_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM trigger_log WHERE tenant_id = $1"
    )
    .bind(&tenant.id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    // Query may fail if migration hasn't run yet — that's fine
    let trigger_feedback_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM trigger_feedback WHERE tenant_id = $1"
    )
    .bind(&tenant.id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    // SIRU recall session stats (adaptive scoring training data)
    let recall_session_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM recall_sessions WHERE tenant_id = $1"
    )
    .bind(&tenant.id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    let recall_avg_candidates: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(candidates_total), 0) FROM recall_sessions WHERE tenant_id = $1"
    )
    .bind(&tenant.id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0.0);

    let recall_avg_selected: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(candidates_selected), 0) FROM recall_sessions WHERE tenant_id = $1"
    )
    .bind(&tenant.id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0.0);

    let siru_minimum_sessions: i64 = 20;
    let siru_ready = recall_session_count >= siru_minimum_sessions;

    // Task 78: dynamically check if python3 + training scripts exist in this container
    let retrain_available = {
        let training_dir = std::path::Path::new("/opt/sulcus/training");
        std::process::Command::new("python3")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
            && training_dir.exists()
    };

    (StatusCode::OK, Json(serde_json::json!({
        "sivu": {
            "available": v2_available,
            "engine": if v2_available { "onnx" } else if v1_available { "json-fallback" } else { "none" },
            "model_version": if v2_available { "v2.0-base" } else if v1_available { "v1.0-json" } else { "none" },
        },
        "sicu": {
            "available": v2_available,
            "engine": if v2_available { "onnx" } else if v1_available { "json-fallback" } else { "none" },
            "model_version": if v2_available { "v2.0-base" } else if v1_available { "v1.0-json" } else { "none" },
        },
        "situ": {
            "available": situ_available,
            "engine": if situ_available { "onnx" } else { "rule-based-fallback" },
            "model_version": if situ_available { "v1.0-base" } else { "none" },
            "training_readiness": {
                "trigger_fires": trigger_fire_count,
                "trigger_feedback": trigger_feedback_count,
                "estimated_ready": trigger_feedback_count >= 200,
                "minimum_signals_needed": 200,
            },
        },
        "siru": {
            "available": siru_ready,
            "engine": if siru_ready { "adaptive-weights" } else { "heuristic-defaults" },
            "model_version": if siru_ready { "v1.0-trained" } else { "none" },
            "training_readiness": {
                "recall_sessions": recall_session_count,
                "estimated_ready": siru_ready,
                "minimum_sessions_needed": siru_minimum_sessions,
                "avg_candidates_per_session": (recall_avg_candidates * 100.0).round() / 100.0,
                "avg_selected_per_session": (recall_avg_selected * 100.0).round() / 100.0,
            },
        },
        "multimind": {
            "models": ["sivu", "sicu", "situ", "siru"],
            "registry_loaded": v2_available,
        },
        "training_signals": {
            "total": signal_count,
            "breakdown": breakdown,
        },
        "retrain": {
            "available": retrain_available,
            "reason": "POST /api/v2/siu/retrain to trigger (requires python3 + training scripts in container)",
        },
    })))
}

// ---------------------------------------------------------------------------
// POST /api/v2/siu/retrain — trigger model retraining
// ---------------------------------------------------------------------------
//
// Behaviour:
//   1. Count training_signals for this tenant.
//   2. If < 10, return insufficient_data (same as before).
//   3. Export full signals (including content_snapshot) to a temp JSONL file.
//   4. Check whether Python3 and the training scripts are available.
//      - If NOT available (bare metal, local dev) → return export_ready as before.
//      - If available → spawn `python3 train_<model>.py` as a background tokio task.
//   5. Return immediately with status = "retrain_started" (non-blocking).
//
// Training scripts: /opt/sulcus/training/train_{sivu,sicu,siru,situ}.py
// Model output dir: $SIU_V2_MODEL_DIR (default /opt/sulcus/models/siu-v2/)
// Temp data dir:    /tmp/sulcus-retrain/<tenant_id>/

pub async fn retrain(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Json(body): Json<RetrainRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let signal_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM training_signals WHERE tenant_id = $1"
    )
    .bind(&tenant.id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    let model = body.model.as_deref().unwrap_or("all").to_string();

    if signal_count < 10 {
        return (StatusCode::OK, Json(serde_json::json!({
            "status": "insufficient_data",
            "model": model,
            "signal_count": signal_count,
            "minimum_required": 10,
            "message": "Need at least 10 training signals before retraining",
        })));
    }

    // Fetch all signals including content (training data, not exposed in JSON response)
    let signals = sqlx::query_as::<_, TrainExportRow>(
        "SELECT signal_type, predicted_type, predicted_store, corrected_type, corrected_store, content_snapshot \
         FROM training_signals \
         WHERE tenant_id = $1 \
         ORDER BY created_at"
    )
    .bind(&tenant.id)
    .fetch_all(&state.pool)
    .await;

    let rows = match signals {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                "error": e.to_string(),
            })));
        }
    };

    // Check if Python retrain is available in this environment
    let training_dir = std::path::Path::new("/opt/sulcus/training");
    let python_available = std::process::Command::new("python3")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
        && training_dir.exists();

    if !python_available {
        // Local/dev environment — export signals only (original behaviour)
        let export: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
            "signal_type": r.signal_type,
            "predicted_type": r.predicted_type,
            "predicted_store": r.predicted_store,
            "corrected_type": r.corrected_type,
            "corrected_store": r.corrected_store,
            "text_hash": r.content_snapshot.as_ref().map(|t| {
                use std::collections::hash_map::DefaultHasher;
                use std::hash::{Hash, Hasher};
                let mut h = DefaultHasher::new();
                t.hash(&mut h);
                format!("{:016x}", h.finish())
            }),
            "text_length": r.content_snapshot.as_ref().map(|t| t.len()),
        })).collect();

        return (StatusCode::OK, Json(serde_json::json!({
            "status": "export_ready",
            "model": model,
            "signal_count": signal_count,
            "training_data": export,
            "message": "Training data exported (python3/training scripts not available in this environment — use offline retrain).",
        })));
    }

    // Write signals to temp JSONL files for Python trainer
    let work_dir = format!("/tmp/sulcus-retrain/{}", tenant.id);
    if let Err(e) = std::fs::create_dir_all(&work_dir) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
            "error": format!("Failed to create work dir: {}", e),
        })));
    }

    // Partition signals by type for each model's trainer
    // SIVU needs store/reject signals (predicted_store present)
    // SICU needs type classification signals (corrected_type present)
    // SIRU needs recall relevance signals (signal_type = recall_*)
    let (sivu_rows, sicu_rows, siru_rows): (Vec<_>, Vec<_>, Vec<_>) = {
        let mut sivu = Vec::new();
        let mut sicu = Vec::new();
        let mut siru = Vec::new();
        for r in &rows {
            match r.signal_type.as_str() {
                s if s.starts_with("store") || s == "reject" => sivu.push(r),
                s if s.starts_with("reclassify") || s == "disagree" => sicu.push(r),
                s if s.starts_with("recall") => siru.push(r),
                _ => {},
            }
        }
        (sivu, sicu, siru)
    };

    // Write SIVU training data (store vs reject)
    let sivu_train = format!("{}/sivu_train.jsonl", work_dir);
    let sivu_test = format!("{}/sivu_test.jsonl", work_dir);
    write_siu_jsonl_store(&sivu_train, &sivu_rows);
    let _ = std::fs::copy(&sivu_train, &sivu_test);

    // Write SICU training data (memory type classification)
    let sicu_train = format!("{}/sicu_train.jsonl", work_dir);
    let sicu_test = format!("{}/sicu_test.jsonl", work_dir);
    write_siu_jsonl_type(&sicu_train, &sicu_rows);
    let _ = std::fs::copy(&sicu_train, &sicu_test);

    // Write SIRU training data (recall relevance)
    let siru_train = format!("{}/siru_train.jsonl", work_dir);
    let siru_test = format!("{}/siru_test.jsonl", work_dir);
    write_siu_jsonl_recall(&siru_train, &siru_rows);
    let _ = std::fs::copy(&siru_train, &siru_test);

    let model_dir = std::env::var("SIU_V2_MODEL_DIR").unwrap_or_else(|_| "/opt/sulcus/models/siu-v2".to_string());
    let work_dir_clone = work_dir.clone();
    let model_dir_clone = model_dir.clone();
    let model_clone = model.clone();

    // Spawn retrain as a background tokio task — returns immediately
    tokio::spawn(async move {
        let models_to_train: Vec<&str> = match model_clone.as_str() {
            "sivu" => vec!["sivu"],
            "sicu" => vec!["sicu"],
            "siru" => vec!["siru"],
            "situ" => vec!["situ"],
            _ => vec!["sivu", "sicu", "siru"],
        };

        for m in models_to_train {
            let script = format!("/opt/sulcus/training/train_{}.py", m);
            if !std::path::Path::new(&script).exists() {
                tracing::warn!(model = m, "retrain script not found: {}", script);
                continue;
            }

            let (train_file, test_file) = match m {
                "sivu" => (format!("{}/sivu_train.jsonl", work_dir_clone), format!("{}/sivu_test.jsonl", work_dir_clone)),
                "sicu" => (format!("{}/sicu_train.jsonl", work_dir_clone), format!("{}/sicu_test.jsonl", work_dir_clone)),
                "siru" => (format!("{}/siru_train.jsonl", work_dir_clone), format!("{}/siru_test.jsonl", work_dir_clone)),
                _ => continue, // situ needs its own signal format
            };

            let output_model = format!("{}/{}_model.onnx", model_dir_clone, m);
            let output_labels = format!("{}/{}_model_labels.json", model_dir_clone, m);

            tracing::info!(model = m, "starting retrain");
            let result = tokio::process::Command::new("python3")
                .arg(&script)
                .arg("--train").arg(&train_file)
                .arg("--test").arg(&test_file)
                .arg("--output").arg(&output_model)
                .arg("--labels-output").arg(&output_labels)
                .output()
                .await;

            match result {
                Ok(out) if out.status.success() => {
                    tracing::info!(model = m, "retrain complete — model updated at {}", output_model);
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    tracing::warn!(model = m, exit_code = ?out.status.code(), stderr = %stderr, "retrain failed");
                }
                Err(e) => {
                    tracing::error!(model = m, error = %e, "retrain spawn failed");
                }
            }
        }

        // Cleanup temp files
        let _ = std::fs::remove_dir_all(&work_dir_clone);
    });

    (StatusCode::OK, Json(serde_json::json!({
        "status": "retrain_started",
        "model": model,
        "signal_count": signal_count,
        "message": "Retraining started in background. New ONNX models will be written to model dir when complete.",
        "model_dir": model_dir,
    })))
}

#[derive(Deserialize)]
pub struct RetrainRequest {
    /// Which model to retrain: "sivu", "sicu", "situ", or "all"
    pub model: Option<String>,
}

#[derive(sqlx::FromRow)]
struct TrainExportRow {
    signal_type: String,
    predicted_type: Option<String>,
    predicted_store: Option<bool>,
    corrected_type: Option<String>,
    corrected_store: Option<bool>,
    content_snapshot: Option<String>,
}

// ---------------------------------------------------------------------------
// JSONL writers for retrain data export
// ---------------------------------------------------------------------------

/// Write SIVU training data (store vs reject) to a JSONL file.
fn write_siu_jsonl_store(path: &str, rows: &[&TrainExportRow]) {
    use std::io::Write;
    let Ok(mut f) = std::fs::File::create(path) else { return; };
    for row in rows {
        let Some(text) = row.content_snapshot.as_ref() else { continue; };
        let label = if row.corrected_store.unwrap_or(row.predicted_store.unwrap_or(true)) {
            "store"
        } else {
            "reject"
        };
        let _ = writeln!(f, "{}", serde_json::json!({"text": text, "label": label}));
    }
}

/// Write SICU training data (memory type classification) to a JSONL file.
fn write_siu_jsonl_type(path: &str, rows: &[&TrainExportRow]) {
    use std::io::Write;
    let Ok(mut f) = std::fs::File::create(path) else { return; };
    for row in rows {
        let Some(text) = row.content_snapshot.as_ref() else { continue; };
        let Some(label) = row.corrected_type.as_ref().or(row.predicted_type.as_ref()) else { continue; };
        let _ = writeln!(f, "{}", serde_json::json!({"text": text, "label": label}));
    }
}

/// Write SIRU training data (recall relevance) to a JSONL file.
fn write_siu_jsonl_recall(path: &str, rows: &[&TrainExportRow]) {
    use std::io::Write;
    let Ok(mut f) = std::fs::File::create(path) else { return; };
    for row in rows {
        let Some(text) = row.content_snapshot.as_ref() else { continue; };
        let label = match row.signal_type.as_str() {
            "recall_relevant" => "include",
            "recall_irrelevant" => "drop",
            _ => "include",
        };
        let _ = writeln!(f, "{}", serde_json::json!({"text": text, "label": label}));
    }
}
