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
    let event = body.get("event").and_then(|v| v.as_str())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "missing event"}))))?;
    let action = body.get("action").and_then(|v| v.as_str())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "missing action"}))))?;

    let id = uuid::Uuid::now_v7().to_string();
    let description = body.get("description").and_then(|v| v.as_str()).unwrap_or("");
    let action_config = body.get("action_config").cloned().unwrap_or(json!({}));
    let filter_memory_type = body.get("filter_memory_type").and_then(|v| v.as_str());
    let filter_namespace = body.get("filter_namespace").and_then(|v| v.as_str());
    let filter_label_pattern = body.get("filter_label_pattern").and_then(|v| v.as_str());
    let filter_heat_below: Option<f32> = body.get("filter_heat_below").and_then(|v| v.as_f64()).map(|v| v as f32);
    let filter_heat_above: Option<f32> = body.get("filter_heat_above").and_then(|v| v.as_f64()).map(|v| v as f32);
    let max_fires: Option<i32> = body.get("max_fires").and_then(|v| v.as_i64()).map(|v| v as i32);
    let cooldown: i32 = body.get("cooldown_seconds").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let namespace = body.get("namespace").and_then(|v| v.as_str()).unwrap_or("default");

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

    Ok(Json(json!({ "ok": true, "trigger_id": id, "name": name })))
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
        sqlx::query("UPDATE triggers SET enabled = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3")
            .bind(enabled).bind(&id).bind(tid).execute(pool).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    if let Some(name) = body.get("name").and_then(|v| v.as_str()) {
        sqlx::query("UPDATE triggers SET name = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3")
            .bind(name).bind(&id).bind(tid).execute(pool).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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
        .bind(&id).bind(&tenant.id).execute(&state.pool).await;
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
    let limit: i32 = params.get("limit").and_then(|v| v.parse().ok()).unwrap_or(50);

    let rows = sqlx::query(
        "SELECT id, trigger_id, event, node_id, action, action_result, fired_at::text \
         FROM trigger_log WHERE tenant_id = $1 ORDER BY fired_at DESC LIMIT $2",
    )
    .bind(&tenant.id).bind(limit)
    .fetch_all(&state.pool).await.unwrap_or_default();

    let history: Vec<Value> = rows.iter().map(|r| json!({
        "id": r.try_get::<String, _>("id").unwrap_or_default(),
        "trigger_id": r.try_get::<String, _>("trigger_id").unwrap_or_default(),
        "event": r.try_get::<String, _>("event").unwrap_or_default(),
        "node_id": r.try_get::<Option<String>, _>("node_id").unwrap_or(None),
        "action": r.try_get::<String, _>("action").unwrap_or_default(),
        "result": r.try_get::<Value, _>("action_result").unwrap_or(json!({})),
        "fired_at": r.try_get::<Option<String>, _>("fired_at").unwrap_or(None),
    })).collect();

    Json(json!({ "history": history, "count": history.len() }))
}
