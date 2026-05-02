// Sulcus Trigger Engine
// Evaluates and fires triggers in response to memory events.
// This is the novel differentiator — no other memory system has reactive triggers.

use sqlx::PgPool;
use std::str::FromStr;
use tracing::{debug, info, warn};
use uuid::Uuid;

// Shared types from sulcus-types
pub use sulcus_types::triggers::{
    TriggerEvent, TriggerAction, TriggerContext, TriggerResult, MatchedTrigger,
};

// Pure logic from sulcus-core
pub use sulcus_core::triggers::collect_notifications;
use sulcus_core::triggers::fire_notify as core_fire_notify;

/// Row type for trigger query results (avoids clippy::type_complexity)
type TriggerRow = (
    String,            // id
    String,            // name
    String,            // action
    serde_json::Value, // action_config
    i32,               // fire_count
    Option<i32>,       // max_fires
    Option<String>,    // filter_memory_type
    Option<String>,    // filter_namespace
    Option<String>,    // filter_label_pattern
    Option<f32>,       // filter_heat_below
    Option<f32>,       // filter_heat_above
    i32,               // cooldown_seconds
    Option<String>,    // last_fired_at
);

/// Evaluate all matching triggers for an event and fire them.
/// Returns a list of notifications that should be surfaced to the agent.
pub async fn evaluate_triggers(
    pool: &PgPool,
    event: TriggerEvent,
    ctx: &TriggerContext,
) -> Vec<TriggerResult> {
    let mut results = Vec::new();

    // Find all enabled triggers matching this event
    let matched = match find_matching_triggers(pool, &event, ctx).await {
        Ok(m) => m,
        Err(e) => {
            warn!(error = %e, "trigger evaluation failed");
            return results;
        }
    };

    if matched.is_empty() {
        return results;
    }

    debug!(
        event = event.as_str(),
        count = matched.len(),
        "evaluating triggers"
    );

    for trigger in matched {
        let result = fire_trigger(pool, &trigger, &event, ctx).await;
        results.push(result);
    }

    results
}

/// Find triggers that match the current event + context filters
async fn find_matching_triggers(
    pool: &PgPool,
    event: &TriggerEvent,
    ctx: &TriggerContext,
) -> anyhow::Result<Vec<MatchedTrigger>> {
    // Query all enabled triggers for this event type
    let rows: Vec<TriggerRow> = sqlx::query_as(
        r#"SELECT id, name, action, action_config, fire_count, max_fires,
                  filter_memory_type, filter_namespace, filter_label_pattern,
                  filter_heat_below, filter_heat_above, cooldown_seconds, last_fired_at
           FROM triggers
           WHERE event = $1 AND enabled = TRUE"#,
    )
    .bind(event.as_str())
    .fetch_all(pool)
    .await?;

    let now = chrono::Utc::now();
    let mut matched = Vec::new();

    for (
        id,
        name,
        action,
        action_config,
        fire_count,
        max_fires,
        filter_memory_type,
        filter_namespace,
        filter_label_pattern,
        filter_heat_below,
        filter_heat_above,
        cooldown_seconds,
        last_fired_at,
    ) in rows
    {
        // Check max_fires limit
        if let Some(max) = max_fires {
            if fire_count >= max {
                continue;
            }
        }

        // Check cooldown
        if cooldown_seconds > 0 {
            if let Some(ref last) = last_fired_at {
                if let Ok(last_time) = chrono::DateTime::parse_from_rfc3339(last) {
                    let elapsed = (now - last_time.with_timezone(&chrono::Utc)).num_seconds();
                    if elapsed < cooldown_seconds as i64 {
                        continue; // still in cooldown
                    }
                }
            }
        }

        // Apply filters
        if let Some(ref ft) = filter_memory_type {
            if let Some(ref mt) = ctx.node_memory_type {
                if ft != mt {
                    continue;
                }
            }
        }

        if let Some(ref fn_) = filter_namespace {
            if let Some(ref ns) = ctx.node_namespace {
                if fn_ != ns {
                    continue;
                }
            }
        }

        if let Some(ref pattern) = filter_label_pattern {
            if let Some(ref label) = ctx.node_label {
                // Simple case-insensitive contains (ILIKE equivalent)
                if !label
                    .to_lowercase()
                    .contains(&pattern.to_lowercase().replace('%', ""))
                {
                    continue;
                }
            }
        }

        // Threshold filters
        if let Some(below) = filter_heat_below {
            if let Some(heat) = ctx.node_heat {
                if heat >= below {
                    continue; // heat is still above threshold
                }
            }
        }

        if let Some(above) = filter_heat_above {
            if let Some(heat) = ctx.node_heat {
                if heat <= above {
                    continue; // heat is still below threshold
                }
            }
        }

        matched.push(MatchedTrigger {
            id,
            name,
            action,
            action_config,
            fire_count,
            max_fires,
        });
    }

    Ok(matched)
}

/// Fire a single trigger and return the result
async fn fire_trigger(
    pool: &PgPool,
    trigger: &MatchedTrigger,
    event: &TriggerEvent,
    ctx: &TriggerContext,
) -> TriggerResult {
    let action = trigger.action.parse::<TriggerAction>();
    let now = chrono::Utc::now().to_rfc3339();

    let result = match action {
        Ok(TriggerAction::Notify) => fire_notify(trigger, ctx).await,
        Ok(TriggerAction::Boost) => fire_boost(pool, trigger, ctx).await,
        Ok(TriggerAction::Pin) => fire_pin(pool, trigger, ctx).await,
        Ok(TriggerAction::Tag) => fire_tag(pool, trigger, ctx).await,
        Ok(TriggerAction::Deprecate) => fire_deprecate(pool, trigger, ctx).await,
        Ok(TriggerAction::Webhook) => fire_webhook(trigger, ctx).await,
        Ok(TriggerAction::Chain) => {
            // Chain would recursively invoke another MCP tool — punt for v1
            TriggerResult {
                trigger_id: trigger.id.clone(),
                trigger_name: trigger.name.clone(),
                action: "chain".into(),
                success: false,
                message: Some("Chain triggers not yet implemented".into()),
                data: serde_json::json!({}),
            }
        }
        Err(_) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: trigger.action.clone(),
            success: false,
            message: Some(format!("Unknown action: {}", trigger.action)),
            data: serde_json::json!({}),
        },
    };

    // Update fire_count and last_fired_at
    let _ = sqlx::query(
        "UPDATE triggers SET fire_count = fire_count + 1, last_fired_at = $1, updated_at = $1 WHERE id = $2",
    )
    .bind(&now)
    .bind(&trigger.id)
    .execute(pool)
    .await;

    // Log the trigger firing
    let log_id = Uuid::now_v7().to_string();
    let _ = sqlx::query(
        "INSERT INTO trigger_log (id, trigger_id, event, node_id, action, action_result, fired_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(&log_id)
    .bind(&trigger.id)
    .bind(event.as_str())
    .bind(&ctx.node_id)
    .bind(&trigger.action)
    .bind(serde_json::to_value(&result).unwrap_or_default())
    .bind(&now)
    .execute(pool)
    .await;

    info!(
        trigger_id = %trigger.id,
        trigger_name = %trigger.name,
        action = %trigger.action,
        success = result.success,
        "trigger fired"
    );

    result
}

async fn fire_notify(trigger: &MatchedTrigger, ctx: &TriggerContext) -> TriggerResult {
    // Delegate to pure implementation in sulcus-core
    core_fire_notify(trigger, ctx)
}

async fn fire_boost(
    pool: &PgPool,
    trigger: &MatchedTrigger,
    ctx: &TriggerContext,
) -> TriggerResult {
    let strength = trigger
        .action_config
        .get("strength")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.3) as f32;

    let target_id = trigger
        .action_config
        .get("target")
        .and_then(|v| v.as_str())
        .and_then(|t| {
            if t == "self" {
                ctx.node_id.as_deref()
            } else {
                Some(t)
            }
        });

    let Some(node_id) = target_id.or(ctx.node_id.as_deref()) else {
        return TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "boost".into(),
            success: false,
            message: Some("No target node for boost".into()),
            data: serde_json::json!({}),
        };
    };

    let result = sqlx::query(
        "UPDATE nodes SET current_heat = LEAST(current_heat + $1, 1.0), last_accessed_at = NOW() WHERE id = $2",
    )
    .bind(strength)
    .bind(node_id)
    .execute(pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "boost".into(),
            success: true,
            message: Some(format!("Boosted {} by {}", node_id, strength)),
            data: serde_json::json!({"target": node_id, "strength": strength}),
        },
        Ok(_) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "boost".into(),
            success: false,
            message: Some(format!("Node {} not found", node_id)),
            data: serde_json::json!({}),
        },
        Err(e) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "boost".into(),
            success: false,
            message: Some(format!("Boost failed: {}", e)),
            data: serde_json::json!({}),
        },
    }
}

async fn fire_pin(pool: &PgPool, trigger: &MatchedTrigger, ctx: &TriggerContext) -> TriggerResult {
    let Some(node_id) = ctx.node_id.as_deref() else {
        return TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "pin".into(),
            success: false,
            message: Some("No node to pin".into()),
            data: serde_json::json!({}),
        };
    };

    let result = sqlx::query("UPDATE nodes SET is_pinned = TRUE WHERE id = $1")
        .bind(node_id)
        .execute(pool)
        .await;

    TriggerResult {
        trigger_id: trigger.id.clone(),
        trigger_name: trigger.name.clone(),
        action: "pin".into(),
        success: result.is_ok(),
        message: Some(format!("Pinned {}", node_id)),
        data: serde_json::json!({"node_id": node_id}),
    }
}

async fn fire_tag(pool: &PgPool, trigger: &MatchedTrigger, ctx: &TriggerContext) -> TriggerResult {
    let label_suffix = trigger
        .action_config
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("triggered");

    let Some(node_id) = ctx.node_id.as_deref() else {
        return TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "tag".into(),
            success: false,
            message: Some("No node to tag".into()),
            data: serde_json::json!({}),
        };
    };

    // Append tag to label
    let result = sqlx::query(
        "UPDATE nodes SET label = label || ' [' || $1 || ']' WHERE id = $2 AND label NOT LIKE '%[' || $1 || ']%'",
    )
    .bind(label_suffix)
    .bind(node_id)
    .execute(pool)
    .await;

    TriggerResult {
        trigger_id: trigger.id.clone(),
        trigger_name: trigger.name.clone(),
        action: "tag".into(),
        success: result.is_ok(),
        message: Some(format!("Tagged {} with [{}]", node_id, label_suffix)),
        data: serde_json::json!({"node_id": node_id, "tag": label_suffix}),
    }
}

async fn fire_deprecate(
    pool: &PgPool,
    trigger: &MatchedTrigger,
    ctx: &TriggerContext,
) -> TriggerResult {
    let reason = trigger
        .action_config
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("auto-deprecated by trigger");

    let Some(node_id) = ctx.node_id.as_deref() else {
        return TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "deprecate".into(),
            success: false,
            message: Some("No node to deprecate".into()),
            data: serde_json::json!({}),
        };
    };

    let result = sqlx::query(
        "UPDATE nodes SET current_heat = GREATEST(current_heat * 0.5, 0.01), decay_class = 'volatile' WHERE id = $1",
    )
    .bind(node_id)
    .execute(pool)
    .await;

    TriggerResult {
        trigger_id: trigger.id.clone(),
        trigger_name: trigger.name.clone(),
        action: "deprecate".into(),
        success: result.is_ok(),
        message: Some(format!("Deprecated {}: {}", node_id, reason)),
        data: serde_json::json!({"node_id": node_id, "reason": reason}),
    }
}

async fn fire_webhook(trigger: &MatchedTrigger, ctx: &TriggerContext) -> TriggerResult {
    let url = trigger.action_config.get("url").and_then(|v| v.as_str());

    let Some(url) = url else {
        return TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "webhook".into(),
            success: false,
            message: Some("No webhook URL configured".into()),
            data: serde_json::json!({}),
        };
    };

    let body = serde_json::json!({
        "trigger_id": trigger.id,
        "trigger_name": trigger.name,
        "node_id": ctx.node_id,
        "node_label": ctx.node_label,
        "node_namespace": ctx.node_namespace,
        "node_heat": ctx.node_heat,
    });

    // Fire-and-forget with 5s timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let method = trigger
        .action_config
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("POST");

    let resp = if method.eq_ignore_ascii_case("GET") {
        client.get(url).send().await
    } else {
        client.post(url).json(&body).send().await
    };

    match resp {
        Ok(r) => {
            let status = r.status().as_u16();
            TriggerResult {
                trigger_id: trigger.id.clone(),
                trigger_name: trigger.name.clone(),
                action: "webhook".into(),
                success: status < 400,
                message: Some(format!("Webhook {} → {}", url, status)),
                data: serde_json::json!({"url": url, "status": status}),
            }
        }
        Err(e) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "webhook".into(),
            success: false,
            message: Some(format!("Webhook failed: {}", e)),
            data: serde_json::json!({"url": url, "error": e.to_string()}),
        },
    }
}

// collect_notifications is now re-exported from sulcus_core::triggers
