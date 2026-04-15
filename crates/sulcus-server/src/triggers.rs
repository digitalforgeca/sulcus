use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use sqlx::Row;

use crate::{middleware::TenantContext, SharedState};

/// GET /api/v1/triggers
pub async fn list_triggers(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
) -> Json<Value> {
    let rows = sqlx::query(
        "SELECT id, namespace, name, description, enabled, event, action, action_config, \
         filter_memory_type, filter_namespace, filter_label_pattern, \
         filter_heat_below, filter_heat_above, max_fires, fire_count, \
         cooldown_seconds, last_fired_at::text, created_at::text \
         FROM triggers WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(&tenant.id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let triggers: Vec<Value> = rows.iter().map(|r| json!({
        "id": r.try_get::<String, _>("id").unwrap_or_default(),
        "namespace": r.try_get::<String, _>("namespace").unwrap_or_default(),
        "name": r.try_get::<String, _>("name").unwrap_or_default(),
        "description": r.try_get::<String, _>("description").unwrap_or_default(),
        "enabled": r.try_get::<bool, _>("enabled").unwrap_or(true),
        "event": r.try_get::<String, _>("event").unwrap_or_default(),
        "action": r.try_get::<String, _>("action").unwrap_or_default(),
        "action_config": r.try_get::<Value, _>("action_config").unwrap_or(json!({})),
        "filters": {
            "memory_type": r.try_get::<Option<String>, _>("filter_memory_type").unwrap_or(None),
            "namespace": r.try_get::<Option<String>, _>("filter_namespace").unwrap_or(None),
            "label_pattern": r.try_get::<Option<String>, _>("filter_label_pattern").unwrap_or(None),
            "heat_below": r.try_get::<Option<f32>, _>("filter_heat_below").unwrap_or(None),
            "heat_above": r.try_get::<Option<f32>, _>("filter_heat_above").unwrap_or(None),
        },
        "max_fires": r.try_get::<Option<i32>, _>("max_fires").unwrap_or(None),
        "fire_count": r.try_get::<i32, _>("fire_count").unwrap_or(0),
        "cooldown_seconds": r.try_get::<i32, _>("cooldown_seconds").unwrap_or(0),
        "last_fired_at": r.try_get::<Option<String>, _>("last_fired_at").unwrap_or(None),
        "created_at": r.try_get::<Option<String>, _>("created_at").unwrap_or(None),
    })).collect();

    Json(json!({ "triggers": triggers, "count": triggers.len() }))
}

/// POST /api/v1/triggers
pub async fn create_trigger(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let event = body.get("event").and_then(|v| v.as_str()).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "missing event"})),
        )
    })?;
    let action = body.get("action").and_then(|v| v.as_str()).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "missing action"})),
        )
    })?;

    let id = uuid::Uuid::now_v7().to_string();
    let description = body
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let action_config = body.get("action_config").cloned().unwrap_or(json!({}));
    let filter_memory_type = body.get("filter_memory_type").and_then(|v| v.as_str());
    let filter_namespace = body.get("filter_namespace").and_then(|v| v.as_str());
    let filter_label_pattern = body.get("filter_label_pattern").and_then(|v| v.as_str());
    let filter_heat_below: Option<f32> = body
        .get("filter_heat_below")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32);
    let filter_heat_above: Option<f32> = body
        .get("filter_heat_above")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32);
    let max_fires: Option<i32> = body
        .get("max_fires")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let cooldown: i32 = body
        .get("cooldown_seconds")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let namespace = body
        .get("namespace")
        .and_then(|v| v.as_str())
        .unwrap_or("default");

    sqlx::query(
        "INSERT INTO triggers (id, tenant_id, namespace, name, description, event, action, action_config, \
         filter_memory_type, filter_namespace, filter_label_pattern, \
         filter_heat_below, filter_heat_above, max_fires, cooldown_seconds) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    )
    .bind(&id).bind(&tenant.id).bind(namespace).bind(name).bind(description)
    .bind(event).bind(action).bind(&action_config)
    .bind(filter_memory_type).bind(filter_namespace).bind(filter_label_pattern)
    .bind(filter_heat_below).bind(filter_heat_above).bind(max_fires).bind(cooldown)
    .execute(&state.pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // train_on_this: record this trigger rule as a "correct" signal for SITU
    let train_on_this = body.get("train_on_this").and_then(|v| v.as_bool()).unwrap_or(false);
    if train_on_this {
        let pool2 = state.pool.clone();
        let tid2 = tenant.id.clone();
        let trigger_id = id.clone();
        let evt = event.to_string();
        tokio::spawn(async move {
            let _ = sqlx::query(
                "INSERT INTO trigger_feedback \
                    (tenant_id, trigger_id, feedback_type, event_type, \
                     expected_action, notes, source) \
                 VALUES ($1, $2::uuid, 'correct', $3, 'fire', \
                         'Agent confirmed this trigger rule is correct at creation', 'train_on_this')"
            )
            .bind(&tid2)
            .bind(&trigger_id)
            .bind(&evt)
            .execute(&pool2)
            .await;
        });
    }

    Ok(Json(json!({ "ok": true, "trigger_id": id, "name": name, "trained": train_on_this })))
}

/// PATCH /api/v1/triggers/:id
pub async fn update_trigger(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, StatusCode> {
    let pool = &state.pool;
    let tid = &tenant.id;

    if let Some(enabled) = body.get("enabled").and_then(|v| v.as_bool()) {
        sqlx::query(
            "UPDATE triggers SET enabled = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3",
        )
        .bind(enabled)
        .bind(&id)
        .bind(tid)
        .execute(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    if let Some(name) = body.get("name").and_then(|v| v.as_str()) {
        sqlx::query(
            "UPDATE triggers SET name = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3",
        )
        .bind(name)
        .bind(&id)
        .bind(tid)
        .execute(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    if let Some(config) = body.get("action_config") {
        sqlx::query("UPDATE triggers SET action_config = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3")
            .bind(config).bind(&id).bind(tid).execute(pool).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    Ok(Json(json!({ "ok": true, "trigger_id": id })))
}

/// DELETE /api/v1/triggers/:id
pub async fn delete_trigger(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Path(id): Path<String>,
) -> StatusCode {
    let result = sqlx::query("DELETE FROM triggers WHERE id = $1 AND tenant_id = $2")
        .bind(&id)
        .bind(&tenant.id)
        .execute(&state.pool)
        .await;
    match result {
        Ok(r) if r.rows_affected() > 0 => StatusCode::NO_CONTENT,
        _ => StatusCode::NOT_FOUND,
    }
}

/// GET /api/v1/triggers/history
pub async fn trigger_history(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Json<Value> {
    let limit: i32 = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);

    let rows = sqlx::query(
        "SELECT id, trigger_id, event, node_id, action, action_result, fired_at::text \
         FROM trigger_log WHERE tenant_id = $1 ORDER BY fired_at DESC LIMIT $2",
    )
    .bind(&tenant.id)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let history: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.try_get::<String, _>("id").unwrap_or_default(),
                "trigger_id": r.try_get::<String, _>("trigger_id").unwrap_or_default(),
                "event": r.try_get::<String, _>("event").unwrap_or_default(),
                "node_id": r.try_get::<Option<String>, _>("node_id").unwrap_or(None),
                "action": r.try_get::<String, _>("action").unwrap_or_default(),
                "result": r.try_get::<Value, _>("action_result").unwrap_or(json!({})),
                "fired_at": r.try_get::<Option<String>, _>("fired_at").unwrap_or(None),
            })
        })
        .collect();

    Json(json!({ "history": history, "count": history.len() }))
}

// ---------------------------------------------------------------------------
// Trigger feedback — SITU training data
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct TriggerFeedbackRequest {
    /// UUID of the trigger (optional for false_negative)
    pub trigger_id: Option<String>,
    /// UUID of the trigger_log entry (optional for false_negative)
    pub trigger_log_id: Option<String>,
    /// "false_positive", "false_negative", "correct", "wrong_action"
    pub feedback_type: String,
    /// Event type context: "memory_created", "heat_threshold", "recall", etc.
    #[serde(default)]
    pub event_type: Option<String>,
    /// Memory involved (if any)
    #[serde(default)]
    pub memory_id: Option<String>,
    /// Graph context snapshot
    #[serde(default)]
    pub context_snapshot: Option<Value>,
    /// What should have happened
    #[serde(default)]
    pub expected_action: Option<String>,
    /// Free-text explanation
    #[serde(default)]
    pub notes: Option<String>,
    /// Source: "plugin", "dashboard", "api"
    #[serde(default = "default_api_source")]
    pub source: String,
}

fn default_api_source() -> String { "api".to_string() }

const VALID_FEEDBACK_TYPES: &[&str] = &["false_positive", "false_negative", "correct", "wrong_action"];

/// POST /api/v1/triggers/feedback — record trigger feedback for SITU training
pub async fn record_trigger_feedback(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Json(body): Json<TriggerFeedbackRequest>,
) -> (StatusCode, Json<Value>) {
    if !VALID_FEEDBACK_TYPES.contains(&body.feedback_type.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("invalid feedback_type: {}. Must be one of: {:?}", body.feedback_type, VALID_FEEDBACK_TYPES),
        })));
    }

    let trigger_id = body.trigger_id.as_deref()
        .and_then(|s| uuid::Uuid::parse_str(s).ok());
    let trigger_log_id = body.trigger_log_id.as_deref()
        .and_then(|s| uuid::Uuid::parse_str(s).ok());
    let memory_id = body.memory_id.as_deref()
        .and_then(|s| uuid::Uuid::parse_str(s).ok());

    let result = sqlx::query(
        "INSERT INTO trigger_feedback \
            (tenant_id, trigger_id, trigger_log_id, feedback_type, \
             event_type, memory_id, context_snapshot, expected_action, notes, source) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
    )
    .bind(&tenant.id)
    .bind(trigger_id)
    .bind(trigger_log_id)
    .bind(&body.feedback_type)
    .bind(&body.event_type)
    .bind(memory_id)
    .bind(&body.context_snapshot)
    .bind(&body.expected_action)
    .bind(&body.notes)
    .bind(&body.source)
    .execute(&state.pool)
    .await;

    match result {
        Ok(_) => {
            tracing::info!(
                tenant = %tenant.id,
                feedback_type = %body.feedback_type,
                "Trigger feedback recorded (SITU training)"
            );
            (StatusCode::CREATED, Json(json!({
                "ok": true,
                "feedback_type": body.feedback_type,
            })))
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to record trigger feedback");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "error": e.to_string(),
            })))
        }
    }
}

/// GET /api/v1/triggers/feedback — list trigger feedback
pub async fn list_trigger_feedback(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Query(params): Query<FeedbackListParams>,
) -> (StatusCode, Json<Value>) {
    let limit = params.limit.unwrap_or(50).min(200);

    let rows = sqlx::query(
        "SELECT id, trigger_id, trigger_log_id, feedback_type, event_type, \
                memory_id, expected_action, notes, source, created_at \
         FROM trigger_feedback \
         WHERE tenant_id = $1 \
         ORDER BY created_at DESC \
         LIMIT $2"
    )
    .bind(&tenant.id)
    .bind(limit as i64)
    .fetch_all(&state.pool)
    .await;

    match rows {
        Ok(results) => {
            let items: Vec<Value> = results.iter().map(|r| {
                json!({
                    "id": r.try_get::<String, _>("id").unwrap_or_default(),
                    "trigger_id": r.try_get::<Option<String>, _>("trigger_id").unwrap_or(None),
                    "trigger_log_id": r.try_get::<Option<String>, _>("trigger_log_id").unwrap_or(None),
                    "feedback_type": r.try_get::<String, _>("feedback_type").unwrap_or_default(),
                    "event_type": r.try_get::<Option<String>, _>("event_type").unwrap_or(None),
                    "memory_id": r.try_get::<Option<String>, _>("memory_id").unwrap_or(None),
                    "expected_action": r.try_get::<Option<String>, _>("expected_action").unwrap_or(None),
                    "notes": r.try_get::<Option<String>, _>("notes").unwrap_or(None),
                    "source": r.try_get::<Option<String>, _>("source").unwrap_or(None),
                    "created_at": r.try_get::<Option<String>, _>("created_at").unwrap_or(None),
                })
            }).collect();

            (StatusCode::OK, Json(json!({
                "feedback": items,
                "count": items.len(),
            })))
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "error": e.to_string(),
        }))),
    }
}

#[derive(serde::Deserialize)]
pub struct FeedbackListParams {
    pub limit: Option<i32>,
}

/// POST /api/v1/triggers/evaluate
///
/// Manually evaluate triggers against a synthetic event.
/// Agents use this to test their triggers or fire them on-demand.
pub async fn evaluate_triggers(
    State(state): State<SharedState>,
    Extension(tenant): Extension<TenantContext>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let event_str = body.get("event").and_then(|v| v.as_str()).unwrap_or("on_store");
    let context_json = body.get("context").cloned().unwrap_or(json!({}));

    let event = match event_str {
        "on_store" => crate::trigger_engine::TriggerEvent::OnStore,
        "on_recall" => crate::trigger_engine::TriggerEvent::OnRecall,
        "on_boost" => crate::trigger_engine::TriggerEvent::OnBoost,
        "on_decay" => crate::trigger_engine::TriggerEvent::OnDecay,
        other => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "error": format!("Unknown event type: {other}. Valid: on_store, on_recall, on_boost, on_decay"),
            })));
        }
    };

    // Build trigger context from request body, with auto-enrichment from DB
    let mut node_id = context_json.get("node_id").and_then(|v| v.as_str()).map(String::from);
    let mut node_label = context_json.get("node_label").and_then(|v| v.as_str()).map(String::from);
    let mut node_namespace = context_json.get("namespace").and_then(|v| v.as_str()).map(String::from)
        .or_else(|| if tenant.agent_label.is_empty() { None } else { Some(tenant.agent_label.clone()) });
    let mut node_memory_type = context_json.get("memory_type").and_then(|v| v.as_str()).map(String::from);
    let mut node_heat = context_json.get("heat").and_then(|v| v.as_f64()).map(|v| v as f32);
    let old_heat = context_json.get("old_heat").and_then(|v| v.as_f64()).map(|v| v as f32);

    // Auto-enrich: if node_id is provided but other fields are missing, look up the node
    if let Some(ref nid) = node_id {
        if node_label.is_none() || node_heat.is_none() {
            if let Ok(row) = sqlx::query_as::<_, (String, String, Option<String>, f32)>(
                "SELECT pointer_summary, memory_type, namespace, current_heat \
                 FROM golden_index WHERE id = $1::uuid AND tenant_id = $2"
            ).bind(nid).bind(&tenant.id).fetch_one(&state.pool).await {
                if node_label.is_none() { node_label = Some(row.0); }
                if node_memory_type.is_none() { node_memory_type = Some(row.1); }
                if node_namespace.is_none() { node_namespace = row.2; }
                if node_heat.is_none() { node_heat = Some(row.3); }
            }
        }
    }

    // Auto-pick: if no node_id at all, pick a representative node for the event type
    if node_id.is_none() {
        let pick_query = match event {
            crate::trigger_engine::TriggerEvent::OnDecay => {
                // Pick a low-heat node that would realistically trigger on_decay
                "SELECT id::text, pointer_summary, memory_type, namespace, current_heat \
                 FROM golden_index WHERE tenant_id = $1 AND current_heat < 0.2 AND is_pinned = false \
                 AND archived_at IS NULL ORDER BY current_heat ASC LIMIT 1"
            }
            crate::trigger_engine::TriggerEvent::OnBoost => {
                // Pick a recently hot node
                "SELECT id::text, pointer_summary, memory_type, namespace, current_heat \
                 FROM golden_index WHERE tenant_id = $1 AND current_heat > 0.5 \
                 AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1"
            }
            _ => {
                // For on_store/on_recall, pick the most recently updated node
                "SELECT id::text, pointer_summary, memory_type, namespace, current_heat \
                 FROM golden_index WHERE tenant_id = $1 AND archived_at IS NULL \
                 ORDER BY updated_at DESC LIMIT 1"
            }
        };
        if let Ok(row) = sqlx::query_as::<_, (String, String, String, Option<String>, f32)>(
            pick_query
        ).bind(&tenant.id).fetch_one(&state.pool).await {
            node_id = Some(row.0);
            if node_label.is_none() { node_label = Some(row.1); }
            if node_memory_type.is_none() { node_memory_type = Some(row.2); }
            if node_namespace.is_none() { node_namespace = row.3; }
            if node_heat.is_none() { node_heat = Some(row.4); }
        } else {
            tracing::warn!(tenant_id = %tenant.id, event = %event_str, "auto-pick found no matching node for evaluate");
        }
    }

    let ctx = crate::trigger_engine::TriggerContext {
        tenant_id: tenant.id.clone(),
        node_id,
        node_label,
        node_namespace,
        node_memory_type,
        node_heat,
        old_heat,
    };

    let results = crate::trigger_engine::evaluate_triggers_with_situ(
        &state.pool, event, &ctx, state.siu_v2_classifier.as_ref(),
    ).await;

    let fires: Vec<Value> = results.iter().map(|r| {
        json!({
            "trigger_id": r.trigger_id,
            "trigger_name": r.trigger_name,
            "action": r.action,
            "fired": r.success,
            "message": r.message,
            "data": r.data,
        })
    }).collect();

    let fired_count = fires.iter().filter(|f| f["fired"].as_bool().unwrap_or(false)).count();

    (StatusCode::OK, Json(json!({
        "event": event_str,
        "evaluated": fires.len(),
        "fired": fired_count,
        "results": fires,
    })))
}
