//! Entity/relationship extraction via GPT-5.4-nano (Azure Foundry).
//!
//! Called fire-and-forget on the memory ingest path (create_memory).
//! Extracts entity→relationship→entity triples from memory content
//! and stores them as:
//!   - Rows in `entities` table (deduped by tenant+namespace+name+type)
//!   - Edges in `golden_edges` with edge_type='extracted'
//!
//! ## Config
//! - `SULCUS_EXTRACTION_ENDPOINT` — Azure Foundry Responses API URL
//! - `SULCUS_EXTRACTION_API_KEY`  — API key for the endpoint
//! - `SULCUS_EXTRACTION_MODEL`    — model name (default: gpt-5.4-nano)
//! - `SULCUS_EXTRACTION_ENABLED`  — "true" to enable (default: "false")
//!
//! ## SCHEMA_REFERENCE.md rules
//! - Always use `$N::uuid` for UUID bindings
//! - Always use `pointer_summary` in raw SQL, never `label`
//! - Check `rows_affected() > 0` for UPDATE/DELETE success

use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// Lazy-initialized HTTP client for extraction calls.
static HTTP_CLIENT: std::sync::LazyLock<Client> = std::sync::LazyLock::new(|| {
    Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("failed to build reqwest client")
});

/// Configuration for the extraction pipeline, loaded from env vars once.
#[derive(Debug, Clone)]
pub struct ExtractionConfig {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub enabled: bool,
}

/// Caller-supplied extraction hints that guide SILU's entity extraction + classification.
/// These are injected as a preamble section into the SILU prompt so the LLM is context-aware.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ExtractionHints {
    /// Entity types the caller expects to be present (e.g. ["person", "tool", "project"]).
    /// SILU will weight these higher when uncertain.
    #[serde(default)]
    pub entity_types: Vec<String>,
    /// Free-form domain focus areas (e.g. ["infrastructure", "memory systems"]).
    #[serde(default)]
    pub focus_areas: Vec<String>,
    /// Entity types to suppress (e.g. ["location"] if irrelevant).
    #[serde(default)]
    pub suppress_types: Vec<String>,
    /// Optional hint about expected memory type (e.g. "procedural").
    /// Provided as a soft suggestion — SILU may override if content clearly differs.
    pub expected_type: Option<String>,
    /// Free-form examples or notes for this domain (injected verbatim, max 500 chars).
    pub context_note: Option<String>,
}

impl ExtractionHints {
    /// Returns true if no hints are actually set (all defaults).
    pub fn is_empty(&self) -> bool {
        self.entity_types.is_empty()
            && self.focus_areas.is_empty()
            && self.suppress_types.is_empty()
            && self.expected_type.is_none()
            && self.context_note.is_none()
    }

    /// Build the preamble section to prepend to the SILU prompt.
    pub fn build_prompt_preamble(&self) -> String {
        let mut parts: Vec<String> = Vec::new();

        if !self.entity_types.is_empty() {
            parts.push(format!("- Expected entity types: {}", self.entity_types.join(", ")));
        }
        if !self.focus_areas.is_empty() {
            parts.push(format!("- Domain focus: {}", self.focus_areas.join(", ")));
        }
        if !self.suppress_types.is_empty() {
            parts.push(format!("- Suppress entity types (do not extract): {}", self.suppress_types.join(", ")));
        }
        if let Some(ref et) = self.expected_type {
            parts.push(format!(
                "- Caller suggests memory type: {} (use this as a strong prior; override only if the content clearly contradicts it)",
                et
            ));
        }
        if let Some(ref note) = self.context_note {
            // Truncate to 500 chars to prevent prompt injection via unbounded user input
            let safe_note = if note.len() > 500 { &note[..500] } else { note.as_str() };
            parts.push(format!("- Context note: {}", safe_note));
        }

        if parts.is_empty() {
            return String::new();
        }

        format!(
            "## Caller-Supplied Context Hints\n\
             The following hints were provided by the system that stored this memory.\n\
             Use them to guide extraction and classification — they are trusted metadata:\n\
             {}\n",
            parts.join("\n")
        )
    }
}

/// Per-agent SILU overrides (BYOK). Loaded from siu_config at request time.
#[derive(Debug, Clone, Default)]
pub struct SiluOverrides {
    pub endpoint: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub enabled: Option<bool>,
    pub entity_extraction: Option<bool>,
    pub classification: Option<bool>,
    pub training_signals: Option<bool>,
    /// Per-agent toggle for SILU output evaluation (recursive LM supervisor).
    /// Default: off. Must be explicitly enabled per agent.
    pub output_evaluation: Option<bool>,
    /// Custom extraction instructions — injected into the SILU prompt to control
    /// which facts get extracted. Supports domain-specific extraction rules and
    /// few-shot examples. When set, appended after the standard extraction rules.
    pub custom_instructions: Option<String>,
    /// Custom extraction categories — when set, restricts memory classification
    /// to these types only (subset of the standard 5 types).
    pub custom_categories: Option<Vec<String>>,
}

impl SiluOverrides {
    /// Parse from the siu_config JSON blob.
    pub fn from_config(config: &serde_json::Value) -> Self {
        Self {
            endpoint: config.get("silu_api_endpoint").and_then(|v| v.as_str()).map(String::from),
            api_key: config.get("silu_api_key").and_then(|v| v.as_str()).map(String::from),
            model: config.get("silu_model").and_then(|v| v.as_str()).map(String::from),
            enabled: config.get("silu_enabled").and_then(|v| v.as_bool()),
            entity_extraction: config.get("silu_entity_extraction").and_then(|v| v.as_bool()),
            classification: config.get("silu_classification").and_then(|v| v.as_bool()),
            training_signals: config.get("silu_training_signals").and_then(|v| v.as_bool()),
            output_evaluation: config.get("silu_output_evaluation").and_then(|v| v.as_bool()),
            custom_instructions: config.get("silu_custom_instructions").and_then(|v| v.as_str()).map(String::from),
            custom_categories: config.get("silu_custom_categories")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
        }
    }

    /// Merge overrides into the base ExtractionConfig, producing an effective config.
    pub fn apply_to(&self, base: &ExtractionConfig) -> ExtractionConfig {
        ExtractionConfig {
            endpoint: self.endpoint.clone().unwrap_or_else(|| base.endpoint.clone()),
            api_key: self.api_key.clone().unwrap_or_else(|| base.api_key.clone()),
            model: self.model.clone().unwrap_or_else(|| base.model.clone()),
            enabled: self.enabled.unwrap_or(base.enabled),
        }
    }
}

impl ExtractionConfig {
    /// Load from environment variables. Returns None if not configured or disabled.
    pub fn from_env() -> Option<Self> {
        let enabled = std::env::var("SULCUS_EXTRACTION_ENABLED")
            .unwrap_or_else(|_| "false".to_string());
        if enabled != "true" {
            return None;
        }

        let endpoint = std::env::var("SULCUS_EXTRACTION_ENDPOINT").ok()?;
        let api_key = std::env::var("SULCUS_EXTRACTION_API_KEY").ok()?;
        let model = std::env::var("SULCUS_EXTRACTION_MODEL")
            .unwrap_or_else(|_| "gpt-5.4-nano".to_string());

        Some(Self {
            endpoint,
            api_key,
            model,
            enabled: true,
        })
    }
}

/// A single extracted triple: subject → predicate → object.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExtractedTriple {
    pub subject: String,
    pub subject_type: String,
    pub predicate: String,
    pub object: String,
    pub object_type: String,
    /// When this relationship became true (ISO-8601, optional).
    /// E.g., "2024-01-15" for "started working at Meta in January 2024".
    #[serde(default)]
    pub valid_from: Option<String>,
    /// When this relationship stopped being true (ISO-8601, optional).
    /// NULL means still current. E.g., "2024-06-30" for "left Google in June 2024".
    #[serde(default)]
    pub valid_until: Option<String>,
}

/// SILU classification result — the LLM's assessment of the memory.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SiluClassification {
    /// What type the LLM thinks this memory is (episodic/fact/preference/procedural/semantic)
    pub memory_type: String,
    /// Confidence 0.0-1.0 in the classification
    pub confidence: f32,
    /// Whether this memory is worth storing (quality gate)
    pub should_store: bool,
    /// Brief rationale for the classification
    pub rationale: String,
}

/// The structured output we ask the LLM to produce.
#[derive(Debug, Serialize, Deserialize)]
struct ExtractionResponse {
    triples: Vec<ExtractedTriple>,
    /// SILU classification — the LLM's opinion on type + quality
    classification: SiluClassification,
}

/// Azure Foundry Responses API request body.
#[derive(Debug, Serialize)]
struct ResponsesApiRequest {
    model: String,
    input: Vec<ResponsesApiMessage>,
    text: ResponsesApiText,
}

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

const EXTRACTION_PROMPT: &str = r#"You are the Sulcusian Intelligence Learning Unit (SILU). Given a piece of text (a memory stored by an AI agent), you perform two tasks.

## Task 1: Entity/Relationship Extraction
Extract all meaningful entity→relationship→entity triples.

Rules:
- Extract concrete entities (people, organizations, tools, concepts, locations, dates, projects)
- Each triple must have: subject, subject_type, predicate (verb/relationship), object, object_type
- Entity types: person, organization, tool, concept, location, project, event, model, metric, other
- Predicates should be short verb phrases: "uses", "created_by", "located_in", "part_of", "decided_on", etc.
- Normalize entity names: lowercase, trim whitespace, use canonical names (e.g. "dooley" not "Dooley")
- If the text is too short or contains no extractable relationships, return an empty triples array
- Do NOT invent relationships not supported by the text
- Maximum 10 triples per extraction

## Task 2: Memory Classification
Classify this memory into exactly one type. Classify ONLY based on the SHAPE and FUNCTION of the content, not its topic or whether it mentions events.

The five types with clear decision rules:

**procedural** — Instructions, steps, commands, workflows, deployment processes, build commands, configuration steps, "how to do X" knowledge. If the content tells you HOW to do something, it is procedural.
  Examples: "To deploy Sulcus: run az acr build, then update the container app", "Use git push origin master to push changes", "Steps to configure Keycloak: 1. Create realm 2. Add client"

**fact** — Stable knowledge, specifications, data points, version numbers, configurations, architectural decisions, costs, names/dates as reference data. If the content states WHAT something IS, it is a fact.
  Examples: "GPT-5.4 nano costs $0.20/1M input tokens", "Sulcus server runs on Azure Container Apps in canadacentral", "Python 3.12 requires typing_extensions >= 4.0"

**preference** — User preferences, opinions, style choices, settings, mandates about how things should be done. If the content expresses HOW someone WANTS things, it is a preference.
  Examples: "User prefers dark mode", "Always use BoxIcons solid variants, no emoji", "Dooley wants all deployments to go through consensus first"

**semantic** — Concepts, definitions, relationships between ideas, abstract knowledge, explanations of how systems work conceptually. If the content explains WHAT something MEANS or how concepts relate, it is semantic.
  Examples: "Thermodynamic decay models memory salience using half-life curves", "CRDT sync enables real-time cross-agent memory mesh", "Sulcus uses a dual-brain architecture: SIU for fast local inference, SILU for LLM-powered training"

**episodic** — Time-bound events, conversations, things that happened at a specific point in time that are primarily about WHEN something occurred rather than teaching reusable knowledge. This is the LEAST common type. Most memories that mention events are actually facts, procedures, or decisions.
  Examples: "Met with the team on Tuesday to discuss the roadmap", "Deployed v2.0 to production at 3pm — build took 8 minutes", "Dooley approved the GPT-5.4 nano choice on April 4, 2026"

CRITICAL: Do NOT default to episodic. Most agent memories are procedural (how-to), fact (specifications), or semantic (concepts). Episodic is rare — only use it when the primary value of the memory is recording that an event happened at a specific time, not teaching something reusable.

- confidence: 0.0 to 1.0, how confident you are
- should_store: true if this memory has genuine informational value; false if it's noise, test data, or meaningless
- rationale: one sentence explaining why you chose this type — reference the decision rule you applied
- Reject (should_store=false) content that is: pure greetings, empty test strings, system status pings, or content with no informational signal
- Accept even short content if it contains a concrete fact, preference, or instruction

## Entity Normalization Rules
- Normalize ALL entity names to lowercase: "Daedalus" → "daedalus", "OpenAI" → "openai"
- Use canonical/full names where possible: "k8s" → "kubernetes", "pg" → "postgresql"
- Remove articles and possessives: "the forge" → "forge", "Dooley's" → "dooley"
- Dates should use ISO format: "April 5, 2026" → "2026-04-05"
- Deduplicate: do not emit two triples that express the same relationship in different words
- Temporal bounds: if the text indicates WHEN a relationship started or ended, include valid_from/valid_until (ISO-8601 date or datetime). Examples: 'worked at Google from 2020 to 2024' → valid_from='2020-01-01', valid_until='2024-01-01'. If no temporal info is present, omit these fields (null)."#;

/// JSON Schema for structured output.
fn extraction_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "triples": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "subject": { "type": "string" },
                        "subject_type": { "type": "string", "enum": ["person", "organization", "tool", "concept", "location", "project", "event", "model", "metric", "other"] },
                        "predicate": { "type": "string" },
                        "object": { "type": "string" },
                        "object_type": { "type": "string", "enum": ["person", "organization", "tool", "concept", "location", "project", "event", "model", "metric", "other"] },
                        "valid_from": { "type": ["string", "null"], "description": "ISO-8601 date/datetime when this relationship became true (null if unknown)" },
                        "valid_until": { "type": ["string", "null"], "description": "ISO-8601 date/datetime when this relationship stopped being true (null if still current)" }
                    },
                    "required": ["subject", "subject_type", "predicate", "object", "object_type"],
                    "additionalProperties": false
                }
            },
            "classification": {
                "type": "object",
                "properties": {
                    "memory_type": { "type": "string", "enum": ["episodic", "fact", "preference", "procedural", "semantic"] },
                    "confidence": { "type": "number" },
                    "should_store": { "type": "boolean" },
                    "rationale": { "type": "string" }
                },
                "required": ["memory_type", "confidence", "should_store", "rationale"],
                "additionalProperties": false
            }
        },
        "required": ["triples", "classification"],
        "additionalProperties": false
    })
}

/// Result of the SILU pipeline — triples + classification.
#[derive(Debug)]
pub struct SiluResult {
    pub triples: Vec<ExtractedTriple>,
    pub classification: SiluClassification,
}

/// Call GPT-5.4-nano to extract entity/relationship triples AND classify the memory.
/// `hints` are injected as a preamble into the system prompt when present.
pub async fn extract_and_classify(
    config: &ExtractionConfig,
    content: &str,
    hints: Option<&ExtractionHints>,
) -> anyhow::Result<SiluResult> {
    if content.len() < 20 {
        return Ok(SiluResult {
            triples: vec![],
            classification: SiluClassification {
                memory_type: "episodic".to_string(),
                confidence: 0.0,
                should_store: false,
                rationale: "Content too short for meaningful classification".to_string(),
            },
        });
    }

    let request_body = ResponsesApiRequest {
        model: config.model.clone(),
        input: vec![
            ResponsesApiMessage {
                r#type: "message".to_string(),
                role: "system".to_string(),
                content: {
                    let mut prompt = EXTRACTION_PROMPT.to_string();
                    // Inject caller-supplied extraction hints into the SILU prompt
                    if let Some(ref h) = hints {
                        let hints_block = h.to_prompt_block();
                        if !hints_block.is_empty() {
                            prompt.push_str("\n\n");
                            prompt.push_str(&hints_block);
                        }
                    }
                    prompt
                },
            },
            ResponsesApiMessage {
                r#type: "message".to_string(),
                role: "user".to_string(),
                content: content.to_string(),
            },
        ],
        text: ResponsesApiText {
            format: ResponsesApiFormat {
                r#type: "json_schema".to_string(),
                name: "entity_extraction".to_string(),
                schema: extraction_schema(),
                strict: true,
            },
        },
    };

    let response = HTTP_CLIENT
        .post(&config.endpoint)
        .header("api-key", &config.api_key)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let mut err_end = body.len().min(500);
        while err_end > 0 && !body.is_char_boundary(err_end) { err_end -= 1; }
        anyhow::bail!("Extraction API returned {}: {}", status, &body[..err_end]);
    }

    // Parse the Responses API output — the text content is in output[0].content[0].text
    let resp_json: serde_json::Value = response.json().await?;

    let text_content = resp_json
        .get("output")
        .and_then(|o| o.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("content"))
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| anyhow::anyhow!("Unexpected Responses API output structure"))?;

    let extraction: ExtractionResponse = serde_json::from_str(text_content)?;

    Ok(SiluResult {
        triples: extraction.triples,
        classification: extraction.classification,
    })
}

/// Store extracted triples as entities + edges in the database.
///
/// For each triple (subject → predicate → object):
///   1. Upsert subject into `entities` (dedup by tenant+namespace+name+type)
///   2. Upsert object into `entities`
///   3. Insert edge into `golden_edges` linking subject entity → object entity
pub async fn store_triples(
    pool: &PgPool,
    tenant_id: &str,
    namespace: &str,
    source_memory_id: &uuid::Uuid,
    triples: &[ExtractedTriple],
) -> anyhow::Result<(usize, usize)> {
    let mut entities_upserted = 0usize;
    let mut edges_inserted = 0usize;

    for triple in triples {
        // Normalize names
        let subject_name = triple.subject.trim().to_lowercase();
        let object_name = triple.object.trim().to_lowercase();

        if subject_name.is_empty() || object_name.is_empty() {
            continue;
        }

        // Upsert subject entity
        let subject_row = sqlx::query_as::<_, (uuid::Uuid,)>(
            "INSERT INTO entities (tenant_id, namespace, name, entity_type)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, namespace, name, entity_type)
             DO UPDATE SET mention_count = entities.mention_count + 1, last_seen = now()
             RETURNING id"
        )
        .bind(tenant_id)
        .bind(namespace)
        .bind(&subject_name)
        .bind(&triple.subject_type)
        .fetch_one(pool)
        .await?;
        entities_upserted += 1;

        // Upsert object entity
        let object_row = sqlx::query_as::<_, (uuid::Uuid,)>(
            "INSERT INTO entities (tenant_id, namespace, name, entity_type)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, namespace, name, entity_type)
             DO UPDATE SET mention_count = entities.mention_count + 1, last_seen = now()
             RETURNING id"
        )
        .bind(tenant_id)
        .bind(namespace)
        .bind(&object_name)
        .bind(&triple.object_type)
        .fetch_one(pool)
        .await?;
        entities_upserted += 1;

        // Parse temporal bounds (best-effort — invalid dates are silently ignored)
        let valid_from: Option<chrono::DateTime<chrono::Utc>> = triple.valid_from.as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .or_else(|| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
                    .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc())));
        let valid_until: Option<chrono::DateTime<chrono::Utc>> = triple.valid_until.as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .or_else(|| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
                    .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc())));

        // Insert edge linking subject → object (with temporal bounds)
        let edge_result = sqlx::query(
            "INSERT INTO golden_edges (tenant_id, source_id, target_id, edge_type, weight, relationship_label, source_memory_id, extracted_at, valid_from, valid_until)
             VALUES ($1, $2::uuid, $3::uuid, 'extracted', 1.0, $4, $5::uuid, now(), $6, $7)
             ON CONFLICT (tenant_id, source_id, target_id) DO UPDATE SET
               weight = golden_edges.weight + 0.1,
               relationship_label = EXCLUDED.relationship_label,
               source_memory_id = EXCLUDED.source_memory_id,
               extracted_at = now(),
               valid_from = COALESCE(EXCLUDED.valid_from, golden_edges.valid_from),
               valid_until = COALESCE(EXCLUDED.valid_until, golden_edges.valid_until),
               updated_at = now()"
        )
        .bind(tenant_id)
        .bind(subject_row.0)
        .bind(object_row.0)
        .bind(&triple.predicate)
        .bind(source_memory_id)
        .bind(valid_from)
        .bind(valid_until)
        .execute(pool)
        .await?;

        if edge_result.rows_affected() > 0 {
            edges_inserted += 1;
        }

        // ── AGE graph: sync entity vertices + edge (self-healing) ──
        // Entity vertices
        crate::graph::ensure_entity_vertex(
            pool, tenant_id, &subject_row.0, namespace,
            &subject_name, &triple.subject_type, 1,
        ).await;
        crate::graph::ensure_entity_vertex(
            pool, tenant_id, &object_row.0, namespace,
            &object_name, &triple.object_type, 1,
        ).await;
        // Entity→Entity edge
        crate::graph::ensure_graph_edge(
            pool, &subject_row.0, &object_row.0,
            crate::graph::GraphEdgeType::RelatesTo,
            1.0, Some(&triple.predicate), Some(source_memory_id),
        ).await;
        // Memory→Entity edges (MENTIONS)
        crate::graph::ensure_graph_edge(
            pool, source_memory_id, &subject_row.0,
            crate::graph::GraphEdgeType::Mentions,
            1.0, Some(&triple.predicate), None,
        ).await;
        crate::graph::ensure_graph_edge(
            pool, source_memory_id, &object_row.0,
            crate::graph::GraphEdgeType::Mentions,
            1.0, Some(&triple.predicate), None,
        ).await;
    }

    Ok((entities_upserted, edges_inserted))
}

/// Minimum confidence margin SILU must exceed SIU by to record a reclassify signal.
/// If SILU's confidence doesn't beat SIU's by at least this margin, the disagreement
/// is logged but not recorded as a training signal (prevents poisoning).
const SILU_RECLASSIFY_CONFIDENCE_MARGIN: f32 = 0.15;

/// Record a SILU training signal into the training_signals table.
/// This feeds the SIU model retraining pipeline.
///
/// Confidence gate: SILU reclassifications are only recorded when SILU's confidence
/// exceeds SIU's confidence by `SILU_RECLASSIFY_CONFIDENCE_MARGIN`. This prevents
/// low-confidence SILU opinions from poisoning the ONNX training data.
async fn record_silu_signal(
    pool: &PgPool,
    tenant_id: &str,
    namespace: &str,
    memory_id: &uuid::Uuid,
    siu_predicted_type: Option<&str>,
    siu_predicted_store: Option<bool>,
    siu_predicted_conf: Option<f32>,
    silu_classification: &SiluClassification,
    content: &str,
) {
    // Determine signal type based on SIU vs SILU agreement + confidence gate
    let signal_type = match siu_predicted_type {
        Some(siu_type) if siu_type == silu_classification.memory_type => "accept",
        Some(_siu_type) => {
            // SILU disagrees with SIU — apply confidence gate
            let siu_conf = siu_predicted_conf.unwrap_or(0.0);
            let silu_conf = silu_classification.confidence;
            let margin = silu_conf - siu_conf;

            if margin >= SILU_RECLASSIFY_CONFIDENCE_MARGIN {
                // SILU is significantly more confident — record as reclassify
                tracing::info!(
                    memory_id = %memory_id,
                    siu_type = _siu_type,
                    siu_conf,
                    silu_type = %silu_classification.memory_type,
                    silu_conf,
                    margin,
                    "SILU: reclassify accepted (confidence margin met)"
                );
                "reclassify"
            } else {
                // SILU disagrees but isn't confident enough — log but don't train
                tracing::info!(
                    memory_id = %memory_id,
                    siu_type = _siu_type,
                    siu_conf,
                    silu_type = %silu_classification.memory_type,
                    silu_conf,
                    margin,
                    required_margin = SILU_RECLASSIFY_CONFIDENCE_MARGIN,
                    "SILU: reclassify REJECTED (confidence margin {:.3} < {:.3} threshold)",
                    margin, SILU_RECLASSIFY_CONFIDENCE_MARGIN,
                );
                // Still record it as a "disagree" for auditing, but NOT as a reclassify
                // that feeds training. This way we can review disagreements without poisoning data.
                "disagree"
            }
        }
        None => "accept", // No SIU prediction to compare against
    };

    let result = sqlx::query(
        "INSERT INTO training_signals
         (memory_id, tenant_id, namespace, signal_type,
          predicted_type, predicted_store, predicted_conf,
          corrected_type, corrected_store,
          content_snapshot, source)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'silu')"
    )
    .bind(memory_id)
    .bind(tenant_id)
    .bind(namespace)
    .bind(signal_type)
    .bind(siu_predicted_type)
    .bind(siu_predicted_store)
    .bind(siu_predicted_conf)
    .bind(&silu_classification.memory_type)
    .bind(silu_classification.should_store)
    .bind({
            let mut snap_end = content.len().min(2000);
            while snap_end > 0 && !content.is_char_boundary(snap_end) { snap_end -= 1; }
            &content[..snap_end]
        }) // Truncate snapshot to 2KB (char-boundary safe)
    .execute(pool)
    .await;

    match result {
        Ok(_) => {
            tracing::info!(
                memory_id = %memory_id,
                signal_type = signal_type,
                silu_type = %silu_classification.memory_type,
                silu_conf = silu_classification.confidence,
                silu_store = silu_classification.should_store,
                "SILU training signal recorded"
            );
        }
        Err(e) => {
            tracing::warn!(
                memory_id = %memory_id,
                error = %e,
                "SILU: failed to record training signal"
            );
        }
    }
}

/// Full SILU pipeline: extract triples + classify, store both, record training signal.
/// Called fire-and-forget from the ingest path.
///
/// `overrides` allows per-agent BYOK: custom endpoint, API key, model, and feature toggles.
/// `hints` are caller-supplied context hints injected into the SILU prompt (Phase 2).
pub async fn extract_and_store(
    pool: &PgPool,
    config: &ExtractionConfig,
    tenant_id: &str,
    namespace: &str,
    memory_id: &uuid::Uuid,
    content: &str,
    // SIU's prediction (if available) — used to compare against SILU for training signals
    siu_predicted_type: Option<&str>,
    siu_predicted_store: Option<bool>,
    siu_predicted_conf: Option<f32>,
    overrides: Option<SiluOverrides>,
    hints: Option<ExtractionHints>,
) {
    // Apply per-agent overrides (BYOK)
    let effective = match &overrides {
        Some(o) => o.apply_to(config),
        None => config.clone(),
    };

    // Check per-agent enabled flag
    if !effective.enabled {
        tracing::debug!(memory_id = %memory_id, namespace, "SILU: disabled for this agent");
        return;
    }

    let skip_extraction = overrides.as_ref().and_then(|o| o.entity_extraction).map(|v| !v).unwrap_or(false);
    let skip_classification = overrides.as_ref().and_then(|o| o.classification).map(|v| !v).unwrap_or(false);
    let skip_signals = overrides.as_ref().and_then(|o| o.training_signals).map(|v| !v).unwrap_or(false);

    match extract_and_classify(&effective, content, hints.as_ref()).await {
        Ok(result) => {
            // Log the SILU classification
            tracing::info!(
                memory_id = %memory_id,
                silu_type = %result.classification.memory_type,
                silu_conf = result.classification.confidence,
                silu_store = result.classification.should_store,
                triple_count = result.triples.len(),
                rationale = %result.classification.rationale,
                "SILU: classification + extraction complete"
            );

            // Store triples (entities + edges)
            if !result.triples.is_empty() && !skip_extraction {
                match store_triples(pool, tenant_id, namespace, memory_id, &result.triples).await {
                    Ok((entities, edges)) => {
                        tracing::info!(
                            memory_id = %memory_id,
                            entities = entities,
                            edges = edges,
                            "SILU: stored entity triples"
                        );
                    }
                    Err(e) => {
                        tracing::warn!(
                            memory_id = %memory_id,
                            error = %e,
                            "SILU: failed to store triples"
                        );
                    }
                }
            }

            // Record training signal for SIU feedback loop
            if skip_signals {
                tracing::debug!(memory_id = %memory_id, "SILU: training signals disabled for this agent");
            } else {
                record_silu_signal(
                    pool,
                    tenant_id,
                    namespace,
                    memory_id,
                    siu_predicted_type,
                    siu_predicted_store,
                    siu_predicted_conf,
                    &result.classification,
                    content,
                )
                .await;
            }
        }
        Err(e) => {
            tracing::warn!(
                memory_id = %memory_id,
                error = %e,
                "SILU: LLM call failed"
            );
        }
    }
}
