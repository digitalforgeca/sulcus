//! Local SQLite storage backend for Sulcus.
//!
//! Implements `StorageBackend` using embedded SQLite with FTS5 for search.
//! Heat decay is computed on-read using exponential decay from `updated_at`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use uuid::Uuid;

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

/// Local embedded Sulcus storage backed by SQLite.
pub struct LocalStore {
    conn: Mutex<Connection>,
    namespace: String,
    db_path: PathBuf,
    embedder: Option<Box<dyn Embedder>>,
}

impl LocalStore {
    /// Open or create a local Sulcus database.
    ///
    /// The database file is stored at `path`. If it doesn't exist, it's created
    /// with the full schema. Namespace scopes all operations.
    pub fn open(path: impl AsRef<Path>, namespace: impl Into<String>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create directory: {}", parent.display()))?;
        }

        let conn = Connection::open(&path)
            .with_context(|| format!("Failed to open database: {}", path.display()))?;

        schema::init(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            namespace: namespace.into(),
            db_path: path,
            embedder: None,
        })
    }

    /// Open an in-memory database (for testing).
    pub fn in_memory(namespace: impl Into<String>) -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        schema::init(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            namespace: namespace.into(),
            db_path: PathBuf::from(":memory:"),
            embedder: None,
        })
    }

    /// Attach an embedder for vector search. When set, `remember()` auto-embeds
    /// new memories and `search()` uses hybrid FTS5+vector scoring.
    pub fn with_embedder(mut self, embedder: Box<dyn Embedder>) -> Self {
        self.embedder = Some(embedder);
        self
    }

    /// Check if an embedder is attached.
    pub fn has_embedder(&self) -> bool {
        self.embedder.is_some()
    }

    /// Get the database file path.
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// Backfill embeddings for memories that don't have one yet.
    /// Returns the number of memories embedded.
    pub fn embed_existing(&self, batch_size: usize) -> Result<usize> {
        let embedder = self.embedder.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No embedder attached — cannot backfill embeddings"))?;

        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT m.id, m.content FROM memories m
             LEFT JOIN embeddings e ON e.memory_id = m.id
             WHERE m.namespace = ?1 AND e.memory_id IS NULL
             LIMIT ?2"
        )?;

        let rows: Vec<(String, String)> = stmt
            .query_map(rusqlite::params![self.namespace, batch_size], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        if rows.is_empty() {
            return Ok(0);
        }

        let texts: Vec<&str> = rows.iter().map(|(_, c)| c.as_str()).collect();
        let embeddings = embedder.embed_batch(&texts)?;

        let model = embedder.model_name();
        let dims = embedder.dimensions() as i32;

        for ((id, _), vec) in rows.iter().zip(embeddings.iter()) {
            let blob = embedder::vector_to_blob(vec);
            conn.execute(
                "INSERT OR IGNORE INTO embeddings (memory_id, vector, model, dimensions) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, blob, model, dims],
            )?;
        }

        Ok(rows.len())
    }

    /// Helper: build a Memory from a row.
    fn memory_from_row(row: &rusqlite::Row) -> rusqlite::Result<(MemoryRow, String, bool)> {
        Ok((
            MemoryRow {
                id: row.get("id")?,
                content: row.get("content")?,
                pointer_summary: row.get("pointer_summary")?,
                memory_type: row.get("memory_type")?,
                namespace: row.get("namespace")?,
                current_heat: row.get("current_heat")?,
                base_utility: row.get("base_utility")?,
                is_pinned: row.get::<_, i32>("is_pinned")? != 0,
                source: row.get("source")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            },
            row.get::<_, String>("memory_type")?,
            row.get::<_, i32>("is_pinned")? != 0,
        ))
    }

    fn row_to_json(row: &MemoryRow, memory_type: &str, is_pinned: bool) -> Value {
        let elapsed = elapsed_since(&row.updated_at);
        let heat = decayed_heat(row.current_heat, elapsed, memory_type, is_pinned);

        json!({
            "id": row.id,
            "label": row.content,
            "pointer_summary": row.pointer_summary,
            "memory_type": row.memory_type,
            "namespace": row.namespace,
            "current_heat": heat,
            "base_utility": row.base_utility,
            "is_pinned": is_pinned,
            "source": row.source,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        })
    }
}

/// Internal row representation.
struct MemoryRow {
    id: String,
    content: String,
    pointer_summary: Option<String>,
    memory_type: String,
    namespace: String,
    current_heat: f64,
    base_utility: f64,
    is_pinned: bool,
    source: Option<String>,
    created_at: String,
    updated_at: String,
}

#[async_trait::async_trait]
impl StorageBackend for LocalStore {
    async fn remember(&self, params: &RememberParams) -> Result<Value> {
        let id = Uuid::new_v4().to_string();
        let ns = params.namespace.as_deref().unwrap_or(&self.namespace);
        let heat = params.heat.unwrap_or(50.0);
        let mem_type = &params.memory_type;
        let content = &params.content;

        // Generate a pointer summary (first 120 chars)
        let summary: String = content.chars().take(120).collect();

        // Generate embedding if embedder is available
        let embedding = self.embedder.as_ref().and_then(|e| {
            match e.embed(content) {
                Ok(vec) => Some(vec),
                Err(err) => {
                    tracing::warn!("Failed to embed memory: {err}");
                    None
                }
            }
        });

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO memories (id, content, pointer_summary, memory_type, namespace, current_heat, base_utility)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            rusqlite::params![id, content, summary, mem_type, ns, heat],
        )?;

        // Store embedding if generated
        if let Some(ref vec) = embedding {
            let blob = embedder::vector_to_blob(vec);
            let model = self.embedder.as_ref().map(|e| e.model_name()).unwrap_or("unknown");
            let dims = vec.len() as i32;
            conn.execute(
                "INSERT INTO embeddings (memory_id, vector, model, dimensions) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, blob, model, dims],
            )?;
        }

        let has_embedding = embedding.is_some();

        Ok(json!({
            "id": id,
            "label": content,
            "pointer_summary": summary,
            "memory_type": mem_type,
            "namespace": ns,
            "current_heat": heat,
            "is_pinned": false,
            "has_embedding": has_embedding,
            "created_at": chrono::Utc::now().to_rfc3339(),
        }))
    }

    async fn search(&self, params: &SearchParams) -> Result<Value> {
        let limit = params.limit.min(50);

        // Embed the query if embedder is available
        let query_embedding = self.embedder.as_ref().and_then(|e| {
            match e.embed(&params.query) {
                Ok(vec) => Some(vec),
                Err(err) => {
                    tracing::warn!("Failed to embed query: {err}");
                    None
                }
            }
        });

        let conn = self.conn.lock().unwrap();

        // Phase 1: FTS5 full-text search
        let fts_query = fts5_escape(&params.query);
        let mut fts_sql = String::from(
            "SELECT m.*, fts.rank
             FROM memories_fts fts
             JOIN memories m ON m.rowid = fts.rowid
             WHERE memories_fts MATCH ?1
               AND m.namespace = ?2"
        );
        if let Some(ref mt) = params.memory_type {
            fts_sql.push_str(&format!(" AND m.memory_type = '{}'", mt.replace('\'', "''")));
        }
        // Fetch more candidates for hybrid merging
        let fetch_limit = if query_embedding.is_some() { limit * 3 } else { limit };
        fts_sql.push_str(" ORDER BY fts.rank LIMIT ?3");

        let mut fts_stmt = conn.prepare(&fts_sql)?;
        let fts_results: Vec<(String, Value, f64)> = fts_stmt
            .query_map(rusqlite::params![fts_query, self.namespace, fetch_limit], |row| {
                let (mem_row, mem_type, pinned) = Self::memory_from_row(row)?;
                let rank: f64 = row.get("rank")?;
                let id = mem_row.id.clone();
                let node = Self::row_to_json(&mem_row, &mem_type, pinned);
                // Normalize BM25 rank to 0-1 (more negative = better match)
                let score = 1.0 / (1.0 + rank.abs());
                Ok((id, node, score))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Phase 2: Vector search (if embedder available)
        if let Some(ref q_vec) = query_embedding {
            // Fetch all embeddings for this namespace and compute cosine similarity
            // Brute-force is fine for <100k memories; switch to ANN index later if needed
            let mut vec_sql = String::from(
                "SELECT e.memory_id, e.vector, m.*
                 FROM embeddings e
                 JOIN memories m ON m.id = e.memory_id
                 WHERE m.namespace = ?1"
            );
            if let Some(ref mt) = params.memory_type {
                vec_sql.push_str(&format!(" AND m.memory_type = '{}'", mt.replace('\'', "''")));
            }

            let mut vec_stmt = conn.prepare(&vec_sql)?;
            let mut vec_results: Vec<(String, Value, f64)> = vec_stmt
                .query_map(rusqlite::params![self.namespace], |row| {
                    let memory_id: String = row.get("memory_id")?;
                    let blob: Vec<u8> = row.get("vector")?;
                    let (mem_row, mem_type, pinned) = Self::memory_from_row(row)?;
                    let node = Self::row_to_json(&mem_row, &mem_type, pinned);
                    Ok((memory_id, blob, node))
                })?
                .filter_map(|r| r.ok())
                .map(|(id, blob, node)| {
                    let stored_vec = embedder::blob_to_vector(&blob);
                    let sim = embedder::cosine_similarity(q_vec, &stored_vec);
                    // Normalize cosine similarity from [-1,1] to [0,1]
                    let score = ((sim + 1.0) / 2.0) as f64;
                    (id, node, score)
                })
                .collect();

            // Sort by vector score descending, take top candidates
            vec_results.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
            vec_results.truncate(fetch_limit as usize);

            // Phase 3: Reciprocal Rank Fusion (RRF) to merge FTS5 + vector results
            // RRF score = 1/(k+rank_fts) + 1/(k+rank_vec) where k=60 (standard constant)
            let k = 60.0;
            let mut score_map: std::collections::HashMap<String, (Value, f64)> = std::collections::HashMap::new();

            for (rank, (id, node, _score)) in fts_results.iter().enumerate() {
                let rrf = 1.0 / (k + rank as f64 + 1.0);
                score_map.entry(id.clone()).or_insert_with(|| (node.clone(), 0.0)).1 += rrf;
            }

            for (rank, (id, node, _score)) in vec_results.iter().enumerate() {
                let rrf = 1.0 / (k + rank as f64 + 1.0);
                score_map.entry(id.clone()).or_insert_with(|| (node.clone(), 0.0)).1 += rrf;
            }

            // Sort by combined RRF score
            let mut combined: Vec<(Value, f64)> = score_map.into_values().collect();
            combined.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            combined.truncate(limit as usize);

            let results: Vec<Value> = combined
                .into_iter()
                .map(|(node, score)| json!({ "node": node, "score": score }))
                .collect();

            return Ok(json!({
                "results": results,
                "search_mode": "hybrid",
            }));
        }

        // FTS-only results (no embedder)
        let results: Vec<Value> = fts_results
            .into_iter()
            .take(limit as usize)
            .map(|(_id, node, score)| json!({ "node": node, "score": score }))
            .collect();

        Ok(json!({
            "results": results,
            "search_mode": "fts5",
        }))
    }

    async fn list(&self, params: &ListParams) -> Result<Value> {
        let conn = self.conn.lock().unwrap();

        let page = params.page.max(1);
        let page_size = params.page_size.min(100).max(1);
        let offset = (page - 1) * page_size;

        let mut conditions = vec!["namespace = ?1".to_string()];
        if let Some(ref mt) = params.memory_type {
            conditions.push(format!("memory_type = '{}'", mt.replace('\'', "''")));
        }
        if let Some(pinned) = params.pinned {
            conditions.push(format!("is_pinned = {}", if pinned { 1 } else { 0 }));
        }

        let where_clause = conditions.join(" AND ");

        // Count total
        let count_sql = format!("SELECT COUNT(*) FROM memories WHERE {where_clause}");
        let total: u64 = conn.query_row(&count_sql, [&self.namespace], |row| row.get(0))?;

        // Fetch page
        let select_sql = format!(
            "SELECT * FROM memories WHERE {where_clause} ORDER BY current_heat DESC LIMIT ?2 OFFSET ?3"
        );

        let mut stmt = conn.prepare(&select_sql)?;
        let items: Vec<Value> = stmt
            .query_map(rusqlite::params![self.namespace, page_size, offset], |row| {
                let (mem_row, mem_type, pinned) = Self::memory_from_row(row)?;
                Ok((mem_row, mem_type, pinned))
            })?
            .filter_map(|r| r.ok())
            .map(|(row, mem_type, pinned)| Self::row_to_json(&row, &mem_type, pinned))
            .collect();

        Ok(json!({
            "nodes": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }))
    }

    async fn get_memory(&self, memory_id: &str) -> Result<Memory> {
        let conn = self.conn.lock().unwrap();

        let row = conn.query_row(
            "SELECT * FROM memories WHERE id = ?1",
            [memory_id],
            |row| {
                let (mem_row, mem_type, pinned) = Self::memory_from_row(row)?;
                let elapsed = elapsed_since(&mem_row.updated_at);
                let heat = decayed_heat(mem_row.current_heat, elapsed, &mem_type, pinned);
                Ok(Memory {
                    id: mem_row.id,
                    pointer_summary: Some(mem_row.content),
                    memory_type: Some(mem_row.memory_type),
                    current_heat: Some(heat),
                    heat: Some(mem_row.current_heat),
                    base_utility: Some(mem_row.base_utility),
                    is_pinned: Some(pinned),
                    namespace: Some(mem_row.namespace),
                })
            },
        ).with_context(|| format!("Memory not found: {memory_id}"))?;

        Ok(row)
    }

    async fn forget(&self, memory_id: &str) -> Result<Value> {
        let conn = self.conn.lock().unwrap();
        let affected = conn.execute("DELETE FROM memories WHERE id = ?1", [memory_id])?;

        if affected == 0 {
            anyhow::bail!("Memory not found: {memory_id}");
        }

        Ok(json!({ "deleted": memory_id }))
    }

    async fn update(&self, params: &UpdateParams) -> Result<Value> {
        {
            let conn = self.conn.lock().unwrap();

            let mut sets = vec!["updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')".to_string()];
            if let Some(ref label) = params.label {
                sets.push(format!("content = '{}', pointer_summary = '{}'",
                    label.replace('\'', "''"),
                    label.chars().take(120).collect::<String>().replace('\'', "''")));
            }
            if let Some(ref mt) = params.memory_type {
                sets.push(format!("memory_type = '{}'", mt.replace('\'', "''")));
            }
            if let Some(pinned) = params.is_pinned {
                sets.push(format!("is_pinned = {}", if pinned { 1 } else { 0 }));
            }
            if let Some(heat) = params.heat {
                sets.push(format!("current_heat = {heat}"));
            }

            let sql = format!(
                "UPDATE memories SET {} WHERE id = ?1",
                sets.join(", ")
            );

            let affected = conn.execute(&sql, [&params.memory_id])?;
            if affected == 0 {
                anyhow::bail!("Memory not found: {}", params.memory_id);
            }
        } // conn lock dropped here

        let mem = self.get_memory(&params.memory_id).await?;
        Ok(serde_json::to_value(mem)?)
    }

    async fn boost(&self, memory_id: &str, amount: f64) -> Result<Value> {
        let conn = self.conn.lock().unwrap();
        let affected = conn.execute(
            "UPDATE memories SET current_heat = MIN(current_heat + ?2, 100.0),
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            rusqlite::params![memory_id, amount],
        )?;

        if affected == 0 {
            anyhow::bail!("Memory not found: {memory_id}");
        }

        let new_heat: f64 = conn.query_row(
            "SELECT current_heat FROM memories WHERE id = ?1",
            [memory_id],
            |row| row.get(0),
        )?;

        Ok(json!({
            "id": memory_id,
            "current_heat": new_heat,
            "boosted_by": amount,
        }))
    }

    async fn deprecate(&self, memory_id: &str, amount: f64) -> Result<Value> {
        let conn = self.conn.lock().unwrap();
        let affected = conn.execute(
            "UPDATE memories SET current_heat = MAX(current_heat - ?2, 0.0),
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            rusqlite::params![memory_id, amount],
        )?;

        if affected == 0 {
            anyhow::bail!("Memory not found: {memory_id}");
        }

        let new_heat: f64 = conn.query_row(
            "SELECT current_heat FROM memories WHERE id = ?1",
            [memory_id],
            |row| row.get(0),
        )?;

        Ok(json!({
            "id": memory_id,
            "current_heat": new_heat,
            "deprecated_by": amount,
        }))
    }

    async fn hot_nodes(&self, limit: u32) -> Result<Value> {
        let conn = self.conn.lock().unwrap();
        let limit = limit.min(50);

        let mut stmt = conn.prepare(
            "SELECT * FROM memories WHERE namespace = ?1
             ORDER BY current_heat DESC LIMIT ?2"
        )?;

        let nodes: Vec<Value> = stmt
            .query_map(rusqlite::params![self.namespace, limit], |row| {
                let (mem_row, mem_type, pinned) = Self::memory_from_row(row)?;
                Ok((mem_row, mem_type, pinned))
            })?
            .filter_map(|r| r.ok())
            .map(|(row, mem_type, pinned)| Self::row_to_json(&row, &mem_type, pinned))
            .collect();

        Ok(json!({ "nodes": nodes }))
    }

    async fn build_context(&self, query: &str, _token_budget: u32) -> Result<Value> {
        // Simplified: just do a search and concatenate results
        let params = SearchParams {
            query: query.to_string(),
            limit: 10,
            memory_type: None,
        };
        let results = self.search(&params).await?;
        Ok(json!({
            "context": results,
            "note": "Local build_context uses FTS5 search — no token budgeting yet"
        }))
    }

    async fn auto_recall(&self, params: &AutoRecallParams) -> Result<Value> {
        // Local auto_recall is just search (no graph expansion yet)
        let search_params = SearchParams {
            query: params.query.clone(),
            limit: 10,
            memory_type: None,
        };
        self.search(&search_params).await
    }

    async fn auto_capture(&self, text: &str, source: &str) -> Result<Value> {
        // Local auto_capture stores directly (no SIU quality gate)
        let params = RememberParams {
            content: text.to_string(),
            memory_type: "semantic".to_string(),
            heat: None,
            namespace: None,
        };
        let mut result = self.remember(&params).await?;
        if let Some(obj) = result.as_object_mut() {
            obj.insert("source".to_string(), json!(source));
            obj.insert("note".to_string(), json!("Local auto_capture — no SIU quality gate"));
        }
        Ok(result)
    }

    async fn relate(&self, params: &RelateParams) -> Result<Value> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();

        conn.execute(
            "INSERT OR REPLACE INTO edges (id, source_id, target_id, relation)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, params.source_id, params.target_id, params.relation],
        )?;

        Ok(json!({
            "id": id,
            "source_id": params.source_id,
            "target_id": params.target_id,
            "relation": params.relation,
        }))
    }

    async fn graph_traverse(&self, memory_id: &str, depth: u32) -> Result<Value> {
        let conn = self.conn.lock().unwrap();
        let depth = depth.min(5);

        // BFS traversal
        let mut visited = std::collections::HashSet::new();
        let mut queue = vec![memory_id.to_string()];
        let mut edges_found = Vec::new();

        for _ in 0..depth {
            let mut next_queue = Vec::new();
            for node_id in &queue {
                if !visited.insert(node_id.clone()) {
                    continue;
                }

                let mut stmt = conn.prepare(
                    "SELECT id, source_id, target_id, relation FROM edges
                     WHERE source_id = ?1 OR target_id = ?1"
                )?;

                let rows: Vec<Value> = stmt
                    .query_map([node_id], |row| {
                        let source: String = row.get("source_id")?;
                        let target: String = row.get("target_id")?;
                        let relation: String = row.get("relation")?;
                        Ok(json!({
                            "source_id": source,
                            "target_id": target,
                            "relation": relation,
                        }))
                    })?
                    .filter_map(|r| r.ok())
                    .collect();

                for edge in &rows {
                    let s = edge["source_id"].as_str().unwrap_or("");
                    let t = edge["target_id"].as_str().unwrap_or("");
                    if s != node_id.as_str() {
                        next_queue.push(s.to_string());
                    }
                    if t != node_id.as_str() {
                        next_queue.push(t.to_string());
                    }
                }
                edges_found.extend(rows);
            }
            queue = next_queue;
        }

        Ok(json!({
            "root": memory_id,
            "depth": depth,
            "nodes_visited": visited.len(),
            "edges": edges_found,
        }))
    }

    async fn create_trigger(&self, params: &CreateTriggerParams) -> Result<Value> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO triggers (id, name, event, action, filter_memory_type, filter_namespace, filter_label_pattern)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                id,
                params.name,
                params.event,
                params.action,
                params.filter_memory_type,
                params.filter_namespace,
                params.filter_label_pattern,
            ],
        )?;

        Ok(json!({
            "id": id,
            "name": params.name,
            "event": params.event,
            "action": params.action,
        }))
    }

    async fn list_triggers(&self) -> Result<Value> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM triggers ORDER BY created_at DESC")?;

        let triggers: Vec<Value> = stmt
            .query_map([], |row| {
                Ok(json!({
                    "id": row.get::<_, String>("id")?,
                    "name": row.get::<_, Option<String>>("name")?,
                    "event": row.get::<_, String>("event")?,
                    "action": row.get::<_, String>("action")?,
                    "filter_memory_type": row.get::<_, Option<String>>("filter_memory_type")?,
                    "filter_namespace": row.get::<_, Option<String>>("filter_namespace")?,
                    "filter_label_pattern": row.get::<_, Option<String>>("filter_label_pattern")?,
                    "created_at": row.get::<_, String>("created_at")?,
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(json!({ "triggers": triggers }))
    }

    async fn delete_trigger(&self, trigger_id: &str) -> Result<Value> {
        let conn = self.conn.lock().unwrap();
        let affected = conn.execute("DELETE FROM triggers WHERE id = ?1", [trigger_id])?;

        if affected == 0 {
            anyhow::bail!("Trigger not found: {trigger_id}");
        }

        Ok(json!({ "deleted": trigger_id }))
    }

    async fn classify(&self, _text: &str) -> Result<Value> {
        // SIU classification requires the ONNX model (Task 5.1)
        Ok(json!({
            "error": "Local SIU classification not available — requires embedded ONNX model (planned for Phase 5)",
            "suggestion": "Use cloud backend for SIU classification",
        }))
    }

    async fn scan_pii(&self, _text: &str) -> Result<Value> {
        // PII scanning requires the model
        Ok(json!({
            "error": "Local PII scanning not available — requires embedded model (planned for Phase 5)",
            "suggestion": "Use cloud backend for PII scanning",
        }))
    }

    async fn status(&self) -> Result<Value> {
        let conn = self.conn.lock().unwrap();

        let total: u64 = conn.query_row(
            "SELECT COUNT(*) FROM memories WHERE namespace = ?1",
            [&self.namespace],
            |row| row.get(0),
        )?;

        let db_size = std::fs::metadata(&self.db_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let embedded: u64 = conn.query_row(
            "SELECT COUNT(*) FROM embeddings e JOIN memories m ON m.id = e.memory_id WHERE m.namespace = ?1",
            [&self.namespace],
            |row| row.get(0),
        )?;

        let embedder_model = self.embedder.as_ref().map(|e| e.model_name().to_string());

        Ok(json!({
            "backend": "local",
            "database": self.db_path.display().to_string(),
            "namespace": self.namespace,
            "schema_version": schema::SCHEMA_VERSION,
            "status": "ok",
            "db_size_bytes": db_size,
            "total_memories": total,
            "embedded_memories": embedded,
            "embedder": embedder_model,
            "search_mode": if self.embedder.is_some() { "hybrid" } else { "fts5" },
        }))
    }

    async fn memory_status(&self) -> Result<Value> {
        let conn = self.conn.lock().unwrap();

        let total: u64 = conn.query_row(
            "SELECT COUNT(*) FROM memories WHERE namespace = ?1",
            [&self.namespace],
            |row| row.get(0),
        )?;

        let pinned: u64 = conn.query_row(
            "SELECT COUNT(*) FROM memories WHERE namespace = ?1 AND is_pinned = 1",
            [&self.namespace],
            |row| row.get(0),
        )?;

        let avg_heat: f64 = conn.query_row(
            "SELECT COALESCE(AVG(current_heat), 0.0) FROM memories WHERE namespace = ?1",
            [&self.namespace],
            |row| row.get(0),
        )?;

        // Type breakdown
        let mut stmt = conn.prepare(
            "SELECT memory_type, COUNT(*) FROM memories WHERE namespace = ?1 GROUP BY memory_type"
        )?;

        let types: Value = stmt
            .query_map([&self.namespace], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
            })?
            .filter_map(|r| r.ok())
            .fold(json!({}), |mut acc, (t, c)| {
                acc[t] = json!(c);
                acc
            });

        let hot: u64 = conn.query_row(
            "SELECT COUNT(*) FROM memories WHERE namespace = ?1 AND current_heat > 30.0",
            [&self.namespace],
            |row| row.get(0),
        )?;

        Ok(json!({
            "total": total,
            "hot": hot,
            "cold": total - hot,
            "pinned": pinned,
            "avg_heat": avg_heat,
            "types": types,
        }))
    }

    fn namespace(&self) -> &str {
        &self.namespace
    }
}

/// Escape a user query for FTS5 MATCH syntax.
/// Wraps each term in double quotes to avoid FTS5 syntax errors.
fn fts5_escape(query: &str) -> String {
    query
        .split_whitespace()
        .map(|word| {
            let clean: String = word.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-').collect();
            if clean.is_empty() {
                String::new()
            } else {
                format!("\"{clean}\"")
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" OR ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_remember_and_get() {
        let store = LocalStore::in_memory("test").unwrap();
        let params = RememberParams {
            content: "Rust is a systems programming language".to_string(),
            memory_type: "semantic".to_string(),
            heat: Some(75.0),
            namespace: None,
        };

        let result = store.remember(&params).await.unwrap();
        let id = result["id"].as_str().unwrap();

        let mem = store.get_memory(id).await.unwrap();
        assert_eq!(mem.id, id);
        assert!(mem.effective_heat() > 70.0);
    }

    #[tokio::test]
    async fn test_search_fts() {
        let store = LocalStore::in_memory("test").unwrap();

        // Store a few memories
        for content in &["Rust programming language", "Python data science", "JavaScript web development"] {
            store.remember(&RememberParams {
                content: content.to_string(),
                memory_type: "semantic".to_string(),
                heat: None,
                namespace: None,
            }).await.unwrap();
        }

        let results = store.search(&SearchParams {
            query: "Rust programming".to_string(),
            limit: 10,
            memory_type: None,
        }).await.unwrap();

        let hits = results["results"].as_array().unwrap();
        assert!(!hits.is_empty());
        assert!(hits[0]["node"]["label"].as_str().unwrap().contains("Rust"));
    }

    #[tokio::test]
    async fn test_list_paginated() {
        let store = LocalStore::in_memory("test").unwrap();

        for i in 0..5 {
            store.remember(&RememberParams {
                content: format!("Memory number {i}"),
                memory_type: "semantic".to_string(),
                heat: None,
                namespace: None,
            }).await.unwrap();
        }

        let result = store.list(&ListParams {
            page: 1,
            page_size: 2,
            memory_type: None,
            namespace: None,
            pinned: None,
        }).await.unwrap();

        assert_eq!(result["total"].as_u64().unwrap(), 5);
        assert_eq!(result["nodes"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn test_forget() {
        let store = LocalStore::in_memory("test").unwrap();
        let result = store.remember(&RememberParams {
            content: "Temporary memory".to_string(),
            memory_type: "episodic".to_string(),
            heat: None,
            namespace: None,
        }).await.unwrap();

        let id = result["id"].as_str().unwrap().to_string();
        store.forget(&id).await.unwrap();

        assert!(store.get_memory(&id).await.is_err());
    }

    #[tokio::test]
    async fn test_boost_and_deprecate() {
        let store = LocalStore::in_memory("test").unwrap();
        let result = store.remember(&RememberParams {
            content: "Boost me".to_string(),
            memory_type: "semantic".to_string(),
            heat: Some(50.0),
            namespace: None,
        }).await.unwrap();

        let id = result["id"].as_str().unwrap();

        let boosted = store.boost(id, 20.0).await.unwrap();
        assert_eq!(boosted["current_heat"].as_f64().unwrap(), 70.0);

        let deprecated = store.deprecate(id, 10.0).await.unwrap();
        assert_eq!(deprecated["current_heat"].as_f64().unwrap(), 60.0);
    }

    #[tokio::test]
    async fn test_status() {
        let store = LocalStore::in_memory("test").unwrap();
        let status = store.status().await.unwrap();

        assert_eq!(status["backend"].as_str().unwrap(), "local");
        assert_eq!(status["namespace"].as_str().unwrap(), "test");
        assert_eq!(status["status"].as_str().unwrap(), "ok");
    }

    #[tokio::test]
    async fn test_relate_and_traverse() {
        let store = LocalStore::in_memory("test").unwrap();

        let a = store.remember(&RememberParams {
            content: "Node A".to_string(),
            memory_type: "semantic".to_string(),
            heat: None,
            namespace: None,
        }).await.unwrap();

        let b = store.remember(&RememberParams {
            content: "Node B".to_string(),
            memory_type: "semantic".to_string(),
            heat: None,
            namespace: None,
        }).await.unwrap();

        let a_id = a["id"].as_str().unwrap();
        let b_id = b["id"].as_str().unwrap();

        store.relate(&RelateParams {
            source_id: a_id.to_string(),
            target_id: b_id.to_string(),
            relation: "related_to".to_string(),
        }).await.unwrap();

        let graph = store.graph_traverse(a_id, 2).await.unwrap();
        assert_eq!(graph["nodes_visited"].as_u64().unwrap(), 2);
        assert!(!graph["edges"].as_array().unwrap().is_empty());
    }
}
