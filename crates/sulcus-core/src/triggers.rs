// sulcus-core/src/triggers.rs
//
// Pure trigger logic — no I/O, no database, no HTTP.
// Database-backed implementations live in sulcus.
// HTTP (webhook) stays in sulcus as well.

use async_trait::async_trait;
use sulcus_types::triggers::{
    MatchedTrigger, TriggerAction, TriggerContext, TriggerEvent, TriggerResult,
};
use tracing::{debug, info, warn};

// ─── TriggerRow ─────────────────────────────────────────────────────────────

/// Row fetched from the triggers table (owned by the backend, passed to pure logic).
#[derive(Debug, Clone)]
pub struct TriggerRow {
    pub id: String,
    pub event: String,
    pub action: String,
    pub config: serde_json::Value,
    pub enabled: bool,
    pub fire_count: i64,
    pub last_fired: Option<chrono::DateTime<chrono::Utc>>,
    pub cooldown_secs: Option<i64>,
    pub heat_floor: Option<f32>,
    pub heat_ceiling: Option<f32>,
    pub label_pattern: Option<String>,
}

// ─── TriggerBackend trait ────────────────────────────────────────────────────

/// Async I/O operations required by evaluate_triggers.
/// Implement this in sulcus (PgPool) or any other backend.
#[async_trait]
pub trait TriggerBackend: Send + Sync {
    async fn fetch_triggers_for_event(&self, event: &str) -> anyhow::Result<Vec<TriggerRow>>;
    async fn record_trigger_fire(
        &self,
        trigger_id: &str,
        now: chrono::DateTime<chrono::Utc>,
    ) -> anyhow::Result<()>;
    async fn insert_trigger_log(
        &self,
        trigger_id: &str,
        event: &str,
        result_json: &str,
    ) -> anyhow::Result<()>;
    async fn boost_node(&self, node_id: &str, strength: f32) -> anyhow::Result<()>;
    async fn pin_node(&self, node_id: &str) -> anyhow::Result<()>;
    async fn tag_node(&self, node_id: &str, label_suffix: &str) -> anyhow::Result<()>;
    async fn deprecate_node(&self, node_id: &str) -> anyhow::Result<()>;
}

// ─── Pure filter logic ───────────────────────────────────────────────────────

/// Filter an already-fetched slice of TriggerRows against the current context.
/// Returns only the rows that pass all cooldown/heat/label checks.
/// Pure: no I/O, operates entirely on owned/borrowed data.
pub fn filter_trigger_rows(
    rows: &[TriggerRow],
    ctx: &TriggerContext,
    now: chrono::DateTime<chrono::Utc>,
) -> Vec<MatchedTrigger> {
    let mut matched = Vec::new();

    for row in rows {
        // Check cooldown
        if let Some(cooldown) = row.cooldown_secs {
            if cooldown > 0 {
                if let Some(last) = row.last_fired {
                    let elapsed = (now - last).num_seconds();
                    if elapsed < cooldown {
                        continue; // still cooling down
                    }
                }
            }
        }

        // Heat floor: trigger only fires if node heat is ABOVE heat_floor
        if let Some(floor) = row.heat_floor {
            match ctx.node_heat {
                Some(heat) if heat >= floor => {} // passes
                _ => continue,
            }
        }

        // Heat ceiling: trigger only fires if node heat is BELOW heat_ceiling
        if let Some(ceiling) = row.heat_ceiling {
            match ctx.node_heat {
                Some(heat) if heat <= ceiling => {} // passes
                _ => continue,
            }
        }

        // Label pattern: simple case-insensitive substring match (mirrors ILIKE %pattern%)
        if let Some(ref pattern) = row.label_pattern {
            let stripped = pattern.replace('%', "");
            match &ctx.node_label {
                Some(label) if label.to_lowercase().contains(&stripped.to_lowercase()) => {}
                _ => continue,
            }
        }

        matched.push(MatchedTrigger {
            id: row.id.clone(),
            name: row.id.clone(), // TriggerRow doesn't carry a separate name; use id
            action: row.action.clone(),
            action_config: row.config.clone(),
            fire_count: row.fire_count as i32,
            max_fires: None, // not tracked in TriggerRow by design
        });
    }

    matched
}

// ─── fire_notify (pure) ──────────────────────────────────────────────────────

/// Pure string interpolation: build a Notify TriggerResult from context + config template.
/// Zero I/O.
pub fn fire_notify(trigger: &MatchedTrigger, ctx: &TriggerContext) -> TriggerResult {
    let msg = trigger
        .action_config
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("Trigger fired")
        .to_string();

    let msg = msg
        .replace("{node_id}", ctx.node_id.as_deref().unwrap_or(""))
        .replace("{label}", ctx.node_label.as_deref().unwrap_or(""))
        .replace("{namespace}", ctx.node_namespace.as_deref().unwrap_or(""))
        .replace(
            "{heat}",
            &ctx.node_heat
                .map(|h| format!("{:.2}", h))
                .unwrap_or_default(),
        );

    TriggerResult {
        trigger_id: trigger.id.clone(),
        trigger_name: trigger.name.clone(),
        action: "notify".into(),
        success: true,
        message: Some(msg),
        data: serde_json::json!({}),
    }
}

// ─── collect_notifications (pure) ───────────────────────────────────────────

/// Collect notification messages from a slice of TriggerResults.
/// Returns only Notify actions that succeeded. Zero I/O.
pub fn collect_notifications(results: &[TriggerResult]) -> Vec<String> {
    results
        .iter()
        .filter(|r| r.action == "notify" && r.success)
        .filter_map(|r| r.message.clone())
        .collect()
}

// ─── evaluate_triggers orchestration ────────────────────────────────────────

/// Evaluate all matching triggers for an event and fire them via the backend.
/// Returns all TriggerResults (including notifications).
///
/// The orchestration flow:
///   1. Fetch trigger rows for this event from the backend.
///   2. Filter them in-memory (pure, no I/O).
///   3. For each matched trigger: dispatch to the appropriate action handler.
///   4. Record fire + log via backend (I/O).
pub async fn evaluate_triggers<B: TriggerBackend>(
    backend: &B,
    event: TriggerEvent,
    ctx: &TriggerContext,
) -> Vec<TriggerResult> {
    let mut results = Vec::new();
    let now = chrono::Utc::now();

    let rows = match backend.fetch_triggers_for_event(event.as_str()).await {
        Ok(r) => r,
        Err(e) => {
            warn!(error = %e, "trigger evaluation: fetch failed");
            return results;
        }
    };

    let matched = filter_trigger_rows(&rows, ctx, now);

    if matched.is_empty() {
        return results;
    }

    debug!(
        event = event.as_str(),
        count = matched.len(),
        "evaluating triggers"
    );

    for trigger in &matched {
        let result = dispatch_action(backend, trigger, &event, ctx).await;

        // Record fire timestamp
        if result.success {
            if let Err(e) = backend.record_trigger_fire(&trigger.id, now).await {
                warn!(trigger_id = %trigger.id, error = %e, "failed to record trigger fire");
            }
        }

        // Log trigger execution
        let result_json = serde_json::to_string(&result).unwrap_or_default();
        if let Err(e) = backend
            .insert_trigger_log(&trigger.id, event.as_str(), &result_json)
            .await
        {
            warn!(trigger_id = %trigger.id, error = %e, "failed to insert trigger log");
        }

        info!(
            trigger_id = %trigger.id,
            trigger_name = %trigger.name,
            action = %trigger.action,
            success = result.success,
            "trigger fired"
        );

        results.push(result);
    }

    results
}

// ─── Action dispatch (uses backend for I/O actions) ─────────────────────────

async fn dispatch_action<B: TriggerBackend>(
    backend: &B,
    trigger: &MatchedTrigger,
    event: &TriggerEvent,
    ctx: &TriggerContext,
) -> TriggerResult {
    let _ = event; // available for future logging / chain events

    match trigger.action.parse::<TriggerAction>() {
        Ok(TriggerAction::Notify) => fire_notify(trigger, ctx),

        Ok(TriggerAction::Boost) => {
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
                })
                .or(ctx.node_id.as_deref());

            match target_id {
                Some(node_id) => match backend.boost_node(node_id, strength).await {
                    Ok(()) => TriggerResult {
                        trigger_id: trigger.id.clone(),
                        trigger_name: trigger.name.clone(),
                        action: "boost".into(),
                        success: true,
                        message: Some(format!("Boosted {} by {}", node_id, strength)),
                        data: serde_json::json!({"target": node_id, "strength": strength}),
                    },
                    Err(e) => TriggerResult {
                        trigger_id: trigger.id.clone(),
                        trigger_name: trigger.name.clone(),
                        action: "boost".into(),
                        success: false,
                        message: Some(format!("Boost failed: {}", e)),
                        data: serde_json::json!({}),
                    },
                },
                None => TriggerResult {
                    trigger_id: trigger.id.clone(),
                    trigger_name: trigger.name.clone(),
                    action: "boost".into(),
                    success: false,
                    message: Some("No target node for boost".into()),
                    data: serde_json::json!({}),
                },
            }
        }

        Ok(TriggerAction::Pin) => match ctx.node_id.as_deref() {
            Some(node_id) => match backend.pin_node(node_id).await {
                Ok(()) => TriggerResult {
                    trigger_id: trigger.id.clone(),
                    trigger_name: trigger.name.clone(),
                    action: "pin".into(),
                    success: true,
                    message: Some(format!("Pinned {}", node_id)),
                    data: serde_json::json!({"node_id": node_id}),
                },
                Err(e) => TriggerResult {
                    trigger_id: trigger.id.clone(),
                    trigger_name: trigger.name.clone(),
                    action: "pin".into(),
                    success: false,
                    message: Some(format!("Pin failed: {}", e)),
                    data: serde_json::json!({}),
                },
            },
            None => TriggerResult {
                trigger_id: trigger.id.clone(),
                trigger_name: trigger.name.clone(),
                action: "pin".into(),
                success: false,
                message: Some("No node to pin".into()),
                data: serde_json::json!({}),
            },
        },

        Ok(TriggerAction::Tag) => {
            let label_suffix = trigger
                .action_config
                .get("label")
                .and_then(|v| v.as_str())
                .unwrap_or("triggered");

            match ctx.node_id.as_deref() {
                Some(node_id) => match backend.tag_node(node_id, label_suffix).await {
                    Ok(()) => TriggerResult {
                        trigger_id: trigger.id.clone(),
                        trigger_name: trigger.name.clone(),
                        action: "tag".into(),
                        success: true,
                        message: Some(format!("Tagged {} with [{}]", node_id, label_suffix)),
                        data: serde_json::json!({"node_id": node_id, "tag": label_suffix}),
                    },
                    Err(e) => TriggerResult {
                        trigger_id: trigger.id.clone(),
                        trigger_name: trigger.name.clone(),
                        action: "tag".into(),
                        success: false,
                        message: Some(format!("Tag failed: {}", e)),
                        data: serde_json::json!({}),
                    },
                },
                None => TriggerResult {
                    trigger_id: trigger.id.clone(),
                    trigger_name: trigger.name.clone(),
                    action: "tag".into(),
                    success: false,
                    message: Some("No node to tag".into()),
                    data: serde_json::json!({}),
                },
            }
        }

        Ok(TriggerAction::Deprecate) => {
            let reason = trigger
                .action_config
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("auto-deprecated by trigger");

            match ctx.node_id.as_deref() {
                Some(node_id) => match backend.deprecate_node(node_id).await {
                    Ok(()) => TriggerResult {
                        trigger_id: trigger.id.clone(),
                        trigger_name: trigger.name.clone(),
                        action: "deprecate".into(),
                        success: true,
                        message: Some(format!("Deprecated {}: {}", node_id, reason)),
                        data: serde_json::json!({"node_id": node_id, "reason": reason}),
                    },
                    Err(e) => TriggerResult {
                        trigger_id: trigger.id.clone(),
                        trigger_name: trigger.name.clone(),
                        action: "deprecate".into(),
                        success: false,
                        message: Some(format!("Deprecate failed: {}", e)),
                        data: serde_json::json!({}),
                    },
                },
                None => TriggerResult {
                    trigger_id: trigger.id.clone(),
                    trigger_name: trigger.name.clone(),
                    action: "deprecate".into(),
                    success: false,
                    message: Some("No node to deprecate".into()),
                    data: serde_json::json!({}),
                },
            }
        }

        Ok(TriggerAction::Webhook) => {
            // Webhook stays in sulcus (reqwest). Return a stub here.
            TriggerResult {
                trigger_id: trigger.id.clone(),
                trigger_name: trigger.name.clone(),
                action: "webhook".into(),
                success: false,
                message: Some(
                    "Webhook action must be dispatched by sulcus backend".into(),
                ),
                data: serde_json::json!({}),
            }
        }

        Ok(TriggerAction::Chain) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "chain".into(),
            success: false,
            message: Some("Chain triggers not yet implemented".into()),
            data: serde_json::json!({}),
        },

        Err(_) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: trigger.action.clone(),
            success: false,
            message: Some(format!("Unknown action: {}", trigger.action)),
            data: serde_json::json!({}),
        },
    }
}
