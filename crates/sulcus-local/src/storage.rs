use sqlx::{postgres::PgPool, Row};
use uuid::Uuid;
use serde_json::json;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use hnsw_rs::prelude::*;

use sulcus_core::graph::Node;
use sulcus_core::mmu::{Page as CorePage, PageFaultHandler};
use sulcus_core::zero_copy::{NodePointer, SharedIndexBuffer};
use sulcus_core::StorageBackend;

/// Shared index for hot nodes (MMU Page Table).
pub type ActiveIndex = HashMap<Uuid, f32>;

#[derive(Clone)]
pub struct LocalStorage {
    pool: PgPool,
    /// Zero-copy shared index buffer: rkyv-encoded NodePointers for the active index.
    /// LLM runtimes can read this via mmap with zero deserialization overhead.
    shared_index: SharedIndexBuffer,
    /// In-memory HNSW index for fast vector search when pgvector is unavailable.
    /// Maps usize (HNSW internal ID) to Uuid.
    hnsw: Arc<RwLock<Option<Hnsw<'static, f32, DistCosine>>>>,
    hnsw_id_map: Arc<RwLock<HashMap<usize, Uuid>>>,
    hnsw_id_rev_map: Arc<RwLock<HashMap<Uuid, usize>>>,
    hnsw_next_idx: Arc<std::sync::atomic::AtomicUsize>,
}

impl LocalStorage {
    /// Connect to a PostgreSQL database.
    pub async fn new(database_url: &str) -> anyhow::Result<Self> {
        use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

        let connect_options: PgConnectOptions = database_url.parse()?;
        let connect_options = connect_options.statement_cache_capacity(0);

        // PGlite (embedded JS backend) can't handle concurrent prepared statements
        // across multiple connections — limit to 5 for embedded, 50 for external PG.
        let is_embedded = database_url.contains("127.0.0.1:4201")
            || database_url.contains("localhost:4201")
            || std::env::var("SULCUS_DATABASE_URL").is_err();
        let max_conn = if is_embedded { 5 } else { 50 };

        let pool = PgPoolOptions::new()
            .test_before_acquire(false)
            .max_connections(max_conn)
            .connect_with(connect_options)
            .await?;

        let mmap_path = std::env::var("SULCUS_INDEX_PATH")
            .ok()
            .map(|p| std::path::PathBuf::from(p).join("active_index.bin"));

        let storage = Self {
            pool,
            shared_index: SharedIndexBuffer::new(mmap_path),
            hnsw: Arc::new(RwLock::new(None)),
            hnsw_id_map: Arc::new(RwLock::new(HashMap::new())),
            hnsw_id_rev_map: Arc::new(RwLock::new(HashMap::new())),
            hnsw_next_idx: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        };

        // Background: populate HNSW index from database
        let storage_clone = storage.clone();
        tokio::spawn(async move {
            if let Err(e) = storage_clone.rebuild_hnsw().await {
                tracing::error!(error = %e, "failed to rebuild HNSW index");
            }
        });

        Ok(storage)
    }

    pub async fn rebuild_hnsw(&self) -> anyhow::Result<()> {
        let rows = sqlx::raw_sql("SELECT node_id, vector FROM embeddings")
            .fetch_all(&self.pool)
            .await?;
        
        let hnsw = Hnsw::<f32, DistCosine>::new(32, rows.len().max(100), 16, 200, DistCosine);
        let mut id_map = HashMap::new();
        let mut rev_map = HashMap::new();

        for (idx, r) in rows.into_iter().enumerate() {
            if let Ok(id) = Uuid::parse_str(&r.get::<String, _>("node_id")) {
                if let Ok(v) = self.parse_vector_row(&r, 1) {
                    if !v.is_empty() {
                        hnsw.insert((&v, idx));
                        id_map.insert(idx, id);
                        rev_map.insert(id, idx);
                    }
                }
            }
        }

        let mut hnsw_guard = self.hnsw.write().unwrap();
        *hnsw_guard = Some(hnsw);
        let mut map_guard = self.hnsw_id_map.write().unwrap();
        *map_guard = id_map;
        let mut rev_guard = self.hnsw_id_rev_map.write().unwrap();
        *rev_guard = rev_map;
        self.hnsw_next_idx.store(map_guard.len(), std::sync::atomic::Ordering::SeqCst);
        
        tracing::info!(count = map_guard.len(), "HNSW index rebuilt");
        Ok(())
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub fn from_pool(pool: PgPool) -> Self {
        Self {
            pool,
            shared_index: SharedIndexBuffer::new(None),
            hnsw: Arc::new(RwLock::new(None)),
            hnsw_id_map: Arc::new(RwLock::new(HashMap::new())),
            hnsw_id_rev_map: Arc::new(RwLock::new(HashMap::new())),
            hnsw_next_idx: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        }
    }

    pub async fn db_file_size(&self) -> anyhow::Result<Option<u64>> {
        let row = sqlx::raw_sql("SELECT pg_database_size(current_database()) AS sz")
            .fetch_one(self.pool())
            .await?;
        let sz: i64 = row.try_get("sz")?;
        Ok(Some(sz as u64))
    }

    pub async fn set_server_cursor(&self, cursor: Option<&str>) -> anyhow::Result<()> { self.set_client_meta("server_cursor", cursor).await }
    pub async fn get_server_cursor(&self) -> anyhow::Result<Option<String>> { self.get_client_meta("server_cursor").await }
    pub async fn set_server_cursor_seq(&self, seq: Option<i64>) -> anyhow::Result<()> { self.set_client_meta("server_cursor_seq", seq.map(|s| s.to_string()).as_deref()).await }
    pub async fn get_server_cursor_seq(&self) -> anyhow::Result<Option<i64>> { let s = self.get_client_meta("server_cursor_seq").await?; Ok(s.and_then(|v| v.parse::<i64>().ok())) }
    pub async fn set_last_seq(&self, seq: Option<i64>) -> anyhow::Result<()> { self.set_client_meta("last_seq", seq.map(|s| s.to_string()).as_deref()).await }
    pub async fn get_last_seq(&self) -> anyhow::Result<Option<i64>> { let s = self.get_client_meta("last_seq").await?; Ok(s.and_then(|v| v.parse::<i64>().ok())) }

    pub async fn get_node_embedding(&self, node_id: Uuid) -> anyhow::Result<Option<Vec<f32>>> {
        let row = sqlx::query("SELECT vector FROM embeddings WHERE node_id = $1")
            .bind(node_id.to_string())
            .fetch_optional(self.pool())
            .await?;
        
        if let Some(row) = row {
            let vec: Vec<f32> = self.parse_vector_row(&row, 0)?;
            Ok(Some(vec))
        } else {
            Ok(None)
        }
    }

    fn parse_vector_row(&self, row: &sqlx::postgres::PgRow, index: usize) -> anyhow::Result<Vec<f32>> {
        // Try to parse as VECTOR string first (pgvector text format: "[1,2,3]")
        if let Ok(s) = row.try_get::<String, _>(index) {
             let vec: Vec<f32> = s.trim_matches(|c| c == '[' || c == ']')
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
             return Ok(vec);
        }
        // Fallback to BYTEA (little-endian f32 sequence)
        let bytes: Vec<u8> = row.try_get(index)?;
        if !bytes.len().is_multiple_of(4) {
            return Err(anyhow::anyhow!("invalid embedding length ({} bytes)", bytes.len()));
        }
        let vec: Vec<f32> = bytes.chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        Ok(vec)
    }

    pub async fn get_or_create_client_id(&self) -> anyhow::Result<[u8; 8]> {
        if let Some(s) = self.get_client_meta("client_id").await? {
            let id = uuid::Uuid::parse_str(&s)?;
            let arr: [u8; 8] = id.as_bytes()[..8].try_into().unwrap();
            return Ok(arr);
        }
        let id = uuid::Uuid::new_v4();
        self.set_client_meta("client_id", Some(&id.to_string())).await?;
        Ok(id.as_bytes()[..8].try_into().unwrap())
    }

    pub async fn search_vectors(&self, query: &[f32], limit: usize, namespace: Option<&str>, modality: Option<&str>, memory_type: Option<&str>) -> Vec<(Uuid, f32)> {
        // 1. Try native pgvector search with JOIN to nodes for metadata filtering
        let q_sql = format!("[{}]", query.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
        
        let mut base_query = "SELECT e.node_id, (1 - (e.vector::vector <=> $1::vector)) AS score 
                              FROM embeddings e 
                              JOIN nodes n ON n.id = e.node_id 
                              WHERE 1=1".to_string();
        
        let mut arg_idx = 3;
        if namespace.is_some() { base_query.push_str(&format!(" AND n.namespace = ${}", arg_idx)); arg_idx += 1; }
        if modality.is_some() { base_query.push_str(&format!(" AND n.modality = ${}", arg_idx)); arg_idx += 1; }
        if memory_type.is_some() { base_query.push_str(&format!(" AND n.memory_type = ${}", arg_idx)); }
        
        base_query.push_str(" ORDER BY e.vector::vector <=> $1::vector, e.node_id ASC LIMIT $2");

        let mut q = sqlx::query(&base_query)
            .bind(&q_sql)
            .bind(limit as i64);
        
        if let Some(ns) = namespace { q = q.bind(ns); }
        if let Some(m) = modality { q = q.bind(m); }
        if let Some(mt) = memory_type { q = q.bind(mt); }

        let native_res = q.fetch_all(self.pool()).await;
        
        if let Ok(rows) = native_res {
             let results: Vec<(Uuid, f32)> = rows.into_iter().filter_map(|r| {
                let id = Uuid::parse_str(&r.try_get::<String, _>("node_id").ok()?).ok()?;
                let score: f32 = r.try_get("score").unwrap_or(0.0);
                Some((id, score))
            }).collect();
            if !results.is_empty() {
                return results;
            }
        }

        // 2. Fallback: HNSW in-memory index
        let mut candidates = Vec::new();
        {
            let hnsw_guard = self.hnsw.read().unwrap();
            if let Some(hnsw) = &*hnsw_guard {
                let map_guard = self.hnsw_id_map.read().unwrap();
                let results: Vec<hnsw_rs::prelude::Neighbour> = hnsw.search(query, limit * 2, 100);
                for res in results {
                    if let Some(uuid) = map_guard.get(&res.d_id) {
                        candidates.push((*uuid, 1.0 - res.distance));
                    }
                }
            }
        }

        if !candidates.is_empty() {
            let mut out = Vec::new();
            for (uuid, score) in candidates {
                if namespace.is_some() || modality.is_some() || memory_type.is_some() {
                    if let Ok(Some(node)) = self.get_node_internal(uuid).await {
                        if let Some(ns) = namespace {
                            if node.namespace != ns { continue; }
                        }
                        if let Some(m) = modality {
                            if node.modality != m { continue; }
                        }
                        if let Some(mt) = memory_type {
                            if node.memory_type != mt { continue; }
                        }
                    } else {
                        continue;
                    }
                }
                out.push((uuid, score));
                if out.len() >= limit { break; }
            }

            if !out.is_empty() {
                // Sort for determinism (heat desc, then id asc)
                out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));
                out.truncate(limit);
                return out;
            }
        }

        // 3. Last Resort: Brute-force cosine in RAM with metadata JOIN
        let mut bf_query = "SELECT e.node_id, e.vector 
                            FROM embeddings e 
                            JOIN nodes n ON n.id = e.node_id 
                            WHERE 1=1".to_string();
        let mut bf_idx = 1;
        if namespace.is_some() { bf_query.push_str(&format!(" AND n.namespace = ${}", bf_idx)); bf_idx += 1; }
        if modality.is_some() { bf_query.push_str(&format!(" AND n.modality = ${}", bf_idx)); bf_idx += 1; }
        if memory_type.is_some() { bf_query.push_str(&format!(" AND n.memory_type = ${}", bf_idx)); }
        
        let mut q_bf = sqlx::query(&bf_query);
        if let Some(ns) = namespace { q_bf = q_bf.bind(ns); }
        if let Some(m) = modality { q_bf = q_bf.bind(m); }
        if let Some(mt) = memory_type { q_bf = q_bf.bind(mt); }

        let all_rows = q_bf.fetch_all(self.pool()).await.unwrap_or_default();
        let mut hits = Vec::new();
        for r in all_rows {
            if let Ok(id) = Uuid::parse_str(&r.get::<String, _>("node_id")) {
                if let Ok(v) = self.parse_vector_row(&r, 1) {
                    let score = self.cosine_similarity(query, &v);
                    hits.push((id, score));
                }
            }
        }
        // Deterministic sort: similarity desc, then id asc
        hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));
        hits.truncate(limit);
        hits
    }

    fn cosine_similarity(&self, a: &[f32], b: &[f32]) -> f32 {
        let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
        if na == 0.0 || nb == 0.0 { 0.0 } else { (dot / (na * nb)).clamp(-1.0, 1.0) }
    }

    pub async fn store_node_embedding(&self, node_id: Uuid, embedding: Vec<f32>) -> anyhow::Result<()> {
        // Try native vector insert first
        let emb_sql = format!("[{}]", embedding.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
        let res = sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2::vector) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
            .bind(node_id.to_string())
            .bind(&emb_sql)
            .execute(self.pool())
            .await;
        
        if res.is_err() {
            // Fallback to BYTEA blob
            let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
            sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                .bind(node_id.to_string())
                .bind(bytes)
                .execute(self.pool())
                .await?;
        }

        // Update HNSW in-memory index
        {
            let hnsw_guard = self.hnsw.read().unwrap();
            if let Some(hnsw) = &*hnsw_guard {
                let mut map_guard = self.hnsw_id_map.write().unwrap();
                let mut rev_guard = self.hnsw_id_rev_map.write().unwrap();
                
                // If it already exists, remove the old mapping to avoid duplicates in search results
                // since hnsw-rs doesn't support easy 'replace'.
                if let Some(old_idx) = rev_guard.remove(&node_id) {
                    map_guard.remove(&old_idx);
                }

                let next_idx = self.hnsw_next_idx.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                hnsw.insert((&embedding, next_idx));
                map_guard.insert(next_idx, node_id);
                rev_guard.insert(node_id, next_idx);
            }
        }

        Ok(())
    }

    pub async fn count_nodes(&self) -> anyhow::Result<i64> {
        let row = sqlx::raw_sql("SELECT COUNT(*) FROM nodes").fetch_one(self.pool()).await?;
        Ok(row.try_get(0)?)
    }

    pub async fn count_edges(&self) -> anyhow::Result<i64> {
        let row = sqlx::raw_sql("SELECT COUNT(*) FROM edges").fetch_one(self.pool()).await?;
        Ok(row.try_get(0)?)
    }

    pub async fn memory_ops_count(&self) -> anyhow::Result<i64> {
        let row = sqlx::raw_sql("SELECT COUNT(*) FROM memory_ops WHERE status = 'pending'").fetch_one(self.pool()).await?;
        Ok(row.try_get(0)?)
    }

    pub fn shared_index_bytes(&self) -> Vec<u8> {
        self.shared_index.as_bytes()
    }

    pub fn get_active_index_json(&self) -> Option<String> {
        let bytes = self.shared_index.as_bytes();
        if bytes.is_empty() { return None; }
        
        let mut out = Vec::new();
        if let Ok(iter) = SharedIndexBuffer::iter_archived(&bytes) {
            for ptr in iter {
                out.push(json!({
                    "id": Uuid::from_bytes(ptr.id_bytes).to_string(),
                    "heat": ptr.heat,
                    "label": ptr.label.to_string(),
                    "pointer_summary": ptr.summary.to_string(),
                    "is_tombstone": ptr.is_tombstone,
                    "address": ptr.address.to_string()
                }));
            }
        }
        if out.is_empty() { return None; }
        serde_json::to_string(&out).ok()
    }

    pub fn set_active_index_json(&self, json: String) -> anyhow::Result<()> {
        let val: Vec<serde_json::Value> = serde_json::from_str(&json)?;
        let mut pointers = Vec::new();
        for v in val {
            let id = Uuid::parse_str(v.get("id").and_then(|x| x.as_str()).unwrap_or_default())?;
            let heat = v.get("heat").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
            let label = v.get("label").and_then(|x| x.as_str()).unwrap_or_default();
            let summary = v.get("pointer_summary").and_then(|x| x.as_str()).unwrap_or_default();
            pointers.push(NodePointer::from_node(id, heat, label, summary));
        }
        let _ = self.shared_index.write_nodes(&pointers);
        Ok(())
    }

    pub fn write_shared_index(&self, pointers: &[NodePointer]) {
        let _ = self.shared_index.write_nodes(pointers);
    }

    pub async fn get_node_internal(&self, id: Uuid) -> anyhow::Result<Option<Node>> {
        let row = sqlx::query("SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, modality, source_mime, namespace FROM nodes WHERE id = $1").bind(id.to_string()).fetch_optional(self.pool()).await?;
        if let Some(r) = row {
            Ok(Some(Node {
                id: Uuid::parse_str(&r.get::<String, _>("id"))?,
                label: r.get("label"),
                pointer_summary: r.get("pointer_summary"),
                base_utility: r.get("base_utility"),
                current_heat: r.get("current_heat"),
                is_pinned: r.get("is_pinned"),
                memory_type: r.get("memory_type"),
                modality: r.get("modality"),
                source_mime: r.get("source_mime"),
                namespace: r.get("namespace"),
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn is_node_active(&self, id: &Uuid) -> anyhow::Result<bool> {
        let count: (i64,) = sqlx::query_as("SELECT count(*) FROM active_index WHERE node_id = $1")
            .bind(id.to_string())
            .fetch_one(self.pool())
            .await?;
        Ok(count.0 > 0)
    }

    pub async fn upsert_node_internal(&self, node: Node) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, modality, source_mime, namespace) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT(id) DO UPDATE SET label = EXCLUDED.label, pointer_summary = EXCLUDED.pointer_summary, base_utility = EXCLUDED.base_utility, current_heat = EXCLUDED.current_heat, is_pinned = EXCLUDED.is_pinned, memory_type = EXCLUDED.memory_type, modality = EXCLUDED.modality, source_mime = EXCLUDED.source_mime, namespace = EXCLUDED.namespace")
            .bind(node.id.to_string())
            .bind(node.label)
            .bind(node.pointer_summary)
            .bind(node.base_utility)
            .bind(node.current_heat)
            .bind(node.is_pinned)
            .bind(node.memory_type)
            .bind(node.modality)
            .bind(node.source_mime)
            .bind(node.namespace)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn insert_edge(&self, source: Uuid, target: Uuid, relationship: &str, weight: f32) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO edges (source_id, target_id, relationship_type, edge_weight) VALUES ($1, $2, $3, $4) ON CONFLICT(source_id, target_id) DO UPDATE SET edge_weight = EXCLUDED.edge_weight").bind(source.to_string()).bind(target.to_string()).bind(relationship).bind(weight).execute(self.pool()).await?;
        Ok(())
    }

    pub async fn list_edges(&self, source: Uuid) -> anyhow::Result<Vec<(Uuid, String, f32)>> {
        let rows = sqlx::query("SELECT target_id, relationship_type, edge_weight FROM edges WHERE source_id = $1 AND valid_to IS NULL").bind(source.to_string()).fetch_all(self.pool()).await?;
        let mut out = Vec::new();
        for r in rows {
            out.push((Uuid::parse_str(&r.get::<String, _>("target_id"))?, r.get("relationship_type"), r.get("edge_weight")));
        }
        Ok(out)
    }

    pub async fn get_payload(&self, node_id: Uuid) -> anyhow::Result<Option<String>> {
        let row = sqlx::query("SELECT raw_content FROM payloads WHERE node_id = $1").bind(node_id.to_string()).fetch_optional(self.pool()).await?;
        Ok(row.map(|r| r.get("raw_content")))
    }

    pub async fn insert_payload(&self, node_id: Uuid, content: &str) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET raw_content = EXCLUDED.raw_content").bind(node_id.to_string()).bind(content).execute(self.pool()).await?;
        Ok(())
    }

    pub async fn list_memory_ops_filtered(&self, heat_threshold: f32) -> anyhow::Result<Vec<(i64, String, serde_json::Value)>> {
        let rows = sqlx::query(
            "SELECT m.seq, m.op_type, m.payload 
             FROM memory_ops m 
             LEFT JOIN nodes n ON n.id = m.node_id 
             WHERE m.status = 'pending' 
               AND (m.node_id IS NULL OR n.current_heat >= $1 OR m.op_type = 'DELETE' OR n.is_pinned = TRUE)
             ORDER BY m.seq ASC"
        )
        .bind(heat_threshold)
        .fetch_all(self.pool())
        .await?;
        let mut out = Vec::new();
        for r in rows {
            let p_str: String = r.get("payload");
            let p_val: serde_json::Value = serde_json::from_str(&p_str)?;
            out.push((r.get("seq"), r.get("op_type"), p_val));
        }
        Ok(out)
    }

    pub async fn list_memory_ops_internal(&self) -> anyhow::Result<Vec<(i64, String, serde_json::Value)>> {
        let rows = sqlx::query("SELECT seq, op_type, payload FROM memory_ops WHERE status = 'pending' ORDER BY seq ASC").fetch_all(self.pool()).await?;
        let mut out = Vec::new();
        for r in rows {
            let p_str: String = r.get("payload");
            let p_val: serde_json::Value = serde_json::from_str(&p_str)?;
            out.push((r.get("seq"), r.get("op_type"), p_val));
        }
        Ok(out)
    }

    pub async fn record_memory_op_internal(&self, op_type: &str, payload: &serde_json::Value) -> anyhow::Result<()> {
        let p_str = serde_json::to_string(payload)?;
        let node_id = payload.get("id").or_else(|| payload.get("node_id")).and_then(|v| v.as_str()); sqlx::query("INSERT INTO memory_ops (op_type, payload, node_id) VALUES ($1, $2, $3)").bind(op_type).bind(p_str).bind(node_id).execute(self.pool()).await?;
        Ok(())
    }

    pub async fn mark_memory_ops_synced(&self, up_to_seq: i64) -> anyhow::Result<()> {
        sqlx::query("UPDATE memory_ops SET status = 'synced' WHERE seq <= $1").bind(up_to_seq).execute(self.pool()).await?;
        Ok(())
    }

    pub async fn get_client_meta(&self, key: &str) -> anyhow::Result<Option<String>> {
        let row = sqlx::query("SELECT value FROM client_meta WHERE key = $1").bind(key).fetch_optional(self.pool()).await?;
        Ok(row.map(|r| r.get("value")))
    }

    pub async fn set_client_meta(&self, key: &str, value: Option<&str>) -> anyhow::Result<()> {
        if let Some(v) = value {
            sqlx::query("INSERT INTO client_meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value").bind(key).bind(v).execute(self.pool()).await?;
        } else {
            sqlx::query("DELETE FROM client_meta WHERE key = $1").bind(key).execute(self.pool()).await?;
        }
        Ok(())
    }

    pub async fn list_pages(&self, space_id: &str) -> anyhow::Result<Vec<CorePage>> {
        let sid_uuid = Uuid::parse_str(space_id)?;
        let rows = sqlx::query("SELECT id, content, token_count FROM pages WHERE space_id = $1").bind(space_id).fetch_all(self.pool()).await?;
        let mut out = Vec::new();
        for r in rows {
            out.push(CorePage {
                id: r.get("id"),
                space_id: sid_uuid,
                content: r.get("content"),
                token_count: r.get::<i32, _>("token_count") as usize,
            });
        }
        Ok(out)
    }

    pub async fn get_page(&self, id: &str) -> anyhow::Result<Option<CorePage>> {
        let row = sqlx::query("SELECT id, space_id, content, token_count FROM pages WHERE id = $1").bind(id).fetch_optional(self.pool()).await?;
        if let Some(r) = row {
            let sid_str: String = r.get("space_id");
            Ok(Some(CorePage {
                id: r.get("id"),
                space_id: Uuid::parse_str(&sid_str)?,
                content: r.get("content"),
                token_count: r.get::<i32, _>("token_count") as usize,
            }))
        } else { Ok(None) }
    }

    pub async fn upsert_page(&self, page: sulcus_core::Page) -> anyhow::Result<()> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query("INSERT INTO pages (id, space_id, content, token_count, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO UPDATE SET content = EXCLUDED.content, token_count = EXCLUDED.token_count")
            .bind(page.id).bind(page.space_id.to_string()).bind(page.content).bind(page.token_count as i32).bind(now).execute(self.pool()).await?;
        Ok(())
    }

    pub async fn write_cold_storage(&self, node_id: Uuid, compressed: &str, summary: &str) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO cold_storage (node_id, compressed_content, fold_summary) VALUES ($1, $2, $3) ON CONFLICT(node_id) DO UPDATE SET compressed_content = EXCLUDED.compressed_content, fold_summary = EXCLUDED.fold_summary").bind(node_id.to_string()).bind(compressed).bind(summary).execute(self.pool()).await?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl StorageBackend for LocalStorage {
    async fn get_node(&self, id: Uuid) -> anyhow::Result<Option<Node>> {
        self.get_node_internal(id).await
    }

    async fn upsert_node(&self, node: Node) -> anyhow::Result<()> {
        self.upsert_node_internal(node).await
    }

    async fn list_hot_nodes(&self, limit: usize) -> anyhow::Result<Vec<Node>> {
        let rows = sqlx::query("SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, modality, source_mime, namespace FROM nodes ORDER BY current_heat DESC LIMIT $1").bind(limit as i64).fetch_all(self.pool()).await?;
        let mut out = Vec::new();
        for r in rows {
            out.push(Node {
                id: Uuid::parse_str(&r.get::<String, _>("id"))?,
                label: r.get("label"),
                pointer_summary: r.get("pointer_summary"),
                base_utility: r.get("base_utility"),
                current_heat: r.get("current_heat"),
                is_pinned: r.get("is_pinned"),
                memory_type: r.get("memory_type"),
                modality: r.get("modality"),
                source_mime: r.get("source_mime"),
                namespace: r.get("namespace"),
            });
        }
        Ok(out)
    }

    async fn record_memory_op(&self, op_type: &str, payload: &serde_json::Value) -> anyhow::Result<()> {
        self.record_memory_op_internal(op_type, payload).await
    }

    async fn set_active_index(&self, node_id: Uuid, heat: f32) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO active_index (node_id, heat) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET heat = EXCLUDED.heat, updated_at = CURRENT_TIMESTAMP")
            .bind(node_id.to_string()).bind(heat).execute(self.pool()).await?;
        Ok(())
    }

    async fn list_active_index(&self, limit: usize) -> anyhow::Result<Vec<(Uuid, f32)>> {
        let rows = sqlx::query("SELECT node_id, heat FROM active_index ORDER BY heat DESC LIMIT $1").bind(limit as i64).fetch_all(self.pool()).await?;
        let mut out = Vec::new();
        for r in rows {
            out.push((Uuid::parse_str(&r.get::<String, _>("node_id"))?, r.get("heat")));
        }
        Ok(out)
    }

    async fn get_crdt_clocks(&self, node_id: Uuid) -> anyhow::Result<HashMap<String, sulcus_core::crdt::Hlc>> {
        let row = sqlx::query("SELECT crdt_clocks FROM nodes WHERE id = $1").bind(node_id.to_string()).fetch_optional(self.pool()).await?;
        if let Some(r) = row {
            let val: Option<serde_json::Value> = r.get("crdt_clocks");
            if let Some(v) = val {
                return Ok(serde_json::from_value(v)?);
            }
        }
        Ok(HashMap::new())
    }

    async fn set_crdt_clocks(&self, node_id: Uuid, clocks: &HashMap<String, sulcus_core::crdt::Hlc>) -> anyhow::Result<()> {
        let val = serde_json::to_value(clocks)?;
        sqlx::query("UPDATE nodes SET crdt_clocks = $1 WHERE id = $2").bind(val).bind(node_id.to_string()).execute(self.pool()).await?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl PageFaultHandler for LocalStorage {
    async fn on_page_fault(&self, node_id: Uuid) -> anyhow::Result<Option<Node>> {
        let id_s = node_id.to_string();
        
        let row = sqlx::query(r#"
            UPDATE nodes 
            SET base_utility = LEAST(base_utility + 0.15, 1.0),
                current_heat = 1.0
            WHERE id = $1
            RETURNING id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, modality, source_mime, namespace
        "#)
        .bind(&id_s)
        .fetch_optional(self.pool())
        .await?;

        let node = match row {
            Some(r) => Node {
                id: Uuid::parse_str(&r.get::<String, _>("id"))?,
                label: r.get("label"),
                pointer_summary: r.get("pointer_summary"),
                base_utility: r.get("base_utility"),
                current_heat: r.get("current_heat"),
                is_pinned: r.get("is_pinned"),
                memory_type: r.get("memory_type"),
                modality: r.get("modality"),
                source_mime: r.get("source_mime"),
                namespace: r.get("namespace"),
            },
            None => return Ok(None),
        };

        self.set_active_index(node_id, 1.0).await?;
        Ok(Some(node))
    }

    async fn on_eviction(&self, node_id: Uuid, final_heat: f32) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM active_index WHERE node_id = $1").bind(node_id.to_string()).execute(self.pool()).await?;
        tracing::debug!(node_id = %node_id, final_heat, "node evicted from active index");
        Ok(())
    }
}

#[async_trait::async_trait]
impl sulcus_core::sync::WalCompactor for LocalStorage {
    async fn compact(&self, up_to_seq: i64) -> anyhow::Result<u64> {
        let result = sqlx::query("DELETE FROM memory_ops WHERE seq <= $1 AND status = 'synced'").bind(up_to_seq).execute(self.pool()).await?;
        Ok(result.rows_affected())
    }
    async fn compaction_horizon(&self) -> anyhow::Result<i64> { Ok(self.get_server_cursor_seq().await?.unwrap_or(0)) }
}

#[async_trait::async_trait]
impl crate::folds::FoldStorage for LocalStorage {
    async fn get_cold_storage(&self, node_id: Uuid) -> anyhow::Result<Option<(String, String)>> {
        let row = sqlx::query("SELECT compressed_content, fold_summary FROM cold_storage WHERE node_id = $1").bind(node_id.to_string()).fetch_optional(self.pool()).await?;
        Ok(row.map(|r| (r.get("compressed_content"), r.get("fold_summary"))))
    }

    async fn evict_to_cold_storage(&self, node_id: Uuid, final_heat: f32) -> anyhow::Result<()> {
        let payload = self.get_payload(node_id).await?.unwrap_or_default();
        let fold_summary = self.get_cold_storage(node_id).await?.unwrap_or_default();
        self.write_cold_storage(node_id, &payload, &fold_summary.1).await?;
        tracing::debug!(node_id = %node_id, final_heat, "eviction: node archived to cold_storage");
        Ok(())
    }
}
