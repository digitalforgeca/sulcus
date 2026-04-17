//! SIRU — Sulcusian Intelligence Recall Unit
//!
//! Learns which memories are most useful for a given query by accumulating
//! recall session data and training per-tenant scoring weights.
//!
//! # Architecture
//!
//! The plugin-side recall pipeline (multi-signal retrieval + composite scoring)
//! uses heuristic weights by default: similarity(0.40) + heat(0.30) + recency(0.20)
//! + source_boost(0.10). As recall sessions accumulate, SIRU analyzes which
//! memories were actually helpful (via implicit signals like recall frequency
//! and explicit feedback) and optimizes the weights per tenant/namespace.
//!
//! # Endpoints
//!
//! - `POST /api/v1/agent/recall-log` — log a recall session (plugin → server)
//! - `POST /api/v1/agent/recall-feedback` — submit feedback on a recall session
//! - `GET  /api/v1/agent/recall-weights` — get current scoring weights
//! - `POST /api/v2/siu/retrain` (model=siru) — trigger SIRU weight optimization

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use crate::SharedState;
use crate::middleware::TenantContext;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RecallSessionLog {
    pub namespace: Option<String>,
    pub agent_id: Option<String>,
    pub query_text: String,
    pub memory_ids: Vec<String>,
    pub memory_scores: Vec<f32>,
    pub memory_sources: Vec<String>,
    pub token_budget: i32,
    pub tokens_used: i32,
    pub candidates_total: i32,
    pub candidates_selected: i32,
    pub semantic_count: Option<i32>,
    pub hot_count: Option<i32>,
    pub entity_count: Option<i32>,
    pub entity_hints: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct RecallFeedback {
    pub session_id: i64,
    pub signal: String,  // "helpful" | "unhelpful" | "partial"
}

#[derive(Debug, Serialize)]
pub struct RecallWeights {
    pub similarity_weight: f32,
    pub heat_weight: f32,
    pub recency_weight: f32,
    pub source_boost_semantic: f32,
    pub source_boost_hot: f32,
    pub source_boost_entity: f32,
    pub source_boost_profile: f32,
    pub model_version: i32,
    pub trained_from: i32,
    pub trained_at: Option<chrono::DateTime<chrono::Utc>>,
    pub source: String,  // "default" | "learned"
}

// ─── Default weights (heuristic baseline) ─────────────────────────────────────

const DEFAULT_SIMILARITY: f32 = 0.40;
const DEFAULT_HEAT: f32 = 0.30;
const DEFAULT_RECENCY: f32 = 0.20;
const DEFAULT_SOURCE_SEMANTIC: f32 = 0.00;
const DEFAULT_SOURCE_HOT: f32 = 0.05;
const DEFAULT_SOURCE_ENTITY: f32 = 0.10;
const DEFAULT_SOURCE_PROFILE: f32 = 0.15;

// ─── POST /api/v1/agent/recall-log ───────────────────────────────────────────

pub async fn log_recall_session(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Json(body): Json<RecallSessionLog>,
) -> (StatusCode, Json<serde_json::Value>) {
    let pool = &state.pool;

    let result = sqlx::query(
        "INSERT INTO recall_sessions \
            (tenant_id, namespace, agent_id, query_text, entity_hints, \
             token_budget, tokens_used, candidates_total, candidates_selected, \
             semantic_count, hot_count, entity_count, \
             memory_ids, memory_scores, memory_sources) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) \
         RETURNING id"
    )
    .bind(&tenant.id)
    .bind(&body.namespace)
    .bind(&body.agent_id)
    .bind(&body.query_text)
    .bind(&body.entity_hints.unwrap_or_default())
    .bind(body.token_budget)
    .bind(body.tokens_used)
    .bind(body.candidates_total)
    .bind(body.candidates_selected)
    .bind(body.semantic_count.unwrap_or(0))
    .bind(body.hot_count.unwrap_or(0))
    .bind(body.entity_count.unwrap_or(0))
    .bind(&body.memory_ids)
    .bind(&body.memory_scores)
    .bind(&body.memory_sources)
    .fetch_one(pool)
    .await;

    match result {
        Ok(row) => {
            let id: i64 = sqlx::Row::get(&row, "id");
            tracing::debug!(
                tenant = %tenant.id,
                session_id = id,
                candidates = body.candidates_total,
                selected = body.candidates_selected,
                "SIRU: recall session logged"
            );
            (StatusCode::OK, Json(serde_json::json!({
                "ok": true,
                "session_id": id,
            })))
        }
        Err(e) => {
            tracing::warn!(error = %e, "SIRU: failed to log recall session");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                "error": e.to_string(),
            })))
        }
    }
}

// ─── POST /api/v1/agent/recall-feedback ──────────────────────────────────────

pub async fn recall_feedback(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Json(body): Json<RecallFeedback>,
) -> (StatusCode, Json<serde_json::Value>) {
    let pool = &state.pool;

    let valid_signals = ["helpful", "unhelpful", "partial"];
    if !valid_signals.contains(&body.signal.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": format!("invalid signal: {}. Must be one of: {:?}", body.signal, valid_signals),
        })));
    }

    let result = sqlx::query(
        "UPDATE recall_sessions SET feedback_signal = $1, feedback_at = now() \
         WHERE id = $2 AND tenant_id = $3"
    )
    .bind(&body.signal)
    .bind(body.session_id)
    .bind(&tenant.id)
    .execute(pool)
    .await;

    match result {
        Ok(r) => {
            if r.rows_affected() == 0 {
                return (StatusCode::NOT_FOUND, Json(serde_json::json!({
                    "error": "recall session not found",
                })));
            }
            tracing::info!(
                tenant = %tenant.id,
                session_id = body.session_id,
                signal = %body.signal,
                "SIRU: recall feedback recorded"
            );
            (StatusCode::OK, Json(serde_json::json!({
                "ok": true,
                "session_id": body.session_id,
                "signal": body.signal,
            })))
        }
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                "error": e.to_string(),
            })))
        }
    }
}

// ─── GET /api/v1/agent/recall-weights ────────────────────────────────────────

pub async fn get_recall_weights(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> (StatusCode, Json<serde_json::Value>) {
    let pool = &state.pool;
    let namespace = params.get("namespace");

    // Try namespace-specific weights first, fall back to tenant-wide
    let row = if let Some(ns) = namespace {
        sqlx::query_as::<_, WeightsRow>(
            "SELECT similarity_weight, heat_weight, recency_weight, \
                    source_boost_semantic, source_boost_hot, source_boost_entity, source_boost_profile, \
                    model_version, trained_from, trained_at \
             FROM siru_weights \
             WHERE tenant_id = $1 AND (namespace = $2 OR namespace IS NULL) \
             ORDER BY namespace NULLS LAST \
             LIMIT 1"
        )
        .bind(&tenant.id)
        .bind(ns)
        .fetch_optional(pool)
        .await
    } else {
        sqlx::query_as::<_, WeightsRow>(
            "SELECT similarity_weight, heat_weight, recency_weight, \
                    source_boost_semantic, source_boost_hot, source_boost_entity, source_boost_profile, \
                    model_version, trained_from, trained_at \
             FROM siru_weights \
             WHERE tenant_id = $1 AND namespace IS NULL \
             LIMIT 1"
        )
        .bind(&tenant.id)
        .fetch_optional(pool)
        .await
    };

    match row {
        Ok(Some(w)) => {
            (StatusCode::OK, Json(serde_json::json!({
                "ok": true,
                "weights": RecallWeights {
                    similarity_weight: w.similarity_weight,
                    heat_weight: w.heat_weight,
                    recency_weight: w.recency_weight,
                    source_boost_semantic: w.source_boost_semantic,
                    source_boost_hot: w.source_boost_hot,
                    source_boost_entity: w.source_boost_entity,
                    source_boost_profile: w.source_boost_profile,
                    model_version: w.model_version,
                    trained_from: w.trained_from,
                    trained_at: w.trained_at,
                    source: "learned".to_string(),
                },
            })))
        }
        Ok(None) => {
            // No trained weights — return defaults
            (StatusCode::OK, Json(serde_json::json!({
                "ok": true,
                "weights": RecallWeights {
                    similarity_weight: DEFAULT_SIMILARITY,
                    heat_weight: DEFAULT_HEAT,
                    recency_weight: DEFAULT_RECENCY,
                    source_boost_semantic: DEFAULT_SOURCE_SEMANTIC,
                    source_boost_hot: DEFAULT_SOURCE_HOT,
                    source_boost_entity: DEFAULT_SOURCE_ENTITY,
                    source_boost_profile: DEFAULT_SOURCE_PROFILE,
                    model_version: 0,
                    trained_from: 0,
                    trained_at: None,
                    source: "default".to_string(),
                },
            })))
        }
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                "error": e.to_string(),
            })))
        }
    }
}

// ─── SIRU Training: Optimize weights from recall session data ─────────────────

/// Analyzes accumulated recall sessions to compute optimized scoring weights.
/// 
/// Strategy: Look at recall sessions with feedback, plus implicit signals
/// (memories that are recalled frequently = probably useful). Weight optimization
/// uses a simple gradient-free approach:
///
/// 1. Group recall sessions by signal source distribution
/// 2. For sessions with "helpful" feedback, increase weights for dominant sources
/// 3. For sessions with "unhelpful" feedback, decrease those weights
/// 4. For implicit signal (no feedback), use recall frequency as a proxy
/// 5. Normalize weights to sum to ~1.0 (excluding source boosts)
/// 6. Clamp all values to sensible ranges
pub async fn train_siru(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    namespace: Option<&str>,
) -> Result<SiruTrainResult, String> {

    // Count available sessions
    let session_count: i64 = if let Some(ns) = namespace {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM recall_sessions WHERE tenant_id = $1 AND namespace = $2"
        )
        .bind(tenant_id).bind(ns)
        .fetch_one(pool).await.unwrap_or(0)
    } else {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM recall_sessions WHERE tenant_id = $1"
        )
        .bind(tenant_id)
        .fetch_one(pool).await.unwrap_or(0)
    };

    if session_count < 20 {
        return Err(format!(
            "Insufficient data: {} recall sessions (need ≥20). \
             Keep using memory_recall — sessions are logged automatically.",
            session_count
        ));
    }

    // ── Step 1: Analyze source distribution in helpful vs unhelpful sessions ──

    // Sessions WITH explicit feedback (gold signal)
    let feedback_stats = sqlx::query_as::<_, FeedbackStats>(
        "SELECT \
            feedback_signal, \
            COUNT(*) AS count, \
            AVG(semantic_count::real / GREATEST(candidates_selected, 1)) AS avg_semantic_ratio, \
            AVG(hot_count::real / GREATEST(candidates_selected, 1)) AS avg_hot_ratio, \
            AVG(entity_count::real / GREATEST(candidates_selected, 1)) AS avg_entity_ratio, \
            AVG(tokens_used::real / GREATEST(token_budget, 1)) AS avg_budget_usage \
         FROM recall_sessions \
         WHERE tenant_id = $1 \
           AND ($2::text IS NULL OR namespace = $2) \
           AND feedback_signal IS NOT NULL \
         GROUP BY feedback_signal"
    )
    .bind(tenant_id)
    .bind(namespace)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // ── Step 2: Analyze recall frequency patterns (implicit signal) ──────────

    // Memories recalled frequently across sessions are probably good matches
    let freq_analysis = sqlx::query_as::<_, FreqAnalysis>(
        "WITH expanded AS ( \
            SELECT unnest(memory_ids) AS mid, unnest(memory_sources) AS src \
            FROM recall_sessions \
            WHERE tenant_id = $1 AND ($2::text IS NULL OR namespace = $2) \
              AND created_at > now() - INTERVAL '30 days' \
         ) \
         SELECT src, COUNT(*) AS cnt, COUNT(DISTINCT mid) AS unique_mems \
         FROM expanded \
         GROUP BY src \
         ORDER BY cnt DESC"
    )
    .bind(tenant_id)
    .bind(namespace)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // ── Step 3: Compute optimized weights ────────────────────────────────────

    let mut sim_w = DEFAULT_SIMILARITY;
    let mut heat_w = DEFAULT_HEAT;
    let mut rec_w = DEFAULT_RECENCY;
    let mut boost_semantic = DEFAULT_SOURCE_SEMANTIC;
    let mut boost_hot = DEFAULT_SOURCE_HOT;
    let mut boost_entity = DEFAULT_SOURCE_ENTITY;
    let mut boost_profile = DEFAULT_SOURCE_PROFILE;

    let has_feedback = !feedback_stats.is_empty();

    if has_feedback {
        // Use explicit feedback to adjust weights
        let helpful = feedback_stats.iter().find(|f| f.feedback_signal == "helpful");
        let unhelpful = feedback_stats.iter().find(|f| f.feedback_signal == "unhelpful");

        if let Some(h) = helpful {
            // High semantic ratio in helpful sessions → boost similarity weight
            sim_w += (h.avg_semantic_ratio as f32 - 0.5) * 0.15;
            // High hot ratio → boost heat weight
            heat_w += (h.avg_hot_ratio as f32 - 0.3) * 0.10;
            // High entity ratio → boost entity source boost
            boost_entity += (h.avg_entity_ratio as f32 - 0.1) * 0.10;
        }

        if let Some(u) = unhelpful {
            // High semantic ratio in unhelpful → reduce similarity weight slightly
            sim_w -= (u.avg_semantic_ratio as f32 - 0.5) * 0.10;
            heat_w -= (u.avg_hot_ratio as f32 - 0.3) * 0.05;
        }
    }

    // Use frequency analysis to adjust source boosts
    let total_freq: i64 = freq_analysis.iter().map(|f| f.cnt).sum();
    if total_freq > 0 {
        for fa in &freq_analysis {
            let ratio = fa.cnt as f32 / total_freq as f32;
            // Sources that contribute more unique memories get a slight boost
            let diversity = fa.unique_mems as f32 / fa.cnt.max(1) as f32;
            match fa.src.as_str() {
                "semantic" => boost_semantic += (ratio - 0.5) * diversity * 0.05,
                "hot" => boost_hot += (ratio - 0.2) * diversity * 0.05,
                "entity" => boost_entity += (ratio - 0.1) * diversity * 0.05,
                "profile" => boost_profile += (ratio - 0.2) * diversity * 0.05,
                _ => {}
            }
        }
    }

    // ── Step 4: Normalize and clamp ──────────────────────────────────────────

    // Core weights should sum to ~1.0
    let core_sum = sim_w + heat_w + rec_w;
    if core_sum > 0.0 {
        sim_w /= core_sum;
        heat_w /= core_sum;
        rec_w /= core_sum;
    }

    // Clamp to sensible ranges
    sim_w = sim_w.clamp(0.15, 0.70);
    heat_w = heat_w.clamp(0.10, 0.50);
    rec_w = rec_w.clamp(0.05, 0.40);
    boost_semantic = boost_semantic.clamp(-0.05, 0.15);
    boost_hot = boost_hot.clamp(0.0, 0.20);
    boost_entity = boost_entity.clamp(0.0, 0.25);
    boost_profile = boost_profile.clamp(0.05, 0.30);

    // Re-normalize core weights after clamping
    let core_sum = sim_w + heat_w + rec_w;
    sim_w /= core_sum;
    heat_w /= core_sum;
    rec_w /= core_sum;

    // ── Step 5: Upsert weights ───────────────────────────────────────────────

    let result = sqlx::query(
        "INSERT INTO siru_weights \
            (tenant_id, namespace, similarity_weight, heat_weight, recency_weight, \
             source_boost_semantic, source_boost_hot, source_boost_entity, source_boost_profile, \
             trained_from, model_version, trained_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, now(), now()) \
         ON CONFLICT (tenant_id, namespace) DO UPDATE SET \
            similarity_weight = EXCLUDED.similarity_weight, \
            heat_weight = EXCLUDED.heat_weight, \
            recency_weight = EXCLUDED.recency_weight, \
            source_boost_semantic = EXCLUDED.source_boost_semantic, \
            source_boost_hot = EXCLUDED.source_boost_hot, \
            source_boost_entity = EXCLUDED.source_boost_entity, \
            source_boost_profile = EXCLUDED.source_boost_profile, \
            trained_from = EXCLUDED.trained_from, \
            model_version = siru_weights.model_version + 1, \
            trained_at = now(), \
            updated_at = now()"
    )
    .bind(tenant_id)
    .bind(namespace)
    .bind(sim_w)
    .bind(heat_w)
    .bind(rec_w)
    .bind(boost_semantic)
    .bind(boost_hot)
    .bind(boost_entity)
    .bind(boost_profile)
    .bind(session_count as i32)
    .execute(pool)
    .await;

    match result {
        Ok(_) => {
            tracing::info!(
                tenant = %tenant_id,
                namespace = ?namespace,
                sessions = session_count,
                sim = sim_w,
                heat = heat_w,
                recency = rec_w,
                has_feedback,
                "SIRU: weights trained"
            );

            Ok(SiruTrainResult {
                status: "trained".to_string(),
                sessions_used: session_count as i32,
                has_feedback,
                weights: RecallWeights {
                    similarity_weight: sim_w,
                    heat_weight: heat_w,
                    recency_weight: rec_w,
                    source_boost_semantic: boost_semantic,
                    source_boost_hot: boost_hot,
                    source_boost_entity: boost_entity,
                    source_boost_profile: boost_profile,
                    model_version: 0, // will be set by DB
                    trained_from: session_count as i32,
                    trained_at: Some(chrono::Utc::now()),
                    source: "learned".to_string(),
                },
            })
        }
        Err(e) => Err(format!("Failed to save SIRU weights: {e}")),
    }
}

// ─── Internal types ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SiruTrainResult {
    pub status: String,
    pub sessions_used: i32,
    pub has_feedback: bool,
    pub weights: RecallWeights,
}

#[derive(Debug, sqlx::FromRow)]
struct WeightsRow {
    similarity_weight: f32,
    heat_weight: f32,
    recency_weight: f32,
    source_boost_semantic: f32,
    source_boost_hot: f32,
    source_boost_entity: f32,
    source_boost_profile: f32,
    model_version: i32,
    trained_from: i32,
    trained_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, sqlx::FromRow, Default)]
struct FeedbackStats {
    feedback_signal: String,
    count: i64,
    avg_semantic_ratio: f64,
    avg_hot_ratio: f64,
    avg_entity_ratio: f64,
    avg_budget_usage: f64,
}

#[derive(Debug, sqlx::FromRow)]
struct FreqAnalysis {
    src: String,
    cnt: i64,
    unique_mems: i64,
}
