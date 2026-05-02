//! SILU Output Evaluation — recursive language model supervisor.
//!
//! Called from the `llm_output` hook on the client plugin side.
//! Searches the memory graph for relevant context, then sends
//! both the output and retrieved memories to GPT nano for
//! semantic alignment evaluation.
//!
//! ## Config
//! Same as entity_extraction — uses `SULCUS_EXTRACTION_*` env vars.
//!
//! ## SCHEMA_REFERENCE.md rules
//! - Always use `$N::uuid` for UUID bindings
//! - Always use `pointer_summary` in raw SQL, never `label`
//! - Check `rows_affected() > 0` for UPDATE/DELETE success

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use axum::extract::State;
use axum::response::IntoResponse;
use axum::{Extension, Json};
use pgvector::Vector;
use serde::{Deserialize, Serialize};

use crate::entity_extraction::ExtractionConfig;
use crate::SharedState;

// ---------------------------------------------------------------------------
// Debounce: track last evaluation time per (tenant_id, namespace)
// ---------------------------------------------------------------------------

static DEBOUNCE: std::sync::LazyLock<Mutex<HashMap<String, Instant>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

const DEBOUNCE_SECS: u64 = 5;

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct EvaluateContext {
    pub prompt_summary: Option<String>,
    pub agent_id: Option<String>,
    pub turn_number: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct EvaluateRequest {
    pub output: String,
    pub context: Option<EvaluateContext>,
}

#[derive(Debug, Serialize)]
pub struct Issue {
    pub kind: String,
    pub description: String,
    pub memory_excerpt: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Alignment {
    pub score: f32,
    pub status: String,
    pub issues: Vec<Issue>,
    pub corrections: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct EvalMeta {
    pub memories_checked: i32,
    pub evaluation_ms: i32,
    pub model: String,
}

#[derive(Debug, Serialize)]
pub struct EvaluateResponse {
    pub alignment: Alignment,
    pub meta: EvalMeta,
}

// ---------------------------------------------------------------------------
// LLM wire types (Azure Foundry Responses API)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct ResponsesApiMessage {
    r#type: String,
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ResponsesApiText {
    format: ResponsesApiFormat,
}

#[derive(Debug, Serialize)]
struct ResponsesApiFormat {
    r#type: String,
    name: String,
    schema: serde_json::Value,
    strict: bool,
}

#[derive(Debug, Serialize)]
struct ResponsesApiRequest {
    model: String,
    input: Vec<ResponsesApiMessage>,
    text: ResponsesApiText,
}

// ---------------------------------------------------------------------------
// Structured LLM response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct LlmIssue {
    kind: String,
    description: String,
    memory_excerpt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmAlignment {
    score: f32,
    status: String,
    issues: Vec<LlmIssue>,
    corrections: Vec<String>,
}

// ---------------------------------------------------------------------------
// Evaluation prompt
// ---------------------------------------------------------------------------

const EVALUATION_PROMPT: &str = r#"You are the Sulcusian Intelligence Learning Unit (SILU), acting as a recursive language model supervisor.

You will receive:
1. An LLM output (the text an agent just produced)
2. A set of memory excerpts retrieved from that agent's persistent memory graph

Your task: evaluate whether the LLM output is semantically aligned with the agent's stored memories.

## Issue Types

**contradiction** — The output directly contradicts a stored memory.
  Example: output says "use TypeScript", memory says "user strongly prefers Python for all scripting"

**preference_drift** — The output ignores or violates a known user preference.
  Example: output uses emoji extensively, memory says "user dislikes emoji in responses"

**hallucinated_specific** — The output cites specific facts (names, numbers, dates, configs) not found in any memory.
  Example: output says "the API key is sk-abc123" but no such key appears in memory

## Scoring

- 1.0 = fully aligned, no issues
- 0.8–0.99 = minor issues, mostly aligned
- 0.5–0.79 = moderate issues, corrections recommended
- 0.0–0.49 = significant misalignment, output may mislead the user

## Status Values

- "aligned" — score >= 0.8
- "drift" — score 0.5–0.79
- "misaligned" — score < 0.5

## Corrections

For each issue found, provide a concrete correction the agent can inject into its next turn to realign.
Keep corrections short and actionable (1-2 sentences).

If no memories were provided, score 1.0 with status "aligned" and no issues — you cannot evaluate without context.
Do NOT hallucinate contradictions. Only flag issues clearly supported by the provided memory excerpts."#;

// ---------------------------------------------------------------------------
// JSON schema for structured output
// ---------------------------------------------------------------------------

fn evaluation_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "score": { "type": "number" },
            "status": { "type": "string", "enum": ["aligned", "drift", "misaligned"] },
            "issues": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": { "type": "string", "enum": ["contradiction", "preference_drift", "hallucinated_specific"] },
                        "description": { "type": "string" },
                        "memory_excerpt": { "type": ["string", "null"] }
                    },
                    "required": ["kind", "description"],
                    "additionalProperties": false
                }
            },
            "corrections": {
                "type": "array",
                "items": { "type": "string" }
            }
        },
        "required": ["score", "status", "issues", "corrections"],
        "additionalProperties": false
    })
}

// ---------------------------------------------------------------------------
// HTTP_CLIENT (same pattern as entity_extraction.rs)
// ---------------------------------------------------------------------------

static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> =
    std::sync::LazyLock::new(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("failed to build reqwest client")
    });

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn evaluate_output(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<EvaluateRequest>,
) -> impl IntoResponse {
    let start = Instant::now();
    let tenant_id = tenant_ctx.id.clone();
    let namespace = tenant_ctx.effective_namespace();
    let agent_label = tenant_ctx.agent_label.clone();

    // --- Debounce: skip if evaluated this namespace <5s ago ---
    let debounce_key = format!("{}:{}", tenant_id, namespace);
    {
        let mut map = DEBOUNCE.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(last) = map.get(&debounce_key) {
            if last.elapsed().as_secs() < DEBOUNCE_SECS {
                tracing::debug!(
                    tenant_id = %tenant_id,
                    namespace = %namespace,
                    "output_evaluation: debounced (last eval <{}s ago)",
                    DEBOUNCE_SECS
                );
                // Return cached-skip response
                return (
                    axum::http::StatusCode::OK,
                    Json(EvaluateResponse {
                        alignment: Alignment {
                            score: 1.0,
                            status: "aligned".to_string(),
                            issues: vec![],
                            corrections: vec![],
                        },
                        meta: EvalMeta {
                            memories_checked: 0,
                            evaluation_ms: 0,
                            model: "debounced".to_string(),
                        },
                    }),
                ).into_response();
            }
        }
        map.insert(debounce_key.clone(), Instant::now());
    }

    // --- Feature gate: check per-agent toggle (off by default) ---
    let output_eval_enabled = {
        // Check per-agent siu_config for silu_output_evaluation toggle
        let row = sqlx::query_scalar::<_, String>(
            "SELECT config::text FROM siu_config WHERE tenant_id = 'global' AND namespace = $1 LIMIT 1"
        )
        .bind(&namespace)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();

        if let Some(config_str) = row {
            if let Ok(config_val) = serde_json::from_str::<serde_json::Value>(&config_str) {
                let overrides = crate::entity_extraction::SiluOverrides::from_config(&config_val);
                overrides.output_evaluation.unwrap_or(false)
            } else {
                false
            }
        } else {
            // Fall back to global env var (default: false)
            std::env::var("SULCUS_OUTPUT_EVALUATION_ENABLED")
                .map(|v| v == "true")
                .unwrap_or(false)
        }
    };

    if !output_eval_enabled {
        tracing::debug!(
            tenant_id = %tenant_id,
            namespace = %namespace,
            "output_evaluation: disabled for this agent (toggle silu_output_evaluation in siu_config)"
        );
        return (
            axum::http::StatusCode::OK,
            Json(EvaluateResponse {
                alignment: Alignment {
                    score: 1.0,
                    status: "aligned".to_string(),
                    issues: vec![],
                    corrections: vec![],
                },
                meta: EvalMeta {
                    memories_checked: 0,
                    evaluation_ms: 0,
                    model: "disabled".to_string(),
                },
            }),
        ).into_response();
    }

    // --- Load extraction config ---
    let config = match state.extraction_config.as_ref() {
        Some(c) => c.clone(),
        None => {
            return (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({"error": "SILU not configured"})),
            ).into_response();
        }
    };

    // --- Search memories using output text as query (top 5) ---
    let memory_excerpts = search_memories(&state, &tenant_id, &namespace, &req.output).await;
    let memories_checked = memory_excerpts.len() as i32;

    // --- Build prompt ---
    let context = req.context.as_ref();
    let mut user_content = String::new();

    if let Some(ctx) = context {
        if let Some(ref ps) = ctx.prompt_summary {
            user_content.push_str(&format!("## Prompt Context\n{}\n\n", ps));
        }
    }

    user_content.push_str("## LLM Output\n");
    user_content.push_str(&req.output);
    user_content.push_str("\n\n## Retrieved Memory Excerpts\n");

    if memory_excerpts.is_empty() {
        user_content.push_str("(no memories retrieved)");
    } else {
        for (i, excerpt) in memory_excerpts.iter().enumerate() {
            user_content.push_str(&format!("{}. {}\n", i + 1, excerpt));
        }
    }

    // --- Call nano ---
    let request_body = ResponsesApiRequest {
        model: config.model.clone(),
        input: vec![
            ResponsesApiMessage {
                r#type: "message".to_string(),
                role: "system".to_string(),
                content: EVALUATION_PROMPT.to_string(),
            },
            ResponsesApiMessage {
                r#type: "message".to_string(),
                role: "user".to_string(),
                content: user_content,
            },
        ],
        text: ResponsesApiText {
            format: ResponsesApiFormat {
                r#type: "json_schema".to_string(),
                name: "output_evaluation".to_string(),
                schema: evaluation_schema(),
                strict: true,
            },
        },
    };

    let llm_result = HTTP_CLIENT
        .post(&config.endpoint)
        .header("api-key", &config.api_key)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await;

    let llm_response = match llm_result {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            tracing::warn!(
                tenant_id = %tenant_id,
                status = %status,
                body = %&body[..body.len().min(300)],
                "output_evaluation: LLM API error"
            );
            return (
                axum::http::StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "LLM evaluation failed"})),
            ).into_response();
        }
        Err(e) => {
            tracing::warn!(tenant_id = %tenant_id, error = %e, "output_evaluation: HTTP error");
            return (
                axum::http::StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "LLM request failed"})),
            ).into_response();
        }
    };

    let resp_json: serde_json::Value = match llm_response.json().await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "output_evaluation: failed to parse LLM response");
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "failed to parse LLM response"})),
            ).into_response();
        }
    };

    let text_content = resp_json
        .get("output")
        .and_then(|o| o.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("content"))
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("");

    let llm_alignment: LlmAlignment = match serde_json::from_str(text_content) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, raw = %text_content, "output_evaluation: failed to parse structured response");
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "failed to parse evaluation response"})),
            ).into_response();
        }
    };

    let elapsed_ms = start.elapsed().as_millis() as i32;

    // --- Store evaluation ---
    let prompt_summary = context.and_then(|c| c.prompt_summary.as_deref());
    let issues_json = serde_json::to_value(&llm_alignment.issues).unwrap_or_default();
    let corrections_json = serde_json::to_value(&llm_alignment.corrections).unwrap_or_default();

    let mut output_end = req.output.len().min(4096);
    while output_end > 0 && !req.output.is_char_boundary(output_end) { output_end -= 1; }
    let output_text = &req.output[..output_end];

    let store_result = sqlx::query(
        "INSERT INTO output_evaluations
         (tenant_id, namespace, agent_label, output_text, prompt_summary,
          alignment_score, alignment_status, issues, corrections,
          memories_checked, evaluation_ms, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)"
    )
    .bind(&tenant_id)
    .bind(&namespace)
    .bind(&agent_label)
    .bind(output_text)
    .bind(prompt_summary)
    .bind(llm_alignment.score)
    .bind(&llm_alignment.status)
    .bind(&issues_json)
    .bind(&corrections_json)
    .bind(memories_checked)
    .bind(elapsed_ms)
    .bind(&config.model)
    .execute(&state.pool)
    .await;

    if let Err(e) = store_result {
        tracing::warn!(error = %e, "output_evaluation: failed to store result (non-fatal)");
    }

    tracing::info!(
        tenant_id = %tenant_id,
        namespace = %namespace,
        score = llm_alignment.score,
        status = %llm_alignment.status,
        issues = llm_alignment.issues.len(),
        memories_checked,
        evaluation_ms = elapsed_ms,
        "SILU: output evaluation complete"
    );

    let response = EvaluateResponse {
        alignment: Alignment {
            score: llm_alignment.score,
            status: llm_alignment.status,
            issues: llm_alignment.issues.into_iter().map(|i| Issue {
                kind: i.kind,
                description: i.description,
                memory_excerpt: i.memory_excerpt,
            }).collect(),
            corrections: llm_alignment.corrections,
        },
        meta: EvalMeta {
            memories_checked,
            evaluation_ms: elapsed_ms,
            model: config.model.clone(),
        },
    };

    (axum::http::StatusCode::OK, Json(response)).into_response()
}

// ---------------------------------------------------------------------------
// Memory search helper (top 5 via vector search, fallback to FTS)
// ---------------------------------------------------------------------------

async fn search_memories(
    state: &SharedState,
    tenant_id: &str,
    namespace: &str,
    query: &str,
) -> Vec<String> {
    const LIMIT: i64 = 5;

    // Try semantic vector search first
    if let Some(qvec) = state.embed_query(query) {
        let query_vec = Vector::from(qvec);
        let result = sqlx::query_as::<_, (String,)>(
            "SELECT COALESCE(pointer_summary, '') FROM golden_index
             WHERE tenant_id = $1 AND namespace = $2
             AND embedding IS NOT NULL AND archived_at IS NULL
             ORDER BY embedding <=> $3::vector
             LIMIT $4"
        )
        .bind(tenant_id)
        .bind(namespace)
        .bind(&query_vec)
        .bind(LIMIT)
        .fetch_all(&state.pool)
        .await;

        if let Ok(rows) = result {
            if !rows.is_empty() {
                return rows.into_iter().map(|(s,)| s).filter(|s| !s.is_empty()).collect();
            }
        }
    }

    // Fallback: PostgreSQL full-text search
    let result = sqlx::query_as::<_, (String,)>(
        "SELECT COALESCE(pointer_summary, '') FROM golden_index
         WHERE tenant_id = $1 AND namespace = $2 AND archived_at IS NULL
         AND to_tsvector('english', COALESCE(pointer_summary, '')) @@ plainto_tsquery('english', $3)
         ORDER BY ts_rank(to_tsvector('english', COALESCE(pointer_summary, '')), plainto_tsquery('english', $3)) DESC
         LIMIT $4"
    )
    .bind(tenant_id)
    .bind(namespace)
    .bind(query)
    .bind(LIMIT)
    .fetch_all(&state.pool)
    .await;

    match result {
        Ok(rows) => rows.into_iter().map(|(s,)| s).filter(|s| !s.is_empty()).collect(),
        Err(e) => {
            tracing::warn!(error = %e, "output_evaluation: memory search failed");
            vec![]
        }
    }
}
