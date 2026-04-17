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

/// ONNX-based SIU v2 classifier. Holds both SIVU and SICU sessions.
/// Sessions are wrapped in Mutex because ort 2.0 requires `&mut self` for `run()`.
pub struct SiuV2Classifier {
    sivu_session: std::sync::Mutex<ort::session::Session>,
    sicu_session: std::sync::Mutex<ort::session::Session>,
    #[allow(dead_code)]
    sivu_labels: HashMap<i64, String>,
    #[allow(dead_code)]
    sicu_labels: HashMap<i64, String>,
    /// Minimum confidence to accept a reject decision (below this → default to store)
    min_reject_confidence: f32,
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
        let sivu_labels_path = dir.join("sivu_model_labels.json");
        let sicu_labels_path = dir.join("sicu_model_labels.json");

        // Verbose startup diagnostic — log existence + size of every expected file
        tracing::info!(
            model_dir = %dir.display(),
            dir_exists = dir.exists(),
            sivu_exists = sivu_path.exists(),
            sivu_bytes = sivu_path.metadata().map(|m| m.len()).unwrap_or(0),
            sicu_exists = sicu_path.exists(),
            sicu_bytes = sicu_path.metadata().map(|m| m.len()).unwrap_or(0),
            sivu_labels_exists = sivu_labels_path.exists(),
            sicu_labels_exists = sicu_labels_path.exists(),
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

        tracing::info!(
            sivu_labels = ?sivu_labels,
            sicu_labels = ?sicu_labels,
            "SIU v2 classifier loaded (ONNX) from {}",
            dir.display()
        );

        Some(Arc::new(Self {
            sivu_session: std::sync::Mutex::new(sivu_session),
            sicu_session: std::sync::Mutex::new(sicu_session),
            sivu_labels,
            sicu_labels,
            min_reject_confidence: 0.6,
        }))
    }

    /// Try to load ONNX models from a specific directory.
    /// Used for per-agent model repos.
    pub fn try_from_dir(dir: &Path) -> Option<Arc<Self>> {
        let sivu_path = dir.join("sivu_model.onnx");
        let sicu_path = dir.join("sicu_model.onnx");
        let sivu_labels_path = dir.join("sivu_model_labels.json");
        let sicu_labels_path = dir.join("sicu_model_labels.json");

        if !sivu_path.exists() || !sicu_path.exists() {
            return None;
        }

        let sivu_session = ort::session::Session::builder()
            .and_then(|b| b.commit_from_file(&sivu_path))
            .ok()?;
        let sicu_session = ort::session::Session::builder()
            .and_then(|b| b.commit_from_file(&sicu_path))
            .ok()?;

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

        tracing::info!("SIU v2: loaded per-agent model from {}", dir.display());
        Some(Arc::new(Self {
            sivu_session: std::sync::Mutex::new(sivu_session),
            sicu_session: std::sync::Mutex::new(sicu_session),
            sivu_labels, sicu_labels,
            min_reject_confidence: 0.6,
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
            "available": false,
            "engine": "rule-based-fallback",
            "model_version": "none",
            "training_readiness": {
                "trigger_fires": trigger_fire_count,
                "trigger_feedback": trigger_feedback_count,
                "estimated_ready": trigger_feedback_count >= 200,
                "minimum_signals_needed": 200,
            },
        },
        "training_signals": {
            "total": signal_count,
            "breakdown": breakdown,
        },
        "retrain": {
            "available": false,
            "reason": "server-side retraining not yet implemented — export signals + retrain offline",
        },
    })))
}

// ---------------------------------------------------------------------------
// POST /api/v2/siu/retrain — trigger model retraining
// ---------------------------------------------------------------------------

pub async fn retrain(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Json(body): Json<RetrainRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    // Count available signals
    let signal_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM training_signals WHERE tenant_id = $1"
    )
    .bind(&tenant.id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    let model = body.model.as_deref().unwrap_or("all");

    // ── SIRU: recall weight optimization ──────────────────────────────────
    if model == "siru" || model == "all" {
        match crate::siru::train_siru(&state.pool, &tenant.id, body.namespace.as_deref()).await {
            Ok(result) => {
                if model == "siru" {
                    return (StatusCode::OK, Json(serde_json::json!({
                        "status": result.status,
                        "model": "siru",
                        "sessions_used": result.sessions_used,
                        "has_feedback": result.has_feedback,
                        "weights": result.weights,
                    })));
                }
                // If model == "all", continue to SIVU/SICU training below
                tracing::info!(tenant = %tenant.id, "SIRU training completed as part of 'all'");
            }
            Err(e) => {
                if model == "siru" {
                    return (StatusCode::OK, Json(serde_json::json!({
                        "status": "insufficient_data",
                        "model": "siru",
                        "message": e,
                    })));
                }
                // If model == "all", log but continue
                tracing::info!(tenant = %tenant.id, reason = %e, "SIRU training skipped (continuing with SIVU/SICU)");
            }
        }
    }

    // For now: server-side SIVU/SICU retraining is not implemented.
    // This endpoint validates readiness and exports signals for offline retraining.
    // Future: run training in-process or spawn a job.
    if signal_count < 10 {
        return (StatusCode::OK, Json(serde_json::json!({
            "status": "insufficient_data",
            "model": model,
            "signal_count": signal_count,
            "minimum_required": 10,
            "message": "Need at least 10 training signals before retraining",
        })));
    }

    // Export signals as training data.
    // SECURITY: content_snapshot is stripped from API responses to prevent PII leakage.
    // Raw training data export is only available via direct DB access or admin CLI.
    let signals = sqlx::query_as::<_, TrainExportRow>(
        "SELECT signal_type, predicted_type, predicted_store, corrected_type, corrected_store, content_snapshot \
         FROM training_signals \
         WHERE tenant_id = $1 \
         ORDER BY created_at"
    )
    .bind(&tenant.id)
    .fetch_all(&state.pool)
    .await;

    match signals {
        Ok(rows) => {
            let export: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
                "signal_type": r.signal_type,
                "predicted_type": r.predicted_type,
                "predicted_store": r.predicted_store,
                "corrected_type": r.corrected_type,
                "corrected_store": r.corrected_store,
                // Redact content — only include a truncated hash for dedup reference
                "text_hash": r.content_snapshot.as_ref().map(|t| {
                    use std::collections::hash_map::DefaultHasher;
                    use std::hash::{Hash, Hasher};
                    let mut h = DefaultHasher::new();
                    t.hash(&mut h);
                    format!("{:016x}", h.finish())
                }),
                "text_length": r.content_snapshot.as_ref().map(|t| t.len()),
            })).collect();

            (StatusCode::OK, Json(serde_json::json!({
                "status": "export_ready",
                "model": model,
                "signal_count": signal_count,
                "training_data": export,
                "message": "Training data exported (content redacted). Use direct DB export for full training corpus.",
            })))
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
            "error": e.to_string(),
        }))),
    }
}

#[derive(Deserialize)]
pub struct RetrainRequest {
    /// Which model to retrain: "sivu", "sicu", "situ", "siru", or "all"
    pub model: Option<String>,
    /// Optional namespace for SIRU training (namespace-scoped weights)
    pub namespace: Option<String>,
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
