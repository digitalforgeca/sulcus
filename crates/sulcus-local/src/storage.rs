use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use sulcus_core::graph::Node;
use sulcus_core::StorageBackend;

#[derive(Clone)]
pub struct SqliteStorage {
    pool: SqlitePool,
}

impl SqliteStorage {
    /// Connect to a Sqlite database. `database_url` should be like `sqlite://./memory.db`.
    pub async fn new(database_url: &str) -> anyhow::Result<Self> {
        let pool = SqlitePool::connect(database_url).await?;
        Ok(Self { pool })
    }

    /// Return the underlying pool for advanced use (tests / migrations).
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

#[async_trait::async_trait]
impl StorageBackend for SqliteStorage {
    async fn get_node(&self, id: Uuid) -> anyhow::Result<Option<Node>> {
        let id_s = id.to_string();
        let row = sqlx::query("SELECT id, summary, heat FROM nodes WHERE id = ?")
            .bind(id_s)
            .fetch_optional(self.pool())
            .await?;

        if let Some(row) = row {
            let id_str: String = row.try_get("id")?;
            let summary: String = row.try_get("summary")?;
            let heat: f32 = row.try_get("heat")?;
            let id = Uuid::parse_str(&id_str)?;
            Ok(Some(Node { id, summary, heat }))
        } else {
            Ok(None)
        }
    }

    async fn upsert_node(&self, node: Node) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO nodes (id, summary, heat, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) \
             ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, heat = excluded.heat",
        )
        .bind(node.id.to_string())
        .bind(node.summary)
        .bind(node.heat)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    async fn list_hot_nodes(&self, limit: usize) -> anyhow::Result<Vec<Node>> {
        let rows = sqlx::query("SELECT id, summary, heat FROM nodes ORDER BY heat DESC LIMIT ?")
            .bind(limit as i64)
            .fetch_all(self.pool())
            .await?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows.into_iter() {
            let id_str: String = row.try_get("id")?;
            let summary: String = row.try_get("summary")?;
            let heat: f32 = row.try_get("heat")?;
            let id = Uuid::parse_str(&id_str)?;
            out.push(Node { id, summary, heat });
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
        Ok(())
    }

    pub async fn set_active_index(&self, id: Uuid, heat: f32) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO active_index (node_id, heat, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) \
             ON CONFLICT(node_id) DO UPDATE SET heat = excluded.heat, updated_at = CURRENT_TIMESTAMP",
        )
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
