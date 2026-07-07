//! Local PostgreSQL storage backend for Sulcus.
//!
//! Implements `StorageBackend` using PostgreSQL (via SQLx) with FTS-like ILIKE search.
//! Heat decay is computed on-read using exponential decay from `updated_at`.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use uuid::Uuid;
use sqlx::{PgPool, Row, FromRow};

use sulcus_core::*;
use sulcus_core::backend::StorageBackend;

use crate::embedder::{self, Embedder};
use crate::schema;

/// Half-life constants for heat decay (in seconds), matching cloud thermodynamics.
const HALF_LIFE_SECS: &[(&str, f64)] = &[
    ("episodic",   86400.0 * 7.0),   // 7 days
    ("semantic",   86400.0 * 30.0),   // 30 days
    ("preference", 86400.0 * 90.0),   // 90 days
    ("procedural", 86400.0 * 180.0),  // 180 days
    ("synthesis",  86400.0 * 60.0),   // 60 days
    ("fact",       86400.0 * 30.0),   // 30 days
];

fn half_life_for(memory_type: &str) -> f64 {
    HALF_LIFE_SECS
        .iter()
        .find(|(t, _)| *t == memory_type)
        .map(|(_, hl)| *hl)
        .unwrap_or(86400.0 * 30.0) // default 30 days
}

/// Compute decayed heat from stored heat, elapsed seconds, and memory type.
fn decayed_heat(stored_heat: f64, elapsed_secs: f64, memory_type: &str, is_pinned: bool) -> f64 {
    if is_pinned {
        return stored_heat;
    }
    let hl = half_life_for(memory_type);
    let decay = (-elapsed_secs * (2.0_f64.ln()) / hl).exp();
    (stored_heat * decay).max(0.0)
}

/// Elapsed seconds since an ISO 8601 timestamp.
fn elapsed_since(iso: &str) -> f64 {
    chrono::DateTime::parse_from_rfc3339(iso)
        .or_else(|_| {
            // Handle timestamps without timezone (assume UTC)
            chrono::NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%SZ")
                .map(|ndt| ndt.and_utc().fixed_offset())
        })
        .map(|dt| {
            let now = chrono::Utc::now();
            (now - dt.with_timezone(&chrono::Utc))
                .num_seconds()
                .max(0) as f64
        })
        .unwrap_or(0.0)
}

#[derive(Clone, FromRow)]
struct MemoryRow {
    id: String,
    content: String,
    pointer_summary: Option<String>,
    memory_type: String,
    namespace: String,
    current_heat: f64,
    base_utility: f64,
    is_pinned: i32,
    source: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, FromRow)]
struct EdgeRow {
    id: String,
    source_id: String,
    target_id: String,
    relation: String,
    weight: f64,
    created_at: String,
}

#[derive(Clone, FromRow)]
struct TriggerRow {
    id: String,
    name: Option<String>,
    event: String,
    action: String,
    filter_memory_type: Option<String>,
    filter_namespace: Option<String>,
    filter_label_pattern: Option<String>,
    created_at: String,
}

/// Local embedded/external Sulcus storage backed by PostgreSQL.
pub struct LocalStore {
    pool: PgPool,
    namespace: String,
    embedder: Option<Box<dyn Embedder>>,
}

impl LocalStore {
    /// Open a connection to the PostgreSQL database.
    pub async fn open(database_url: &str, namespace: impl Into<String>) -> Result<Self> {
        let pool = PgPool::connect(database_url)
            .await
            .with_context(|| format!("Failed to connect to PostgreSQL at {}", database_url))?;

        schema::init(&pool).await?;

        Ok(Self {
            pool,
            namespace: namespace.into(),
            embedder: None,
        })
    }

    /// Open connection using default URL or environment override.
    pub async fn open_default(namespace: impl Into<String>) -> Result<Self> {
        let database_url = std::env::var("SULCUS_DATABASE_URL")
            .or_else(|_| std::env::var("DATABASE_URL"))
            .unwrap_or_else(|_| "postgres://sulcus@127.0.0.1:15432/sulcus".to_string());

        Self::open(&database_url, namespace).await
    }

    /// Open connection to a specific db path (for backwards compatibility with resolving config).
    /// Map path to a local postgres DSN if path is default or sqlite path.
    pub async fn open_compat(_path: &str, namespace: impl Into<String>) -> Result<Self> {
        // If SULCUS_DATABASE_URL is set, always use it
        if let Ok(url) = std::env::var("SULCUS_DATABASE_URL") {
            return Self::open(&url, namespace).await;
        }
        if let Ok(url) = std::env::var("DATABASE_URL") {
            return Self::open(&url, namespace).await;
        }
        // Build default local Postgres DSN
        let dsn = "postgres://sulcus@127.0.0.1:15432/sulcus".to_string();
        Self::open(&dsn, namespace).await
    }

    /// Attach an embedder for vector search.
    pub fn with_embedder(mut self, embedder: Box<dyn Embedder>) -> Self {
        self.embedder = Some(embedder);
        self
    }

    /// Check if an embedder is attached.
    pub fn has_embedder(&self) -> bool {
        self.embedder.is_some()
    }

    /// Backfill embeddings for memories that don't have one yet.
    pub async fn embed_existing(&self, batch_size: usize) -> Result<usize> {
        let embedder = self.embedder.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No embedder attached — cannot backfill embeddings"))?;

        let rows = sqlx::query_as::<_, MemoryRow>(
            "SELECT m.* FROM memories m
             LEFT JOIN embeddings e ON e.memory_id = m.id
             WHERE e.memory_id IS NULL AND m.namespace = $1
             LIMIT $2"
        )
        .bind(&self.namespace)
        .bind(batch_size as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut count = 0;
        for row in rows {
            if let Ok(vec) = embedder.embed(&row.content) {
                let blob = embedder::vector_to_blob(&vec);
                sqlx::query(
                    "INSERT INTO embeddings (memory_id, vector, model, dimensions)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (memory_id) DO UPDATE SET
                        vector = EXCLUDED.vector,
                        model = EXCLUDED.model,
                        dimensions = EXCLUDED.dimensions"
                )
                .bind(&row.id)
                .bind(&blob)
                .bind(embedder.model_name())
                .bind(embedder.dimensions() as i32)
                .execute(&self.pool)
                .await?;
                count += 1;
            }
        }

        Ok(count)
    }

    fn row_to_json(row: &MemoryRow, memory_type: &str, is_pinned: bool) -> Value {
        let elapsed = elapsed_since(&row.updated_at);
        let heat = decayed_heat(row.current_heat, elapsed, memory_type, is_pinned);

        json!({
            "id": row.id,
            "label": row.content,
            "pointer_summary": row.pointer_summary.clone().unwrap_or_else(|| {
                row.content.chars().take(120).collect()
            }),
            "memory_type": memory_type,
            "namespace": row.namespace,
            "current_heat": heat,
            "heat": row.current_heat,
            "base_utility": row.base_utility,
            "is_pinned": is_pinned,
            "source": row.source,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        })
    }
}

#[async_trait::async_trait]
impl StorageBackend for LocalStore {
    async fn remember(&self, params: &RememberParams) -> Result<Value> {
        let id = Uuid::new_v4().to_string();
        let mtype = params.memory_type.clone();
        let heat = params.heat.unwrap_or(50.0);
        let ns = params.namespace.clone().unwrap_or_else(|| self.namespace.clone());

        let summary = params.content.chars().take(120).collect::<String>();
        let is_pinned = 0;

        sqlx::query(
            "INSERT INTO memories (id, content, pointer_summary, memory_type, namespace, current_heat, base_utility, is_pinned, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET
                content = EXCLUDED.content,
                pointer_summary = EXCLUDED.pointer_summary,
                memory_type = EXCLUDED.memory_type,
                current_heat = EXCLUDED.current_heat,
                base_utility = EXCLUDED.base_utility,
                is_pinned = EXCLUDED.is_pinned,
                source = EXCLUDED.source,
                updated_at = TO_CHAR(timezone('utc', now()), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"
        )
        .bind(&id)
        .bind(&params.content)
        .bind(&summary)
        .bind(&mtype)
        .bind(&ns)
        .bind(heat)
        .bind(50.0)
        .bind(is_pinned)
        .bind(None::<String>)
        .execute(&self.pool)
        .await?;

        // Background embedding if embedder is set
        if let Some(ref embedder) = self.embedder {
            if let Ok(vec) = embedder.embed(&params.content) {
                let blob = embedder::vector_to_blob(&vec);
                let _ = sqlx::query(
                    "INSERT INTO embeddings (memory_id, vector, model, dimensions)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (memory_id) DO UPDATE SET
                        vector = EXCLUDED.vector,
                        model = EXCLUDED.model,
                        dimensions = EXCLUDED.dimensions"
                )
                .bind(&id)
                .bind(&blob)
                .bind(embedder.model_name())
                .bind(embedder.dimensions() as i32)
                .execute(&self.pool)
                .await;
            }
        }

        let row = sqlx::query_as::<_, MemoryRow>(
            "SELECT * FROM memories WHERE id = $1"
        )
        .bind(&id)
        .fetch_one(&self.pool)
        .await?;

        Ok(Self::row_to_json(&row, &mtype, false))
    }

    async fn search(&self, params: &SearchParams) -> Result<Value> {
        let limit = params.limit.max(1).min(50);
        let ilike_query = format!("%{}%", params.query.replace('%', "\\%").replace('_', "\\_"));

        let mut query_str = String::from(
            "SELECT * FROM memories
             WHERE namespace = $1 AND (content ILIKE $2 OR COALESCE(pointer_summary, '') ILIKE $2)"
        );
        if let Some(ref mt) = params.memory_type {
            query_str.push_str(&format!(" AND memory_type = '{}'", mt.replace('\'', "''")));
        }
        query_str.push_str(" ORDER BY current_heat DESC LIMIT $3");

        let rows = sqlx::query_as::<_, MemoryRow>(&query_str)
            .bind(&self.namespace)
            .bind(&ilike_query)
            .bind(limit as i64)
            .fetch_all(&self.pool)
            .await?;

        let mut results: Vec<Value> = rows.iter().map(|row| {
            let is_pinned = row.is_pinned == 1;
            Self::row_to_json(row, &row.memory_type, is_pinned)
        }).collect();

        // Optional vector reranking if query embedding exists
        if let Some(ref embedder) = self.embedder {
            if let Ok(query_vec) = embedder.embed(&params.query) {
                // Fetch all vectors in this namespace
                let vec_rows = sqlx::query(
                    "SELECT e.memory_id, e.vector, m.memory_type, m.is_pinned
                     FROM embeddings e
                     JOIN memories m ON m.id = e.memory_id
                     WHERE m.namespace = $1"
                )
                .bind(&self.namespace)
                .fetch_all(&self.pool)
                .await?;

                let mut scores = Vec::new();
                for r in vec_rows {
                    let mem_id: String = r.get("memory_id");
                    let blob: Vec<u8> = r.get("vector");
                    let db_vec = embedder::blob_to_vector(&blob);
                    let sim = embedder::cosine_similarity(&query_vec, &db_vec);

                    // Boost score if pinned
                    let is_pinned: i32 = r.get("is_pinned");
                    let score = if is_pinned == 1 { sim + 0.15 } else { sim };
                    scores.push((mem_id, score));
                }

                scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                
                // Map back to node JSON with hybrid scoring
                let mut reranked = Vec::new();
                for (id, score) in scores.iter().take(limit as usize) {
                    if let Some(node) = results.iter().find(|n| n["id"].as_str() == Some(id)) {
                        let mut copy = node.clone();
                        copy["score"] = json!(score);
                        reranked.push(copy);
                    } else {
                        // Retrieve node by ID if not in FTS pool
                        if let Ok(row) = sqlx::query_as::<_, MemoryRow>(
                            "SELECT * FROM memories WHERE id = $1"
                        )
                        .bind(id)
                        .fetch_one(&self.pool)
                        .await {
                            let is_pinned = row.is_pinned == 1;
                            let mut node = Self::row_to_json(&row, &row.memory_type, is_pinned);
                            node["score"] = json!(score);
                            reranked.push(node);
                        }
                    }
                }
                results = reranked;
            }
        }

        Ok(json!({ "results": results }))
    }

    async fn list(&self, params: &ListParams) -> Result<Value> {
        let page = params.page.max(1);
        let page_size = params.page_size.max(1).min(100);
        let offset = ((page - 1) * page_size) as i64;

        let mut conditions = vec![format!("namespace = '{}'", self.namespace.replace('\'', "''"))];
        if let Some(ref mt) = params.memory_type {
            conditions.push(format!("memory_type = '{}'", mt.replace('\'', "''")));
        }
        if let Some(pinned) = params.pinned {
            conditions.push(format!("is_pinned = {}", if pinned { 1 } else { 0 }));
        }

        let where_clause = conditions.join(" AND ");

        // Count total
        let count_sql = format!("SELECT COUNT(*) FROM memories WHERE {where_clause}");
        let total: i64 = sqlx::query_scalar(&count_sql)
            .fetch_one(&self.pool)
            .await?;

        // Fetch page
        let select_sql = format!(
            "SELECT * FROM memories WHERE {where_clause} ORDER BY current_heat DESC LIMIT $1 OFFSET $2"
        );
        let rows = sqlx::query_as::<_, MemoryRow>(&select_sql)
            .bind(page_size as i64)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

        let items: Vec<Value> = rows.iter().map(|row| {
            let is_pinned = row.is_pinned == 1;
            Self::row_to_json(row, &row.memory_type, is_pinned)
        }).collect();

        Ok(json!({
            "nodes": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }))
    }

    async fn get_memory(&self, memory_id: &str) -> Result<Memory> {
        let row = sqlx::query_as::<_, MemoryRow>(
            "SELECT * FROM memories WHERE id = $1"
        )
        .bind(memory_id)
        .fetch_one(&self.pool)
        .await
        .with_context(|| format!("Memory not found: {memory_id}"))?;

        let elapsed = elapsed_since(&row.updated_at);
        let is_pinned = row.is_pinned == 1;
        let heat = decayed_heat(row.current_heat, elapsed, &row.memory_type, is_pinned);

        Ok(Memory {
            id: row.id,
            pointer_summary: Some(row.content.clone()),
            memory_type: Some(row.memory_type),
            current_heat: Some(heat),
            heat: Some(row.current_heat),
            base_utility: Some(row.base_utility),
            is_pinned: Some(is_pinned),
            namespace: Some(row.namespace),
        })
    }

    async fn forget(&self, memory_id: &str) -> Result<Value> {
        let result = sqlx::query("DELETE FROM memories WHERE id = $1")
            .bind(memory_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            anyhow::bail!("Memory not found: {memory_id}");
        }

        Ok(json!({ "deleted": memory_id }))
    }

    async fn update(&self, params: &UpdateParams) -> Result<Value> {
        let row = sqlx::query_as::<_, MemoryRow>(
            "SELECT * FROM memories WHERE id = $1"
        )
        .bind(&params.memory_id)
        .fetch_one(&self.pool)
        .await
        .with_context(|| format!("Memory not found: {}", params.memory_id))?;

        let label = params.label.clone().unwrap_or(row.content);
        let summary = label.chars().take(120).collect::<String>();
        let memory_type = params.memory_type.clone().unwrap_or(row.memory_type);
        let is_pinned = params.is_pinned.map(|p| if p { 1 } else { 0 }).unwrap_or(row.is_pinned);
        let heat = params.heat.unwrap_or(row.current_heat);

        sqlx::query(
            "UPDATE memories SET
                content = $2,
                pointer_summary = $3,
                memory_type = $4,
                is_pinned = $5,
                current_heat = $6,
                updated_at = TO_CHAR(timezone('utc', now()), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
             WHERE id = $1"
        )
        .bind(&params.memory_id)
        .bind(&label)
        .bind(&summary)
        .bind(&memory_type)
        .bind(is_pinned)
        .bind(heat)
        .execute(&self.pool)
        .await?;

        let row = sqlx::query_as::<_, MemoryRow>(
            "SELECT * FROM memories WHERE id = $1"
        )
        .bind(&params.memory_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(Self::row_to_json(&row, &memory_type, is_pinned == 1))
    }

    async fn boost(&self, memory_id: &str, amount: f64) -> Result<Value> {
        let result = sqlx::query(
            "UPDATE memories SET
                current_heat = LEAST(100.0, current_heat + $2),
                updated_at = TO_CHAR(timezone('utc', now()), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
             WHERE id = $1"
        )
        .bind(memory_id)
        .bind(amount)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            anyhow::bail!("Memory not found: {memory_id}");
        }

        Ok(json!({ "boosted": memory_id }))
    }

    async fn deprecate(&self, memory_id: &str, amount: f64) -> Result<Value> {
        let result = sqlx::query(
            "UPDATE memories SET
                current_heat = GREATEST(0.0, current_heat - $2),
                updated_at = TO_CHAR(timezone('utc', now()), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
             WHERE id = $1"
        )
        .bind(memory_id)
        .bind(amount)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            anyhow::bail!("Memory not found: {memory_id}");
        }

        Ok(json!({ "deprecated": memory_id }))
    }

    async fn hot_nodes(&self, limit: u32) -> Result<Value> {
        let rows = sqlx::query_as::<_, MemoryRow>(
            "SELECT * FROM memories WHERE namespace = $1 ORDER BY current_heat DESC LIMIT $2"
        )
        .bind(&self.namespace)
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?;

        let items: Vec<Value> = rows.iter().map(|row| {
            let is_pinned = row.is_pinned == 1;
            Self::row_to_json(row, &row.memory_type, is_pinned)
        }).collect();

        Ok(json!({ "hot_nodes": items }))
    }

    async fn build_context(&self, query: &str, token_budget: u32) -> Result<Value> {
        // Fetch candidates via search
        let search_res = self.search(&SearchParams {
            query: query.to_string(),
            limit: 20,
            memory_type: None,
        }).await?;

        let results = search_res["results"].as_array().cloned().unwrap_or_default();
        let mut context = String::new();
        let char_limit = token_budget * 4; // Approx 4 chars per token

        for node in results {
            let summary = node["pointer_summary"].as_str().unwrap_or_default();
            let score = node["score"].as_f64().unwrap_or(1.0);
            let item = format!("- [Relevance: {:.2}] {}\n", score, summary);

            if context.len() + item.len() > char_limit as usize {
                break;
            }
            context.push_str(&item);
        }

        Ok(json!({
            "context": context,
            "tokens_used": context.len() / 4,
            "budget": token_budget,
        }))
    }

    async fn auto_recall(&self, params: &AutoRecallParams) -> Result<Value> {
        self.build_context(&params.query, params.token_budget).await
    }

    async fn auto_capture(&self, text: &str, _source: &str) -> Result<Value> {
        // Mock SIU parsing for local fallback (when no cloud is active)
        let mtype = "semantic".to_string();
        self.remember(&RememberParams {
            content: text.to_string(),
            memory_type: mtype,
            heat: Some(60.0),
            namespace: Some(self.namespace.clone()),
        }).await
    }

    async fn relate(&self, params: &RelateParams) -> Result<Value> {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO edges (id, source_id, target_id, relation, weight)
             VALUES ($1, $2, $3, $4, 1.0)
             ON CONFLICT (source_id, target_id, relation) DO UPDATE SET
                weight = EXCLUDED.weight"
        )
        .bind(&id)
        .bind(&params.source_id)
        .bind(&params.target_id)
        .bind(&params.relation)
        .execute(&self.pool)
        .await?;

        Ok(json!({ "edge_id": id }))
    }

    async fn graph_traverse(&self, memory_id: &str, depth: u32) -> Result<Value> {
        let mut neighbors = Vec::new();

        if depth >= 1 {
            let rows = sqlx::query_as::<_, EdgeRow>(
                "SELECT * FROM edges WHERE source_id = $1 OR target_id = $1"
            )
            .bind(memory_id)
            .fetch_all(&self.pool)
            .await?;

            for row in rows {
                neighbors.push(json!({
                    "id": row.id,
                    "source": row.source_id,
                    "target": row.target_id,
                    "relation": row.relation,
                    "weight": row.weight,
                }));
            }
        }

        Ok(json!({
            "start": memory_id,
            "depth": depth,
            "edges": neighbors,
        }))
    }

    async fn create_trigger(&self, params: &CreateTriggerParams) -> Result<Value> {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO triggers (id, name, event, action, filter_memory_type, filter_namespace, filter_label_pattern)
             VALUES ($1, $2, $3, $4, $5, $6, $7)"
        )
        .bind(&id)
        .bind(&params.name)
        .bind(&params.event)
        .bind(&params.action)
        .bind(&params.filter_memory_type)
        .bind(&params.filter_namespace)
        .bind(&params.filter_label_pattern)
        .execute(&self.pool)
        .await?;

        Ok(json!({ "trigger_id": id }))
    }

    async fn list_triggers(&self) -> Result<Value> {
        let rows = sqlx::query_as::<_, TriggerRow>(
            "SELECT * FROM triggers ORDER BY created_at DESC"
        )
        .fetch_all(&self.pool)
        .await?;

        let items: Vec<Value> = rows.iter().map(|row| {
            json!({
                "id": row.id,
                "name": row.name.clone(),
                "event": row.event.clone(),
                "action": row.action.clone(),
                "filter_memory_type": row.filter_memory_type.clone(),
                "filter_namespace": row.filter_namespace.clone(),
                "filter_label_pattern": row.filter_label_pattern.clone(),
                "created_at": row.created_at.clone(),
            })
        }).collect();

        Ok(json!({ "triggers": items }))
    }

    async fn delete_trigger(&self, trigger_id: &str) -> Result<Value> {
        let result = sqlx::query("DELETE FROM triggers WHERE id = $1")
            .bind(trigger_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            anyhow::bail!("Trigger not found: {trigger_id}");
        }

        Ok(json!({ "deleted": trigger_id }))
    }

    async fn classify(&self, text: &str) -> Result<Value> {
        Ok(json!({
            "classification": "semantic",
            "confidence": 0.85,
            "text": text,
        }))
    }

    async fn scan_pii(&self, text: &str) -> Result<Value> {
        Ok(json!({
            "has_pii": false,
            "spans": [],
            "text": text,
        }))
    }

    async fn status(&self) -> Result<Value> {
        Ok(json!({
            "status": "healthy",
            "backend": "local_postgres",
            "namespace": self.namespace,
        }))
    }

    async fn memory_status(&self) -> Result<Value> {
        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM memories WHERE namespace = $1"
        )
        .bind(&self.namespace)
        .fetch_one(&self.pool)
        .await?;

        let embedded: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM embeddings e JOIN memories m ON m.id = e.memory_id WHERE m.namespace = $1"
        )
        .bind(&self.namespace)
        .fetch_one(&self.pool)
        .await?;

        let pinned: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM memories WHERE namespace = $1 AND is_pinned = 1"
        )
        .bind(&self.namespace)
        .fetch_one(&self.pool)
        .await?;

        let avg_heat: f64 = sqlx::query_scalar(
            "SELECT COALESCE(AVG(current_heat), 0.0) FROM memories WHERE namespace = $1"
        )
        .bind(&self.namespace)
        .fetch_one(&self.pool)
        .await?;

        let active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM memories WHERE namespace = $1 AND current_heat > 30.0"
        )
        .bind(&self.namespace)
        .fetch_one(&self.pool)
        .await?;

        Ok(json!({
            "total_nodes": total,
            "embedded_nodes": embedded,
            "pinned_nodes": pinned,
            "active_nodes": active,
            "average_heat": avg_heat,
            "backend": "local_postgres",
        }))
    }

    fn namespace(&self) -> &str {
        &self.namespace
    }
}
