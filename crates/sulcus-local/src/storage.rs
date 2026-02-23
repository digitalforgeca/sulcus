use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use chrono::Utc;
use std::collections::HashMap;

use sulcus_core::graph::Node;
use sulcus_core::mmu::Page as CorePage;
use sulcus_core::zero_copy::{NodePointer, SharedIndexBuffer};
use sulcus_core::StorageBackend;

use crate::embeddings::embed_text;
use crate::tokenizer::count_tokens;

// Embeddings are stored as raw BLOB (little-endian f32 bytes) and searched
// in-process via brute-force cosine similarity.  No native extension required.

/// A tombstone eviction pointer left in the context window when a page is evicted.
#[derive(Clone, Debug)]
pub struct Tombstone {
    pub page_id: Uuid,
    pub label: String,
    /// Human-readable hint: `"[Paged Out: 0x4A2F user preferences]"`
    pub address: String,
}

#[derive(Clone)]
pub struct SqliteStorage {
    pool: SqlitePool,
    /// Optional path to the backing SQLite file (extracted from the database_url).
    db_path: Option<String>,
    /// Zero-copy shared index buffer: rkyv-encoded NodePointers for the active index.
    /// LLM runtimes can read this via mmap with zero deserialization overhead.
    shared_index: SharedIndexBuffer,
}

impl SqliteStorage {
    /// Connect to a SQLite database. `database_url` should be `sqlite://./memory.db`.
    pub async fn new(database_url: &str) -> anyhow::Result<Self> {
        use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
        use std::str::FromStr;

        let opts = SqliteConnectOptions::from_str(database_url)?
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(std::time::Duration::from_secs(10))
            .create_if_missing(true);

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await?;
        let db_path = database_url.strip_prefix("sqlite://").map(str::to_string);

        // Derive a sibling `active_index.bin` mmap file next to the DB file.
        // This shared buffer is written on every thermodynamics tick and can be
        // mmap'd by any process (LLM runtime) for zero-deserialization reads.
        let mmap_path = db_path.as_deref().map(|p| {
            let mut pb = std::path::PathBuf::from(p);
            pb.set_file_name("active_index.bin");
            pb
        });

        Ok(Self {
            pool,
            db_path,
            shared_index: SharedIndexBuffer::new(mmap_path),
        })
    }

    /// Return the underlying pool for advanced use (tests / migrations).
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Return the backing sqlite file path, if known.
    pub fn db_file_path(&self) -> Option<String> {
        self.db_path.clone()
    }

    /// Return the size in bytes of the database file when available.
    pub fn db_file_size(&self) -> anyhow::Result<Option<u64>> {
        if let Some(p) = &self.db_path {
            let md = std::fs::metadata(p)?;
            Ok(Some(md.len()))
        } else {
            Ok(None)
        }
    }

    /// Number of nodes stored in the `nodes` table.
    pub async fn count_nodes(&self) -> anyhow::Result<i64> {
        let row = sqlx::query("SELECT COUNT(*) as c FROM nodes")
            .fetch_one(self.pool())
            .await?;
        let c: i64 = row.try_get("c")?;
        Ok(c)
    }

    /// `memory_ops` WAL has been removed — return zero.
    pub async fn memory_ops_count(&self) -> anyhow::Result<i64> {
        Ok(0)
    }
}

#[async_trait::async_trait]
impl StorageBackend for SqliteStorage {
    async fn get_node(&self, id: Uuid) -> anyhow::Result<Option<Node>> {
        let id_s = id.to_string();
        let row = sqlx::query(
            "SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned, \
             COALESCE(memory_type, 'episodic') AS memory_type FROM nodes WHERE id = ?",
        )
        .bind(id_s)
        .fetch_optional(self.pool())
        .await?;

        if let Some(row) = row {
            let id_str: String = row.try_get("id")?;
            let label: String = row.try_get("label")?;
            let pointer_summary: String = row.try_get("pointer_summary")?;
            let base_utility: f32 = row.try_get("base_utility")?;
            let current_heat: f32 = row.try_get("current_heat")?;
            let is_pinned: i64 = row.try_get("is_pinned")?;
            let memory_type: String = row
                .try_get("memory_type")
                .unwrap_or_else(|_| "episodic".to_string());
            let id = Uuid::parse_str(&id_str)?;
            Ok(Some(Node {
                id,
                label,
                pointer_summary,
                base_utility,
                current_heat,
                is_pinned: is_pinned != 0,
                memory_type,
            }))
        } else {
            Ok(None)
        }
    }

    async fn upsert_node(&self, node: Node) -> anyhow::Result<()> {
        eprintln!(
            "upsert_node: id={} label={}",
            node.id.to_string(),
            node.label
        );
        let query = sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET label = excluded.label, pointer_summary = excluded.pointer_summary,
               base_utility = excluded.base_utility, current_heat = excluded.current_heat,
               is_pinned = excluded.is_pinned, memory_type = excluded.memory_type,
               updated_at = CURRENT_TIMESTAMP"#)
            .bind(node.id.to_string())
            .bind(node.label)
            .bind(node.pointer_summary)
            .bind(node.base_utility)
            .bind(node.current_heat)
            .bind(node.is_pinned as i64)
            .bind(node.memory_type);
        if let Err(e) = query.execute(self.pool()).await {
            eprintln!("upsert_node SQL error: {:?}", e);
            return Err(e.into());
        }

        // reflect node count in metrics (best-effort)
        if let Some(m) = crate::metrics::try_get() {
            if let Ok(c) = self.count_nodes().await {
                m.num_nodes.set(c as f64);
            }
        }

        Ok(())
    }

    async fn list_hot_nodes(&self, limit: usize) -> anyhow::Result<Vec<Node>> {
        // Order by subjective importance score = current_heat + (base_utility * 0.5)
        let rows = sqlx::query(
            "SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned, \
             COALESCE(memory_type, 'episodic') AS memory_type \
             FROM nodes ORDER BY (current_heat + (base_utility * 0.5)) DESC LIMIT ?",
        )
        .bind(limit as i64)
        .fetch_all(self.pool())
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows.into_iter() {
            let id_str: String = row.try_get("id")?;
            let label: String = row.try_get("label")?;
            let pointer_summary: String = row.try_get("pointer_summary")?;
            let base_utility: f32 = row.try_get("base_utility")?;
            let current_heat: f32 = row.try_get("current_heat")?;
            let is_pinned: i64 = row.try_get("is_pinned")?;
            let memory_type: String = row
                .try_get("memory_type")
                .unwrap_or_else(|_| "episodic".to_string());
            let id = Uuid::parse_str(&id_str)?;
            out.push(Node {
                id,
                label,
                pointer_summary,
                base_utility,
                current_heat,
                is_pinned: is_pinned != 0,
                memory_type,
            });
        }

        Ok(out)
    }
}

// Helper methods that are not part of the StorageBackend trait.
impl SqliteStorage {
    pub async fn record_memory_op(
        &self,
        op_type: &str,
        payload: &serde_json::Value,
    ) -> anyhow::Result<()> {
        let payload_str = serde_json::to_string(payload)?;
        sqlx::query("INSERT INTO memory_ops (op_type, payload, status) VALUES (?, ?, 'pending')")
            .bind(op_type)
            .bind(payload_str)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn set_active_index(&self, id: Uuid, heat: f32) -> anyhow::Result<()> {
        sqlx::query(r#"INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP"#)
        .bind(id.to_string())
        .bind(heat)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn list_active_index(&self, limit: usize) -> anyhow::Result<Vec<(Uuid, f32)>> {
        let rows = sqlx::query("SELECT node_id, heat FROM active_index ORDER BY heat DESC LIMIT ?")
            .bind(limit as i64)
            .fetch_all(self.pool())
            .await?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows.into_iter() {
            let id_str: String = row.try_get("node_id")?;
            let heat: f32 = row.try_get("heat")?;
            out.push((Uuid::parse_str(&id_str)?, heat));
        }

        Ok(out)
    }

    /// Token-aware allocator: insert Page + embedding + page_table entry atomically.
    pub async fn mmu_alloc(
        &self,
        space_id: Uuid,
        session_id: Uuid,
        content: &str,
    ) -> anyhow::Result<Uuid> {
        // tokenize
        let token_count = count_tokens(content);

        // embed (fastembed singleton)
        let emb = embed_text(content)?;
        let emb_bytes: &[u8] = bytemuck::cast_slice(&emb);

        let mut tx = self.pool.begin().await?;

        let page_id = Uuid::now_v7();
        let now = Utc::now().timestamp();

        sqlx::query("INSERT INTO pages (id, space_id, content, token_count, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(page_id.to_string())
            .bind(space_id.to_string())
            .bind(content)
            .bind(token_count as i64)
            .bind(now)
            .execute(&mut *tx)
            .await?;

        sqlx::query("INSERT INTO page_embeddings (page_id, vector) VALUES (?, ?)")
            .bind(page_id.to_string())
            .bind(emb_bytes)
            .execute(&mut *tx)
            .await?;

        sqlx::query("INSERT INTO pages_fts (page_id, content) VALUES (?, ?)")
            .bind(page_id.to_string())
            .bind(content)
            .execute(&mut *tx)
            .await?;

        sqlx::query("INSERT INTO page_tables (session_id, page_id, heat, accessed_at) VALUES (?, ?, 1.0, ?)")
            .bind(session_id.to_string())
            .bind(page_id.to_string())
            .bind(now)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(page_id)
    }

    /// Hybrid search (vector + FTS) and strict token-bounded LRU eviction for a session.
    pub async fn mmu_fault(
        &self,
        session_id: Uuid,
        mounted_space_ids: &[Uuid],
        query: &str,
        max_tokens: usize,
    ) -> anyhow::Result<Vec<CorePage>> {
        // Phase A — Hybrid search
        if mounted_space_ids.is_empty() {
            return Ok(Vec::new());
        }

        let q_emb = embed_text(query)?;
        let q_dim = q_emb.len();

        // --- vector search over mounted spaces ---
        let placeholders = mounted_space_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("SELECT p.id as page_id, e.vector as vector_blob FROM page_embeddings e JOIN pages p ON p.id = e.page_id WHERE p.space_id IN ({})", placeholders);
        let mut q = sqlx::query(&sql);
        for sid in mounted_space_ids {
            q = q.bind(sid.to_string());
        }

        let rows = q.fetch_all(self.pool()).await?;
        let mut vec_scores: Vec<(Uuid, f32)> = Vec::new();
        for row in rows.into_iter() {
            let id_s: String = row.try_get("page_id")?;
            let blob: Vec<u8> = row.try_get("vector_blob")?;
            if blob.len() % 4 != 0 {
                continue;
            }
            let vec_f32: &[f32] = bytemuck::cast_slice(&blob);
            if vec_f32.len() != q_dim {
                continue;
            }

            // cosine similarity
            let mut dot = 0f32;
            let mut na = 0f32;
            let mut nb = 0f32;
            for i in 0..q_dim {
                let a = q_emb[i];
                let b = vec_f32[i];
                dot += a * b;
                na += a * a;
                nb += b * b;
            }
            let score = if na == 0.0 || nb == 0.0 {
                0.0
            } else {
                dot / (na.sqrt() * nb.sqrt())
            };
            if let Ok(id) = Uuid::parse_str(&id_s) {
                vec_scores.push((id, score));
            }
        }
        vec_scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        vec_scores.truncate(50);

        // --- FTS5 search ---
        let fts_rows =
            sqlx::query("SELECT page_id FROM pages_fts WHERE pages_fts MATCH ? LIMIT 50")
                .bind(query)
                .fetch_all(self.pool())
                .await?;

        let mut fts_ids: Vec<Uuid> = Vec::new();
        for r in fts_rows.into_iter() {
            let id_s: String = r.try_get("page_id")?;
            if let Ok(id) = Uuid::parse_str(&id_s) {
                fts_ids.push(id);
            }
        }

        // --- Reciprocal Rank Fusion (RRF) combine ---
        let mut score_map: HashMap<Uuid, f32> = HashMap::new();
        for (i, (id, _)) in vec_scores.iter().enumerate() {
            let add = 1.0f32 / (60.0f32 + (i as f32 + 1.0f32));
            *score_map.entry(*id).or_insert(0.0) += add;
        }
        for (i, id) in fts_ids.iter().enumerate() {
            let add = 1.0f32 / (60.0f32 + (i as f32 + 1.0f32));
            *score_map.entry(*id).or_insert(0.0) += add;
        }

        // select top-10 by fused score
        let mut fused: Vec<(Uuid, f32)> = score_map.into_iter().collect();
        fused.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        fused.truncate(10);
        let top_page_ids: Vec<Uuid> = fused.iter().map(|(id, _)| *id).collect();

        // Phase B — Page in (UPSERT into page_tables)
        let mut tx = self.pool.begin().await?;
        let now = Utc::now().timestamp();
        for pid in &top_page_ids {
            sqlx::query("INSERT INTO page_tables (session_id, page_id, heat, accessed_at) VALUES (?, ?, 1.0, ?) ON CONFLICT(session_id, page_id) DO UPDATE SET heat = 1.0, accessed_at = excluded.accessed_at")
                .bind(session_id.to_string())
                .bind(pid.to_string())
                .bind(now)
                .execute(&mut *tx)
                .await?;
        }

        // Phase C — LRU OOM Killer (token-bounded eviction)
        let rows = sqlx::query("SELECT pt.page_id as page_id, p.token_count as token_count, pt.heat as heat, pt.accessed_at as accessed_at FROM page_tables pt JOIN pages p ON p.id = pt.page_id WHERE pt.session_id = ? ORDER BY pt.heat DESC, pt.accessed_at DESC")
            .bind(session_id.to_string())
            .fetch_all(&mut *tx)
            .await?;

        let mut running_tokens: usize = 0;
        let mut keep_ids: Vec<Uuid> = Vec::new();
        let mut evict_ids: Vec<Uuid> = Vec::new();

        for row in rows.into_iter() {
            let id_s: String = row.try_get("page_id")?;
            let token_count_i: i64 = row.try_get("token_count")?;
            let token_count = token_count_i as usize;
            let pid = Uuid::parse_str(&id_s)?;

            if running_tokens + token_count > max_tokens {
                // this page and all remaining (colder) pages will be evicted
                evict_ids.push(pid);
            } else {
                running_tokens += token_count;
                keep_ids.push(pid);
            }
        }

        if !evict_ids.is_empty() {
            // ── Tombstoning: record a pointer for each evicted page ─────────────
            // The LLM sees these in the context window as:
            //   "[Paged Out: 0x{short_addr} {label}]"
            // giving it the exact reference needed to issue a page-fault recall.
            for evict_id in &evict_ids {
                // Derive a short human-readable address from the first 4 UUID bytes.
                let addr_hex = hex::encode(&evict_id.as_bytes()[0..4]);
                // Fetch label for the evicted page (best-effort).
                let label: String = sqlx::query("SELECT content FROM pages WHERE id = ?")
                    .bind(evict_id.to_string())
                    .fetch_optional(&mut *tx)
                    .await?
                    .and_then(|r| r.try_get::<String, _>("content").ok())
                    .map(|c| c.split_whitespace().take(5).collect::<Vec<_>>().join(" "))
                    .unwrap_or_default();
                let address = format!("[Paged Out: 0x{} {}]", addr_hex, label);
                sqlx::query(
                    "INSERT INTO tombstones (session_id, page_id, label, address, evicted_at) \
                     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) \
                     ON CONFLICT(session_id, page_id) DO UPDATE SET address = excluded.address, evicted_at = excluded.evicted_at",
                )
                .bind(session_id.to_string())
                .bind(evict_id.to_string())
                .bind(&label)
                .bind(&address)
                .execute(&mut *tx)
                .await?;
            }

            // ── Remove evicted pages from page_tables ─────────────────────────
            let placeholders = evict_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let del_sql = format!(
                "DELETE FROM page_tables WHERE session_id = ? AND page_id IN ({})",
                placeholders
            );
            let mut del_q = sqlx::query(&del_sql);
            del_q = del_q.bind(session_id.to_string());
            for id in &evict_ids {
                del_q = del_q.bind(id.to_string());
            }
            del_q.execute(&mut *tx).await?;
        }

        tx.commit().await?;

        // Phase D — Return pages that survived for this session (ordered by heat)
        let page_rows = sqlx::query("SELECT p.id, p.space_id, p.content, p.token_count FROM page_tables pt JOIN pages p ON p.id = pt.page_id WHERE pt.session_id = ? ORDER BY pt.heat DESC, pt.accessed_at DESC")
            .bind(session_id.to_string())
            .fetch_all(self.pool())
            .await?;

        let mut out: Vec<CorePage> = Vec::with_capacity(page_rows.len());
        for r in page_rows.into_iter() {
            let id_s: String = r.try_get("id")?;
            let space_id_s: String = r.try_get("space_id")?;
            let content: String = r.try_get("content")?;
            let token_count_i: i64 = r.try_get("token_count")?;
            let id = Uuid::parse_str(&id_s)?;
            let space_id = Uuid::parse_str(&space_id_s)?;
            out.push(CorePage::with_id(
                id,
                space_id,
                content,
                token_count_i as usize,
            ));
        }

        Ok(out)
    }

    /// Update the shared zero-copy index buffer from a slice of node rows.
    ///
    /// Called by the thermodynamics tick after rebuilding the active index.
    /// Each call encodes the nodes as rkyv-archived bytes and flushes to the
    /// mmap-backing file so LLM runtimes can read it without deserialization.
    pub fn write_shared_index(&self, pointers: &[NodePointer]) {
        if let Err(e) = self.shared_index.write_nodes(pointers) {
            tracing::warn!(error = %e, "failed to write shared index buffer");
        }
    }

    /// Return raw rkyv bytes for the `memory://active_index.bin` resource.
    /// Callers can serve this directly — zero deserialization needed.
    pub fn shared_index_bytes(&self) -> Vec<u8> {
        self.shared_index.as_bytes()
    }

    /// Return the shared index as minified JSON (used by JSON-RPC / MCP clients
    /// that cannot consume binary rkyv buffers directly).
    pub fn get_active_index_json(&self) -> String {
        let bytes = self.shared_index.as_bytes();
        if bytes.len() < 12 {
            return String::from("[]");
        }
        // Re-decode from the shared buffer to build compatible JSON.
        // NB: bind match result to a local so the temporary from iter_archived
        //     (which borrows `bytes`) is dropped before `bytes` leaves scope.
        let json_str = match SharedIndexBuffer::iter_archived(&bytes) {
            Ok(iter) => {
                let arr: Vec<serde_json::Value> = iter
                    .map(|p| {
                        let id = uuid::Uuid::from_bytes(
                            <[u8; 16]>::try_from(p.id_bytes.as_slice()).unwrap_or([0u8; 16]),
                        );
                        if p.is_tombstone {
                            serde_json::json!({ "id": id.to_string(), "label": p.label.as_str(), "is_tombstone": true, "address": p.address.as_str() })
                        } else {
                            serde_json::json!({ "id": id.to_string(), "label": p.label.as_str(), "pointer_summary": p.summary.as_str(), "heat": p.heat })
                        }
                    })
                    .collect();
                serde_json::to_string(&arr).unwrap_or_else(|_| String::from("[]"))
            }
            Err(_) => String::from("[]"),
        };
        json_str
    }

    /// Compatibility shim: accept a pre-built JSON string and store it as a
    /// fallback for older callers.  New code should use `write_shared_index`.
    pub fn set_active_index_json(&self, _s: String) {
        // no-op: the shared index is now the authoritative source; JSON is derived
        // on demand in `get_active_index_json`. This shim prevents compile errors
        // in callers that have not yet been updated.
    }

    pub async fn list_memory_ops(&self) -> anyhow::Result<Vec<(i64, String, serde_json::Value)>> {
        let rows = sqlx::query(
            "SELECT seq, op_type, payload FROM memory_ops WHERE status = 'pending' ORDER BY seq ASC",
        )
        .fetch_all(self.pool())
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let seq: i64 = row.try_get("seq")?;
            let op_type: String = row.try_get("op_type")?;
            let payload_str: String = row.try_get("payload")?;
            let payload: serde_json::Value =
                serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null);
            out.push((seq, op_type, payload));
        }
        Ok(out)
    }

    /// Mark all memory_ops with seq <= max_seq as synced (no longer pending).
    pub async fn mark_memory_ops_synced(&self, max_seq: i64) -> anyhow::Result<()> {
        sqlx::query("UPDATE memory_ops SET status = 'synced' WHERE seq <= ?")
            .bind(max_seq)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    // ── Tombstone helpers ──────────────────────────────────────────────────

    /// List tombstones for a session ordered by most recently evicted.
    pub async fn list_tombstones(
        &self,
        session_id: Uuid,
        limit: usize,
    ) -> anyhow::Result<Vec<Tombstone>> {
        let rows = sqlx::query(
            "SELECT page_id, label, address FROM tombstones \
             WHERE session_id = ? ORDER BY evicted_at DESC LIMIT ?",
        )
        .bind(session_id.to_string())
        .bind(limit as i64)
        .fetch_all(self.pool())
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let page_id_s: String = r.try_get("page_id")?;
            let label: String = r.try_get("label")?;
            let address: String = r.try_get("address")?;
            if let Ok(id) = Uuid::parse_str(&page_id_s) {
                out.push(Tombstone {
                    page_id: id,
                    label,
                    address,
                });
            }
        }
        Ok(out)
    }

    // ── Cold storage helpers ───────────────────────────────────────────────

    /// Persist the pre-fold raw content and the dense fold summary to cold storage.
    /// After this call, the warm `payloads` row should be removed by the caller.
    pub async fn write_cold_storage(
        &self,
        node_id: Uuid,
        compressed_content: &str,
        fold_summary: &str,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO cold_storage (node_id, compressed_content, fold_summary, folded_at) \
             VALUES (?, ?, ?, CURRENT_TIMESTAMP) \
             ON CONFLICT(node_id) DO UPDATE SET \
               compressed_content = excluded.compressed_content, \
               fold_summary = excluded.fold_summary, \
               folded_at = excluded.folded_at",
        )
        .bind(node_id.to_string())
        .bind(compressed_content)
        .bind(fold_summary)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    /// Retrieve pre-fold content from cold storage (page-fault recall).
    pub async fn read_cold_storage(
        &self,
        node_id: Uuid,
    ) -> anyhow::Result<Option<(String, String)>> {
        let row = sqlx::query(
            "SELECT compressed_content, fold_summary FROM cold_storage WHERE node_id = ?",
        )
        .bind(node_id.to_string())
        .fetch_optional(self.pool())
        .await?;
        match row {
            Some(r) => {
                let content: String = r.try_get("compressed_content")?;
                let summary: String = r.try_get("fold_summary")?;
                Ok(Some((content, summary)))
            }
            None => Ok(None),
        }
    }

    /// Payload helpers
    pub async fn get_payload(&self, node_id: Uuid) -> anyhow::Result<Option<String>> {
        let row = sqlx::query("SELECT raw_content FROM payloads WHERE node_id = ?")
            .bind(node_id.to_string())
            .fetch_optional(self.pool())
            .await?;
        if let Some(r) = row {
            let s: String = r.try_get("raw_content")?;
            Ok(Some(s))
        } else {
            Ok(None)
        }
    }

    pub async fn insert_payload(&self, node_id: Uuid, raw_content: &str) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET raw_content = excluded.raw_content")
            .bind(node_id.to_string())
            .bind(raw_content)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    /// Edge helpers
    pub async fn insert_edge(
        &self,
        source: Uuid,
        target: Uuid,
        relationship_type: &str,
        edge_weight: f32,
    ) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO edges (source_id, target_id, relationship_type, edge_weight) VALUES (?, ?, ?, ?) ON CONFLICT(source_id, target_id) DO UPDATE SET relationship_type = excluded.relationship_type, edge_weight = excluded.edge_weight")
            .bind(source.to_string())
            .bind(target.to_string())
            .bind(relationship_type)
            .bind(edge_weight)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    /// Fetch raw payload and apply reinforcement (utility bump + ignite)
    pub async fn fetch_payload_and_reinforce(
        &self,
        node_id: Uuid,
    ) -> anyhow::Result<Option<String>> {
        // fetch payload
        let payload = self.get_payload(node_id).await?;
        if payload.is_some() {
            // bump utility (cap at 1.0) and set current_heat = 1.0
            sqlx::query("UPDATE nodes SET base_utility = CASE WHEN base_utility + 0.15 > 1.0 THEN 1.0 ELSE base_utility + 0.15 END, current_heat = 1.0 WHERE id = ?")
                .bind(node_id.to_string())
                .execute(self.pool())
                .await?;

            // ensure it's visible in active_index
            self.set_active_index(node_id, 1.0).await?;
        }
        Ok(payload)
    }
}

// Client metadata helpers (persisted key/value store used by the sync client)
impl SqliteStorage {
    // client_meta/key-value store removed — provide no-op compatibility helpers.
    async fn set_client_meta(&self, _key: &str, _value: Option<&str>) -> anyhow::Result<()> {
        Ok(())
    }

    async fn get_client_meta(&self, _key: &str) -> anyhow::Result<Option<String>> {
        Ok(None)
    }

    // client-side sync state (server_cursor / last_seq) deprecated — return None / no-op.
    pub async fn set_server_cursor(&self, _cursor: Option<&str>) -> anyhow::Result<()> {
        Ok(())
    }
    pub async fn get_server_cursor(&self) -> anyhow::Result<Option<String>> {
        Ok(None)
    }
    pub async fn set_server_cursor_seq(&self, _seq: Option<i64>) -> anyhow::Result<()> {
        Ok(())
    }
    pub async fn get_server_cursor_seq(&self) -> anyhow::Result<Option<i64>> {
        Ok(None)
    }
    pub async fn set_last_seq(&self, _seq: Option<i64>) -> anyhow::Result<()> {
        Ok(())
    }
    pub async fn get_last_seq(&self) -> anyhow::Result<Option<i64>> {
        Ok(None)
    }
}
