// Sulcus Trigger Engine (Cloud Server)
// Evaluates and fires triggers in response to memory events.
// Tenant-scoped — evaluates only triggers belonging to the current tenant.
//
// This is the differentiator. No other memory system has reactive triggers.

use serde::Serialize;
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{debug, info, warn};

use crate::siu_v2::SiuV2Classifier;

// Shared types from sulcus-types (TriggerEvent, TriggerAction have all variants + impls)
pub use sulcus_types::triggers::{TriggerEvent, TriggerAction};

// collect_notifications is identical — use from sulcus-core
pub use sulcus_core::triggers::collect_notifications;

/// Context passed when evaluating triggers
#[derive(Debug, Clone)]
pub struct TriggerContext {
    pub tenant_id: String,
    pub node_id: Option<String>,
    pub node_label: Option<String>,
    pub node_namespace: Option<String>,
    pub node_memory_type: Option<String>,
    pub node_heat: Option<f32>,
    pub old_heat: Option<f32>,
}

// TriggerResult imported from shared types
pub use sulcus_types::triggers::TriggerResult;

/// A matched trigger ready to fire
struct MatchedTrigger {
    id: String,
    name: String,
    action: String,
    action_config: serde_json::Value,
    /// Filter summary for SITU input (e.g. "type=fact,heat_below=0.1")
    filter_memory_type: Option<String>,
    filter_heat_below: Option<f32>,
    filter_heat_above: Option<f32>,
}

impl MatchedTrigger {
    /// Build a compact filter summary string for SITU model input.
    fn filter_summary(&self) -> String {
        let mut parts = Vec::new();
        if let Some(ref t) = self.filter_memory_type {
            parts.push(format!("type={}", t));
        }
        if let Some(h) = self.filter_heat_below {
            parts.push(format!("heat_below={}", h));
        }
        if let Some(h) = self.filter_heat_above {
            parts.push(format!("heat_above={}", h));
        }
        if parts.is_empty() {
            "no_filter".to_string()
        } else {
            parts.join(",")
        }
    }
}

/// Evaluate all matching triggers for an event and fire them.
/// Returns notifications that should be surfaced to the agent.
///
/// If a SITU classifier is provided, it pre-filters triggers to skip those
/// that SITU predicts won't fire (with high confidence). This reduces
/// unnecessary DB writes and action executions.
pub async fn evaluate_triggers(
    pool: &PgPool,
    event: TriggerEvent,
    ctx: &TriggerContext,
) -> Vec<TriggerResult> {
    evaluate_triggers_with_situ(pool, event, ctx, None).await
}

/// Evaluate triggers with optional SITU pre-filtering.
pub async fn evaluate_triggers_with_situ(
    pool: &PgPool,
    event: TriggerEvent,
    ctx: &TriggerContext,
    situ: Option<&Arc<SiuV2Classifier>>,
) -> Vec<TriggerResult> {
    let matched = match find_matching_triggers(pool, &event, ctx).await {
        Ok(m) => m,
        Err(e) => {
            warn!(error = %e, tenant = %ctx.tenant_id, "trigger evaluation failed");
            return Vec::new();
        }
    };

    if matched.is_empty() {
        return Vec::new();
    }

    debug!(
        event = event.as_str(),
        tenant = %ctx.tenant_id,
        count = matched.len(),
        "evaluating triggers"
    );

    let mut results = Vec::with_capacity(matched.len());
    let mut situ_skipped = 0u32;

    for trigger in &matched {
        // SITU pre-filter: ask the model if this trigger should fire
        if let Some(classifier) = situ {
            if classifier.situ_available() {
                let filter_str = trigger.filter_summary();
                let mem_label = ctx.node_label.as_deref().unwrap_or("");
                let mem_type = ctx.node_memory_type.as_deref().unwrap_or("unknown");
                let heat = ctx.node_heat.unwrap_or(0.0);

                if !classifier.should_trigger_fire(
                    event.as_str(), mem_label, &trigger.name,
                    &filter_str, mem_type, heat,
                ) {
                    situ_skipped += 1;
                    continue;
                }
            }
        }

        let result = fire_trigger(pool, trigger, &event, ctx).await;
        results.push(result);
    }

    if situ_skipped > 0 {
        debug!(
            event = event.as_str(),
            tenant = %ctx.tenant_id,
            skipped = situ_skipped,
            fired = results.len(),
            "SITU pre-filtered triggers"
        );
    }

    results
}

// collect_notifications is re-exported from sulcus_core::triggers above

/// Find triggers that match the current event + context filters (tenant-scoped).
async fn find_matching_triggers(
    pool: &PgPool,
    event: &TriggerEvent,
    ctx: &TriggerContext,
) -> anyhow::Result<Vec<MatchedTrigger>> {
    let rows = sqlx::query_as::<
        _,
        (
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
        ),
    >(
        r#"SELECT id, name, action, action_config, fire_count, max_fires,
                  filter_memory_type, filter_namespace, filter_label_pattern,
                  filter_heat_below, filter_heat_above, cooldown_seconds,
                  last_fired_at::text
           FROM triggers
           WHERE tenant_id = $1 AND event = $2 AND enabled = TRUE"#,
    )
    .bind(&ctx.tenant_id)
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
        // Max fires check
        if let Some(max) = max_fires {
            if fire_count >= max {
                continue;
            }
        }

        // Cooldown check
        if cooldown_seconds > 0 {
            if let Some(ref last) = last_fired_at {
                if let Ok(last_time) = chrono::DateTime::parse_from_rfc3339(last) {
                    let elapsed = (now - last_time.with_timezone(&chrono::Utc)).num_seconds();
                    if elapsed < cooldown_seconds as i64 {
                        continue;
                    }
                }
            }
        }

        // Memory type filter
        if let Some(ref ft) = filter_memory_type {
            if let Some(ref mt) = ctx.node_memory_type {
                if ft != mt {
                    continue;
                }
            }
        }

        // Namespace filter
        if let Some(ref fn_) = filter_namespace {
            if let Some(ref ns) = ctx.node_namespace {
                if fn_ != ns {
                    continue;
                }
            }
        }

        // Label pattern filter (case-insensitive contains)
        if let Some(ref pattern) = filter_label_pattern {
            if let Some(ref label) = ctx.node_label {
                if !label
                    .to_lowercase()
                    .contains(&pattern.to_lowercase().replace('%', ""))
                {
                    continue;
                }
            }
        }

        // Heat threshold filters
        if let Some(below) = filter_heat_below {
            if let Some(heat) = ctx.node_heat {
                if heat >= below {
                    continue;
                }
            }
        }

        if let Some(above) = filter_heat_above {
            if let Some(heat) = ctx.node_heat {
                if heat <= above {
                    continue;
                }
            }
        }

        matched.push(MatchedTrigger {
            id,
            name,
            action,
            action_config,
            filter_memory_type,
            filter_heat_below,
            filter_heat_above,
        });
    }

    Ok(matched)
}

/// Fire a single trigger and log it.
async fn fire_trigger(
    pool: &PgPool,
    trigger: &MatchedTrigger,
    event: &TriggerEvent,
    ctx: &TriggerContext,
) -> TriggerResult {
    let action = trigger.action.parse::<TriggerAction>();

    let result = match action {
        Ok(TriggerAction::Notify) => fire_notify(trigger, ctx),
        Ok(TriggerAction::Boost) => fire_boost(pool, trigger, ctx).await,
        Ok(TriggerAction::Pin) => fire_pin(pool, trigger, ctx).await,
        Ok(TriggerAction::Tag) => fire_tag(pool, trigger, ctx).await,
        Ok(TriggerAction::Deprecate) => fire_deprecate(pool, trigger, ctx).await,
        Ok(TriggerAction::Webhook) => fire_webhook(trigger, ctx).await,
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
    };

    // Update fire count + last_fired_at — only on actual success
    if result.success {
        let now = chrono::Utc::now();
        match sqlx::query(
            "UPDATE triggers SET fire_count = fire_count + 1, last_fired_at = $1, updated_at = NOW() WHERE id = $2"
        )
        .bind(now)
        .bind(&trigger.id)
        .execute(pool)
        .await
        {
            Ok(r) => {
                if r.rows_affected() == 0 {
                    tracing::warn!(
                        trigger_id = %trigger.id,
                        "trigger fire_count update matched 0 rows — trigger ID may not exist in triggers table"
                    );
                }
            }
            Err(e) => {
                tracing::error!(
                    trigger_id = %trigger.id,
                    error = %e,
                    "failed to update trigger fire_count"
                );
            }
        }
    }

    // Log trigger firing
    let log_id = uuid::Uuid::now_v7().to_string();
    let _ = sqlx::query(
        "INSERT INTO trigger_log (id, trigger_id, tenant_id, event, node_id, action, action_result, fired_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())"
    )
    .bind(&log_id)
    .bind(&trigger.id)
    .bind(&ctx.tenant_id)
    .bind(event.as_str())
    .bind(&ctx.node_id)
    .bind(&trigger.action)
    .bind(serde_json::to_value(&result).unwrap_or_default())
    .execute(pool)
    .await;

    info!(
        trigger_id = %trigger.id,
        trigger_name = %trigger.name,
        action = %trigger.action,
        tenant = %ctx.tenant_id,
        success = result.success,
        "trigger fired"
    );

    result
}

fn fire_notify(trigger: &MatchedTrigger, ctx: &TriggerContext) -> TriggerResult {
    let msg = trigger
        .action_config
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("Trigger fired")
        .to_string();

    let label_val = ctx.node_label.as_deref().unwrap_or("");
    let msg = msg
        .replace("{node_id}", ctx.node_id.as_deref().unwrap_or(""))
        .replace("{label}", label_val)
        .replace("{content}", label_val)  // alias — many triggers use {content} for the memory text
        .replace("{namespace}", ctx.node_namespace.as_deref().unwrap_or(""))
        .replace(
            "{heat}",
            &ctx.node_heat
                .map(|h| format!("{:.4}", h))
                .unwrap_or_default(),
        )
        .replace(
            "{old_heat}",
            &ctx.old_heat
                .map(|h| format!("{:.4}", h))
                .unwrap_or_default(),
        )
        .replace(
            "{memory_type}",
            ctx.node_memory_type.as_deref().unwrap_or(""),
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

    let node_id = trigger
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

    let Some(node_id) = node_id else {
        return TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "boost".into(),
            success: false,
            message: Some("No target node".into()),
            data: serde_json::json!({}),
        };
    };

    let result = sqlx::query(
        "UPDATE golden_index SET current_heat = LEAST(current_heat + $1, 1.0), updated_at = NOW() \
         WHERE id = $2::uuid AND tenant_id = $3",
    )
    .bind(strength)
    .bind(node_id)
    .bind(&ctx.tenant_id)
    .execute(pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "boost".into(),
            success: true,
            message: Some(format!("Boosted {} by {:.2}", node_id, strength)),
            data: serde_json::json!({"target": node_id, "strength": strength, "rows_affected": r.rows_affected()}),
        },
        Ok(r) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "boost".into(),
            success: false,
            message: Some(format!("Boost had no effect on {} (0 rows — node not found or not owned by tenant)", node_id)),
            data: serde_json::json!({"target": node_id, "rows_affected": r.rows_affected()}),
        },
        Err(e) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "boost".into(),
            success: false,
            message: Some(format!("Boost query failed for {}: {}", node_id, e)),
            data: serde_json::json!({"target": node_id, "error": e.to_string()}),
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

    let result = sqlx::query(
        "UPDATE golden_index SET is_pinned = TRUE, updated_at = NOW() WHERE id = $1::uuid AND tenant_id = $2"
    )
    .bind(node_id).bind(&ctx.tenant_id)
    .execute(pool).await;

    match result {
        Ok(r) if r.rows_affected() > 0 => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "pin".into(),
            success: true,
            message: Some(format!("Pinned {}", node_id)),
            data: serde_json::json!({"node_id": node_id}),
        },
        Ok(r) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "pin".into(),
            success: false,
            message: Some(format!("Pin had no effect on {} (0 rows — already pinned or node not found)", node_id)),
            data: serde_json::json!({"node_id": node_id, "rows_affected": r.rows_affected()}),
        },
        Err(e) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "pin".into(),
            success: false,
            message: Some(format!("Pin query failed for {}: {}", node_id, e)),
            data: serde_json::json!({"node_id": node_id, "error": e.to_string()}),
        },
    }
}

async fn fire_tag(pool: &PgPool, trigger: &MatchedTrigger, ctx: &TriggerContext) -> TriggerResult {
    let tag_label = trigger
        .action_config
        .get("label")
        .or_else(|| trigger.action_config.get("tag"))
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

    let result = sqlx::query(
        "UPDATE golden_index SET pointer_summary = pointer_summary || ' [' || $1 || ']', updated_at = NOW() \
         WHERE id = $2::uuid AND tenant_id = $3 AND pointer_summary NOT LIKE '%[' || $1 || ']%'",
    )
    .bind(tag_label)
    .bind(node_id)
    .bind(&ctx.tenant_id)
    .execute(pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "tag".into(),
            success: true,
            message: Some(format!("Tagged {} with [{}]", node_id, tag_label)),
            data: serde_json::json!({"node_id": node_id, "tag": tag_label}),
        },
        Ok(r) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "tag".into(),
            success: false,
            message: Some(format!("Tag had no effect on {} (0 rows — already tagged or node not found)", node_id)),
            data: serde_json::json!({"node_id": node_id, "rows_affected": r.rows_affected()}),
        },
        Err(e) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "tag".into(),
            success: false,
            message: Some(format!("Tag query failed for {}: {}", node_id, e)),
            data: serde_json::json!({"node_id": node_id, "error": e.to_string()}),
        },
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
        "UPDATE golden_index SET current_heat = GREATEST(current_heat * 0.5, 0.01), \
         updated_at = NOW() WHERE id = $1::uuid AND tenant_id = $2",
    )
    .bind(node_id)
    .bind(&ctx.tenant_id)
    .execute(pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "deprecate".into(),
            success: true,
            message: Some(format!("Deprecated {}: {}", node_id, reason)),
            data: serde_json::json!({"node_id": node_id, "reason": reason}),
        },
        Ok(r) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "deprecate".into(),
            success: false,
            message: Some(format!("Deprecate had no effect on {} (0 rows)", node_id)),
            data: serde_json::json!({"node_id": node_id, "rows_affected": r.rows_affected()}),
        },
        Err(e) => TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "deprecate".into(),
            success: false,
            message: Some(format!("Deprecate query failed for {}: {}", node_id, e)),
            data: serde_json::json!({"node_id": node_id, "error": e.to_string()}),
        },
    }
}

/// Reject webhook URLs targeting private/loopback/link-local networks (SSRF protection).
fn is_safe_webhook_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else { return false };
    // Must be HTTPS (or HTTP for dev, but block private IPs regardless)
    if !matches!(parsed.scheme(), "https" | "http") { return false; }
    let Some(host) = parsed.host_str() else { return false };
    // Block known private/internal hostnames
    if host == "localhost" || host.ends_with(".internal") || host.ends_with(".local") { return false; }
    // Block private IP ranges
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(v4) => {
                if v4.is_loopback() || v4.is_private() || v4.is_link_local()
                    || v4.octets()[0] == 169 && v4.octets()[1] == 254  // link-local
                    || v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64  // CGNAT
                { return false; }
            }
            std::net::IpAddr::V6(v6) => {
                if v6.is_loopback() || v6.segments()[0] == 0xfe80 || v6.segments()[0] == 0xfc00
                { return false; }
            }
        }
    }
    true
}

async fn fire_webhook(trigger: &MatchedTrigger, ctx: &TriggerContext) -> TriggerResult {
    let Some(url) = trigger.action_config.get("url").and_then(|v| v.as_str()) else {
        return TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "webhook".into(),
            success: false,
            message: Some("No webhook URL configured".into()),
            data: serde_json::json!({}),
        };
    };

    if !is_safe_webhook_url(url) {
        return TriggerResult {
            trigger_id: trigger.id.clone(),
            trigger_name: trigger.name.clone(),
            action: "webhook".into(),
            success: false,
            message: Some("Webhook URL rejected: private/internal addresses not allowed".into()),
            data: serde_json::json!({}),
        };
    }

    let body = serde_json::json!({
        "trigger_id": trigger.id,
        "trigger_name": trigger.name,
        "node_id": ctx.node_id,
        "node_label": ctx.node_label,
        "node_namespace": ctx.node_namespace,
        "node_memory_type": ctx.node_memory_type,
        "node_heat": ctx.node_heat,
        "old_heat": ctx.old_heat,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    match client.post(url).json(&body).send().await {
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
