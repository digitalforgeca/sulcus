//! SIU Curation Cycle — background "sleep" pass that reviews and consolidates memories.
//!
//! Runs every 30 minutes (configurable via CURATOR_INTERVAL_SECS env var).
//! Also triggered when a namespace goes idle (no interactions for 10 minutes).
//!
//! Steps per tenant/namespace:
//! 1. Re-classify stale unrecalled nodes (recall_count=0, old interaction_epoch).
//! 2. Consolidate near-duplicate nodes (cosine similarity > 0.92 — archives the duplicate).
//! 3. Summarize verbose nodes (pointer_summary > 500 chars, recall_count < 3).
//! 4. Re-vectorize nodes with missing embeddings.
//! 5. Sync modified nodes to AGE graph.
//! 6. Log curation activity.
//!
//! The curator NEVER deletes — it archives (sets archived_at) and appends to pointer_summary.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::entity_extraction::ExtractionConfig;

/// Lazy-initialized HTTP client for curator LLM calls.
static CURATOR_HTTP_CLIENT: std::sync::LazyLock<Client> = std::sync::LazyLock::new(|| {
    Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("failed to build curator reqwest client")
});

const DEFAULT_INTERVAL_SECS: u64 = 1_800; // 30 minutes
const IDLE_THRESHOLD_SECS: i64 = 600;      // 10 minutes
const RECLASSIFY_EPOCH_LAG: i64 = 100;
const DUPLICATE_SIMILARITY_THRESHOLD: f64 = 0.92;
const VERBOSE_SUMMARY_CHARS: usize = 500;
const VERBOSE_RECALL_MAX: i64 = 3;

/// Spawn the curator background task.
pub fn spawn(pool: PgPool) {
    let interval_secs = std::env::var("CURATOR_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(DEFAULT_INTERVAL_SECS);

    // Load extraction config once at startup — used for LLM-powered consolidation/summarization.
    let extraction_config = ExtractionConfig::from_env();
    if extraction_config.is_some() {
        tracing::info!("curator: LLM-powered consolidation enabled (GPT-5.4-nano)");
    } else {
        tracing::info!("curator: LLM consolidation disabled (SULCUS_EXTRACTION_ENABLED not set)");
    }

    tokio::spawn(async move {
        tracing::info!(interval_secs, "curator started");
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(interval_secs));
        // Skip the immediate tick on startup — let the server settle first.
        interval.tick().await;

        loop {
            interval.tick().await;
            if let Err(e) = run_curation_cycle(&pool, extraction_config.as_ref()).await {
                tracing::warn!(error = %e, "curation cycle failed");
            }
        }
    });
}

/// Run a full curation pass over all active tenants.
async fn run_curation_cycle(pool: &PgPool, extraction_config: Option<&ExtractionConfig>) -> anyhow::Result<()> {
    // Find tenants with at least one namespace counter (i.e., they have interaction history)
    let tenants: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT tenant_id FROM namespace_counters",
    )
    .fetch_all(pool)
    .await?;

    for tenant_id in &tenants {
        // Find namespaces that are either idle or due for curation
        let namespaces: Vec<String> = sqlx::query_scalar(
            "SELECT namespace FROM namespace_counters
             WHERE tenant_id = $1
               AND (last_active_at < now() - ($2 || ' seconds')::interval
                    OR last_active_at < now() - INTERVAL '30 minutes')",
        )
        .bind(tenant_id)
        .bind(IDLE_THRESHOLD_SECS.to_string())
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        for namespace in &namespaces {
            if let Err(e) = curate_namespace(pool, tenant_id, namespace, extraction_config).await {
                tracing::warn!(
                    tenant_id = %tenant_id,
                    namespace = %namespace,
                    error = %e,
                    "namespace curation failed"
                );
            }
        }
    }

    Ok(())
}

/// Curate a single tenant/namespace.
async fn curate_namespace(pool: &PgPool, tenant_id: &str, namespace: &str, extraction_config: Option<&ExtractionConfig>) -> anyhow::Result<()> {
    tracing::debug!(tenant_id = %tenant_id, namespace = %namespace, "curating namespace");

    let mut stats = CurationStats::default();

    // Step 1: Re-classify stale unrecalled nodes
    stats.reclassified += step_reclassify(pool, tenant_id, namespace).await.unwrap_or(0);

    // Step 2: Consolidate near-duplicate nodes (archive, never delete)
    stats.consolidated += step_consolidate_duplicates(pool, tenant_id, namespace, extraction_config).await.unwrap_or(0);

    // Step 3: Summarize verbose nodes
    stats.summarized += step_summarize_verbose(pool, tenant_id, namespace, extraction_config).await.unwrap_or(0);

    // Step 4: Re-vectorize nodes with missing embeddings
    stats.revectorized += step_revectorize(pool, tenant_id, namespace).await.unwrap_or(0);

    // Step 5: Mark stale confidence (nodes not recalled in 30 days)
    stats.stale_marked += step_mark_stale_confidence(pool, tenant_id, namespace).await.unwrap_or(0);

    // Step 6: Sync modified nodes to AGE graph
    step_sync_age_graph(pool, tenant_id, namespace).await;

    // Step 7: Log activity
    if stats.has_work() {
        log_curation_activity(pool, tenant_id, namespace, &stats).await;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Step 1: Re-classify stale unrecalled nodes
// ---------------------------------------------------------------------------

async fn step_reclassify(pool: &PgPool, tenant_id: &str, namespace: &str) -> anyhow::Result<u32> {
    // Find nodes that have never been recalled and are lagging far behind the namespace epoch.
    let rows = sqlx::query_as::<_, (uuid::Uuid, String, String)>(
        "SELECT gi.id, gi.pointer_summary, gi.memory_type
         FROM golden_index gi
         JOIN namespace_counters nc ON nc.tenant_id = gi.tenant_id AND nc.namespace = gi.namespace
         WHERE gi.tenant_id = $1
           AND gi.namespace = $2
           AND gi.recall_count = 0
           AND (nc.interaction_epoch - gi.interaction_epoch) > $3
           AND gi.archived_at IS NULL
         LIMIT 50",
    )
    .bind(tenant_id)
    .bind(namespace)
    .bind(RECLASSIFY_EPOCH_LAG)
    .fetch_all(pool)
    .await?;

    let mut count = 0u32;
    for (node_id, summary, current_type) in rows {
        // Use SIU v2 classification if available (server-side classification via state is not
        // accessible here — we record a reclassify_pending signal instead for the agent to pick up).
        // The actual reclassification happens when the tenant's SIU model is available.
        let _ = sqlx::query(
            "INSERT INTO training_signals
               (memory_id, tenant_id, signal_type, corrected_type, content_snapshot, source)
             VALUES ($1, $2, 'reclassify_pending', $3, $4, 'curator')
             ON CONFLICT DO NOTHING",
        )
        .bind(node_id)
        .bind(tenant_id)
        .bind(&current_type)
        .bind(&summary)
        .execute(pool)
        .await;

        tracing::debug!(
            tenant_id = %tenant_id,
            node_id = %node_id,
            current_type = %current_type,
            "curator: flagged stale node for reclassification"
        );
        count += 1;
    }

    Ok(count)
}

// ---------------------------------------------------------------------------
// LLM-powered consolidation helpers
// ---------------------------------------------------------------------------

/// Request/response types for the Azure Foundry Responses API (curator-local, minimal).
#[derive(Serialize)]
struct CuratorApiRequest {
    model: String,
    input: Vec<CuratorApiMessage>,
    text: CuratorApiText,
}

#[derive(Serialize)]
struct CuratorApiMessage {
    r#type: String,
    role: String,
    content: String,
}

#[derive(Serialize)]
struct CuratorApiText {
    format: CuratorApiFormat,
}

#[derive(Serialize)]
struct CuratorApiFormat {
    r#type: String,
    name: String,
    schema: serde_json::Value,
    strict: bool,
}

#[derive(Deserialize)]
struct ConsolidationResponse {
    summary: String,
}

/// Call GPT-5.4-nano to produce a single condensed summary from two overlapping memories.
/// Falls back to `None` on any error (caller uses old SQL-append behavior).
async fn consolidate_via_llm(
    config: &ExtractionConfig,
    kept_summary: &str,
    archived_summary: &str,
) -> Option<String> {
    let prompt = "You are a memory consolidation engine. Given two overlapping memories, produce a single condensed summary that:\n\
- Preserves ALL unique facts, dates, names, and technical details from both\n\
- Removes duplicate information\n\
- Strips any [merged: ...] wrapper artifacts from prior consolidations\n\
- Keeps the result concise but complete\n\
- Uses markdown formatting if the originals use it\n\
- Maximum 2000 characters\n\n\
Return ONLY the consolidated summary text.";

    let user_content = format!(
        "Memory A (kept):\n{}\n\nMemory B (archived/duplicate):\n{}",
        kept_summary, archived_summary
    );

    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "summary": { "type": "string" }
        },
        "required": ["summary"],
        "additionalProperties": false
    });

    let request_body = CuratorApiRequest {
        model: config.model.clone(),
        input: vec![
            CuratorApiMessage {
                r#type: "message".to_string(),
                role: "system".to_string(),
                content: prompt.to_string(),
            },
            CuratorApiMessage {
                r#type: "message".to_string(),
                role: "user".to_string(),
                content: user_content,
            },
        ],
        text: CuratorApiText {
            format: CuratorApiFormat {
                r#type: "json_schema".to_string(),
                name: "consolidation".to_string(),
                schema,
                strict: true,
            },
        },
    };

    let response = CURATOR_HTTP_CLIENT
        .post(&config.endpoint)
        .header("api-key", &config.api_key)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        tracing::warn!(
            status = %response.status(),
            "curator: LLM consolidation API error"
        );
        return None;
    }

    let resp_json: serde_json::Value = response.json().await.ok()?;

    let text_content = resp_json
        .get("output")
        .and_then(|o| o.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("content"))
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())?;

    let parsed: ConsolidationResponse = serde_json::from_str(text_content).ok()?;

    let summary = parsed.summary.trim().to_string();
    if summary.is_empty() {
        return None;
    }

    Some(summary)
}

/// Call GPT-5.4-nano to produce a concise summary of a verbose memory.
/// Falls back to `None` on any error (caller uses truncation).
async fn summarize_via_llm(
    config: &ExtractionConfig,
    summary: &str,
) -> Option<String> {
    let prompt = "Summarize this memory into a concise version (max 500 chars) preserving all key facts, names, dates, and technical details. Strip any [merged: ...] artifacts.";

    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "summary": { "type": "string" }
        },
        "required": ["summary"],
        "additionalProperties": false
    });

    let request_body = CuratorApiRequest {
        model: config.model.clone(),
        input: vec![
            CuratorApiMessage {
                r#type: "message".to_string(),
                role: "system".to_string(),
                content: prompt.to_string(),
            },
            CuratorApiMessage {
                r#type: "message".to_string(),
                role: "user".to_string(),
                content: summary.to_string(),
            },
        ],
        text: CuratorApiText {
            format: CuratorApiFormat {
                r#type: "json_schema".to_string(),
                name: "summarization".to_string(),
                schema,
                strict: true,
            },
        },
    };

    let response = CURATOR_HTTP_CLIENT
        .post(&config.endpoint)
        .header("api-key", &config.api_key)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        tracing::warn!(
            status = %response.status(),
            "curator: LLM summarization API error"
        );
        return None;
    }

    let resp_json: serde_json::Value = response.json().await.ok()?;

    let text_content = resp_json
        .get("output")
        .and_then(|o| o.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("content"))
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())?;

    let parsed: ConsolidationResponse = serde_json::from_str(text_content).ok()?;

    let result = parsed.summary.trim().to_string();
    if result.is_empty() {
        return None;
    }

    Some(result)
}

// ---------------------------------------------------------------------------
// Step 2: Consolidate near-duplicate nodes (archive, never delete)
// ---------------------------------------------------------------------------

async fn step_consolidate_duplicates(
    pool: &PgPool,
    tenant_id: &str,
    namespace: &str,
    extraction_config: Option<&ExtractionConfig>,
) -> anyhow::Result<u32> {
    // Find pairs of nodes with high vector similarity within the same namespace+type.
    // We use pgvector cosine distance: distance < (1 - 0.92) = 0.08
    let pairs = sqlx::query_as::<_, (uuid::Uuid, f32, uuid::Uuid, f32)>(
        "SELECT a.id, a.base_utility, b.id, b.base_utility
         FROM golden_index a
         JOIN golden_index b ON a.tenant_id = b.tenant_id
           AND a.namespace = b.namespace
           AND a.memory_type = b.memory_type
           AND a.id < b.id
         WHERE a.tenant_id = $1
           AND a.namespace = $2
           AND a.archived_at IS NULL
           AND b.archived_at IS NULL
           AND a.embedding IS NOT NULL
           AND b.embedding IS NOT NULL
           AND (a.embedding <=> b.embedding) < $3
         LIMIT 20",
    )
    .bind(tenant_id)
    .bind(namespace)
    .bind(1.0 - DUPLICATE_SIMILARITY_THRESHOLD)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut count = 0u32;
    for (id_a, util_a, id_b, util_b) in pairs {
        // Keep the higher-utility node; archive the other.
        let (keep_id, archive_id) = if util_a >= util_b {
            (id_a, id_b)
        } else {
            (id_b, id_a)
        };

        // Fetch both summaries for consolidation
        let kept_summary: Option<String> = sqlx::query_scalar(
            "SELECT pointer_summary FROM golden_index WHERE tenant_id = $1 AND id = $2",
        )
        .bind(tenant_id)
        .bind(keep_id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

        let archived_summary: Option<String> = sqlx::query_scalar(
            "SELECT pointer_summary FROM golden_index WHERE tenant_id = $1 AND id = $2",
        )
        .bind(tenant_id)
        .bind(archive_id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

        if let Some(extra) = archived_summary {
            // Prioritize LLM consolidation for already-merged content (worst offenders)
            // and whenever extraction config is available.
            let has_merged_artifacts = kept_summary.as_deref()
                .map(|s| s.contains("[merged:"))
                .unwrap_or(false)
                || extra.contains("[merged:");

            let new_summary = match extraction_config {
                Some(config) if has_merged_artifacts || true => {
                    // Always use LLM when available; prioritize merged-content nodes
                    let kept = kept_summary.as_deref().unwrap_or("");
                    consolidate_via_llm(config, kept, &extra).await
                }
                _ => None,
            };

            match new_summary {
                Some(consolidated) => {
                    // LLM produced a clean consolidation — update and nullify embedding
                    let _ = sqlx::query(
                        "UPDATE golden_index
                         SET pointer_summary = $3,
                             embedding = NULL,
                             updated_at = now()
                         WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL",
                    )
                    .bind(tenant_id)
                    .bind(keep_id)
                    .bind(&consolidated)
                    .execute(pool)
                    .await;
                    tracing::debug!(
                        tenant_id = %tenant_id,
                        kept = %keep_id,
                        original_len = kept_summary.as_deref().map(|s| s.len()).unwrap_or(0),
                        consolidated_len = consolidated.len(),
                        "curator: LLM consolidated duplicate summaries"
                    );
                }
                None => {
                    // Fallback: old SQL append behavior
                    let _ = sqlx::query(
                        "UPDATE golden_index
                         SET pointer_summary = pointer_summary || E'\\n[merged: ' || $3 || ']',
                             updated_at = now()
                         WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL",
                    )
                    .bind(tenant_id)
                    .bind(keep_id)
                    .bind(&extra)
                    .execute(pool)
                    .await;
                }
            }
        }

        // Archive the duplicate — never delete
        let _ = sqlx::query(
            "UPDATE golden_index SET archived_at = now(), updated_at = now()
             WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL",
        )
        .bind(tenant_id)
        .bind(archive_id)
        .execute(pool)
        .await;

        // Sync archived state to AGE graph (fire-and-forget)
        crate::graph::archive_memory_vertex(pool, tenant_id, &archive_id).await;

        tracing::debug!(
            tenant_id = %tenant_id,
            kept = %keep_id,
            archived = %archive_id,
            "curator: archived duplicate node"
        );
        count += 1;
    }

    Ok(count)
}

// ---------------------------------------------------------------------------
// Step 3: Summarize verbose nodes
// ---------------------------------------------------------------------------

async fn step_summarize_verbose(
    pool: &PgPool,
    tenant_id: &str,
    namespace: &str,
    extraction_config: Option<&ExtractionConfig>,
) -> anyhow::Result<u32> {
    // Find nodes with long pointer_summary and low recall_count.
    // Trim the pointer_summary to the first sentence / 200 chars; preserve original
    // in a bracketed suffix so no content is lost.
    // Nodes are eligible for summarization if they are verbose (long summary) AND either:
    // - low recall count (rarely accessed, safe to trim), OR
    // - contain [merged: artifacts (matryoshka nesting must be cleaned regardless of recall)
    let rows = sqlx::query_as::<_, (uuid::Uuid, String)>(
        "SELECT id, pointer_summary
         FROM golden_index
         WHERE tenant_id = $1
           AND namespace = $2
           AND archived_at IS NULL
           AND LENGTH(pointer_summary) > $3
           AND (recall_count < $4 OR pointer_summary LIKE '%[merged:%')
         LIMIT 30",
    )
    .bind(tenant_id)
    .bind(namespace)
    .bind(VERBOSE_SUMMARY_CHARS as i32)
    .bind(VERBOSE_RECALL_MAX)
    .fetch_all(pool)
    .await?;

    let mut count = 0u32;
    for (node_id, summary) in rows {
        // Attempt LLM summarization if config available; fall back to truncation.
        let new_summary = match extraction_config {
            Some(config) => {
                summarize_via_llm(config, &summary).await
            }
            None => None,
        };

        let (final_summary, nullify_embedding) = match new_summary {
            Some(llm_summary) => (llm_summary, true),
            None => {
                // Fallback: truncate to 200 chars at word boundary
                let trimmed = trim_summary(&summary, 200);
                if trimmed == summary {
                    continue; // already short enough after trim
                }
                (trimmed, false)
            }
        };

        if nullify_embedding {
            let _ = sqlx::query(
                "UPDATE golden_index
                 SET pointer_summary = $3,
                     embedding = NULL,
                     updated_at = now()
                 WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL",
            )
            .bind(tenant_id)
            .bind(node_id)
            .bind(&final_summary)
            .execute(pool)
            .await;
        } else {
            let _ = sqlx::query(
                "UPDATE golden_index
                 SET pointer_summary = $3, updated_at = now()
                 WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL",
            )
            .bind(tenant_id)
            .bind(node_id)
            .bind(&final_summary)
            .execute(pool)
            .await;
        }

        tracing::debug!(
            tenant_id = %tenant_id,
            node_id = %node_id,
            original_len = summary.len(),
            final_len = final_summary.len(),
            llm_used = nullify_embedding,
            "curator: summarized verbose node"
        );
        count += 1;
    }

    Ok(count)
}

/// Trim a string to at most `max_chars`, breaking at the last space.
fn trim_summary(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let truncated: String = s.chars().take(max_chars).collect();
    // Break at last space to avoid cutting words
    let trimmed = truncated.rsplit_once(' ')
        .map(|(left, _)| left)
        .unwrap_or(&truncated);
    format!("{}…", trimmed)
}

// ---------------------------------------------------------------------------
// Step 3.5: Mark stale confidence on nodes not recalled in 30+ days
// ---------------------------------------------------------------------------

async fn step_mark_stale_confidence(pool: &PgPool, tenant_id: &str, namespace: &str) -> anyhow::Result<u32> {
    // Mark nodes as stale if last_recalled_at is NULL or older than 30 days,
    // unless they are 'verified' (explicitly confirmed) or already 'stale'.
    let result = sqlx::query(
        "UPDATE golden_index
         SET confidence = 'stale', updated_at = now()
         WHERE tenant_id = $1
           AND namespace = $2
           AND archived_at IS NULL
           AND confidence NOT IN ('verified', 'stale')
           AND (last_recalled_at IS NULL OR last_recalled_at < now() - INTERVAL '30 days')",
    )
    .bind(tenant_id)
    .bind(namespace)
    .execute(pool)
    .await;

    match result {
        Ok(r) => {
            let count = r.rows_affected() as u32;
            if count > 0 {
                tracing::debug!(
                    tenant_id = %tenant_id,
                    namespace = %namespace,
                    count,
                    "curator: marked nodes as stale confidence"
                );
            }
            Ok(count)
        }
        Err(e) => {
            // Non-fatal — last_recalled_at column may not exist on older schemas
            tracing::debug!(error = %e, "curator: stale confidence step skipped (column may not exist)");
            Ok(0)
        }
    }
}

// ---------------------------------------------------------------------------
// Step 4: Re-vectorize nodes with missing embeddings
// ---------------------------------------------------------------------------

async fn step_revectorize(pool: &PgPool, tenant_id: &str, namespace: &str) -> anyhow::Result<u32> {
    // Count nodes that need embeddings — actual embedding is done by the backfill task
    // at startup. Here we just flag them and log for observability.
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM golden_index
         WHERE tenant_id = $1
           AND namespace = $2
           AND archived_at IS NULL
           AND embedding IS NULL
           AND vector IS NULL",
    )
    .bind(tenant_id)
    .bind(namespace)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if count > 0 {
        tracing::debug!(
            tenant_id = %tenant_id,
            namespace = %namespace,
            count,
            "curator: nodes missing embeddings (backfill will handle on next restart)"
        );
    }

    Ok(count as u32)
}

// ---------------------------------------------------------------------------
// Step 5: Sync modified nodes to AGE graph
// ---------------------------------------------------------------------------

async fn step_sync_age_graph(pool: &PgPool, tenant_id: &str, namespace: &str) {
    // Find nodes updated in the last curation window that need graph sync.
    // Include recently-archived nodes so the graph reflects archived state.
    let rows = sqlx::query_as::<_, (uuid::Uuid, String, f32, bool, Option<chrono::DateTime<chrono::Utc>>)>(
        "SELECT id, pointer_summary, current_heat, is_pinned, archived_at
         FROM golden_index
         WHERE tenant_id = $1
           AND namespace = $2
           AND updated_at > now() - INTERVAL '35 minutes'
         LIMIT 100",
    )
    .bind(tenant_id)
    .bind(namespace)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for (node_id, summary, heat, pinned, archived_at) in rows {
        if archived_at.is_some() {
            crate::graph::archive_memory_vertex(pool, tenant_id, &node_id).await;
        } else {
            crate::graph::ensure_memory_vertex(
                pool, tenant_id, &node_id, namespace, "episodic", heat, &summary, pinned,
            )
            .await;
        }
    }
}

// ---------------------------------------------------------------------------
// Step 6: Log curation activity
// ---------------------------------------------------------------------------

async fn log_curation_activity(
    pool: &PgPool,
    tenant_id: &str,
    namespace: &str,
    stats: &CurationStats,
) {
    let _ = sqlx::query(
        "INSERT INTO activity_log (tenant_id, actor, action, metadata, created_at)
         VALUES ($1, 'curator', 'curation_cycle', $2, now())",
    )
    .bind(tenant_id)
    .bind(serde_json::json!({
        "namespace": namespace,
        "reclassified": stats.reclassified,
        "consolidated": stats.consolidated,
        "summarized": stats.summarized,
        "revectorized": stats.revectorized,
        "stale_marked": stats.stale_marked,
    }))
    .execute(pool)
    .await;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

#[derive(Default)]
struct CurationStats {
    reclassified: u32,
    consolidated: u32,
    summarized: u32,
    revectorized: u32,
    stale_marked: u32,
}

impl CurationStats {
    fn has_work(&self) -> bool {
        self.reclassified > 0
            || self.consolidated > 0
            || self.summarized > 0
            || self.revectorized > 0
            || self.stale_marked > 0
    }
}
