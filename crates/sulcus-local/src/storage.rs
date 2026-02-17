use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use sulcus_core::graph::Node;
use sulcus_core::StorageBackend;

#[derive(Clone)]
pub struct SqliteStorage {
    pool: SqlitePool,
    // optional path to the backing sqlite file (extracted from the database_url passed to `new`).
    db_path: Option<String>,
    /// Cached minified JSON for `memory://active_index` (thread-safe)
    active_index_json: std::sync::Arc<std::sync::RwLock<String>>,
}

impl SqliteStorage {
    /// Connect to a Sqlite database. `database_url` should be like `sqlite://./memory.db`.
    pub async fn new(database_url: &str) -> anyhow::Result<Self> {
        let pool = SqlitePool::connect(database_url).await?;
        // extract a file path when using `sqlite://` urls
        let db_path = if let Some(s) = database_url.strip_prefix("sqlite://") {
            Some(s.to_string())
        } else {
            None
        };
        Ok(Self {
            pool,
            db_path,
            active_index_json: std::sync::Arc::new(std::sync::RwLock::new(String::new())),
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

    /// Number of memory ops in the WAL.
    pub async fn memory_ops_count(&self) -> anyhow::Result<i64> {
        let row = sqlx::query("SELECT COUNT(*) as c FROM memory_ops")
            .fetch_one(self.pool())
            .await?;
        let c: i64 = row.try_get("c")?;
        Ok(c)
    }
}

#[async_trait::async_trait]
impl StorageBackend for SqliteStorage {
    async fn get_node(&self, id: Uuid) -> anyhow::Result<Option<Node>> {
        let id_s = id.to_string();
        let row = sqlx::query(
            "SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned FROM nodes WHERE id = ?",
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
            let is_pinned: i64 = row.try_get("is_pinned")?; // sqlite INTEGER
            let id = Uuid::parse_str(&id_str)?;
            Ok(Some(Node {
                id,
                label,
                pointer_summary,
                base_utility,
                current_heat,
                is_pinned: is_pinned != 0,
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
        let query = sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, created_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET label = excluded.label, pointer_summary = excluded.pointer_summary, base_utility = excluded.base_utility, current_heat = excluded.current_heat, is_pinned = excluded.is_pinned"#)
            .bind(node.id.to_string())
            .bind(node.label)
            .bind(node.pointer_summary)
            .bind(node.base_utility)
            .bind(node.current_heat)
            .bind(node.is_pinned as i64);
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
            "SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned FROM nodes ORDER BY (current_heat + (base_utility * 0.5)) DESC LIMIT ?",
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
            let id = Uuid::parse_str(&id_str)?;
            out.push(Node {
                id,
                label,
                pointer_summary,
                base_utility,
                current_heat,
                is_pinned: is_pinned != 0,
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
        sqlx::query("INSERT INTO memory_ops (op_type, payload, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
            .bind(op_type)
            .bind(payload.to_string())
            .execute(self.pool())
            .await?;

        // update prometheus metric if initialized
        if let Some(m) = crate::metrics::try_get() {
            m.memory_ops_count.inc();
        }

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

    /// Thread-safe cached JSON for `memory://active_index`.
    pub fn set_active_index_json(&self, s: String) {
        if let Ok(mut w) = self.active_index_json.write() {
            *w = s;
        }
    }

    pub fn get_active_index_json(&self) -> String {
        if let Ok(r) = self.active_index_json.read() {
            return r.clone();
        }
        String::new()
    }

    pub async fn list_memory_ops(&self) -> anyhow::Result<Vec<(i64, String, serde_json::Value)>> {
        let rows =
            sqlx::query("SELECT seq_id, op_type, payload FROM memory_ops ORDER BY seq_id ASC")
                .fetch_all(self.pool())
                .await?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows.into_iter() {
            let seq_id: i64 = row.try_get("seq_id")?;
            let op_type: String = row.try_get("op_type")?;
            let payload_s: String = row.try_get("payload")?;
            let payload: serde_json::Value = serde_json::from_str(&payload_s)?;
            out.push((seq_id, op_type, payload));
        }

        Ok(out)
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
    async fn set_client_meta(&self, key: &str, value: Option<&str>) -> anyhow::Result<()> {
        if let Some(v) = value {
            sqlx::query("INSERT INTO client_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
                .bind(key)
                .bind(v)
                .execute(self.pool())
                .await?;
        } else {
            sqlx::query("DELETE FROM client_meta WHERE key = ?")
                .bind(key)
                .execute(self.pool())
                .await?;
        }
        Ok(())
    }

    async fn get_client_meta(&self, key: &str) -> anyhow::Result<Option<String>> {
        let row = sqlx::query("SELECT value FROM client_meta WHERE key = ?")
            .bind(key)
            .fetch_optional(self.pool())
            .await?;
        if let Some(r) = row {
            let v: String = r.try_get("value")?;
            Ok(Some(v))
        } else {
            Ok(None)
        }
    }

    pub async fn set_server_cursor(&self, cursor: Option<&str>) -> anyhow::Result<()> {
        self.set_client_meta("server_cursor", cursor).await
    }

    pub async fn get_server_cursor(&self) -> anyhow::Result<Option<String>> {
        self.get_client_meta("server_cursor").await
    }

    pub async fn set_server_cursor_seq(&self, seq: Option<i64>) -> anyhow::Result<()> {
        if let Some(s) = seq {
            self.set_client_meta("server_cursor_seq", Some(&s.to_string()))
                .await
        } else {
            self.set_client_meta("server_cursor_seq", None).await
        }
    }

    pub async fn get_server_cursor_seq(&self) -> anyhow::Result<Option<i64>> {
        if let Some(s) = self.get_client_meta("server_cursor_seq").await? {
            Ok(Some(s.parse::<i64>()?))
        } else {
            Ok(None)
        }
    }

    pub async fn set_last_seq(&self, seq: Option<i64>) -> anyhow::Result<()> {
        if let Some(s) = seq {
            self.set_client_meta("last_seq", Some(&s.to_string())).await
        } else {
            self.set_client_meta("last_seq", None).await
        }
    }

    pub async fn get_last_seq(&self) -> anyhow::Result<Option<i64>> {
        if let Some(s) = self.get_client_meta("last_seq").await? {
            Ok(Some(s.parse::<i64>()?))
        } else {
            Ok(None)
        }
    }
}
