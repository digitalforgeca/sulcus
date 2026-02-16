use anyhow::Context;
use chrono::{DateTime, Utc};
use sqlx::Row;

use sulcus_core::sync::{MemoryOp, OpType, SyncEngine};
use sulcus_core::graph::Node;
use sulcus_core::StorageBackend;

use crate::SqliteStorage;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;

/// Local sync client: collects pending `memory_ops` and pushes/pulls via a `SyncEngine`.
pub struct LocalSyncClient {
    storage: SqliteStorage,
    last_seq: Option<i64>,
    /// Last-known server WAL seq cursor (if provided by server).
    server_cursor: Option<i64>,
}

impl LocalSyncClient {
    pub fn new(storage: SqliteStorage) -> Self {
        Self { storage, last_seq: None, server_cursor: None }
    }

    /// Accessor for the in-memory `server_cursor` (durable WAL seq from server).
    pub fn server_cursor_seq(&self) -> Option<i64> {
        self.server_cursor
    }

    /// Accessor for the in-memory `last_seq` (local WAL progress).
    pub fn last_seq(&self) -> Option<i64> {
        self.last_seq
    }

    /// Load persisted sync state (`last_seq` and `server_cursor`) from local storage.
    pub async fn load_persisted_state(&mut self) -> anyhow::Result<()> {
        self.last_seq = self.storage.get_last_seq().await?;
        self.server_cursor = self.storage.get_server_cursor_seq().await?;
        Ok(())
    }

    /// Collect pending ops from the local WAL (memory_ops table).
    /// Returns a vector of (seq_id, MemoryOp).
    pub async fn gather_pending_ops(&self, since_seq: Option<i64>) -> anyhow::Result<Vec<(i64, MemoryOp)>> {
        let since = since_seq.unwrap_or(0i64);
        let rows = sqlx::query("SELECT seq_id, op_type, payload, created_at FROM memory_ops WHERE seq_id > ? ORDER BY seq_id ASC")
            .bind(since)
            .fetch_all(self.storage.pool())
            .await?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows.into_iter() {
            let seq_id: i64 = row.try_get("seq_id")?;
            let op_type_s: String = row.try_get("op_type")?;
            let payload_s: Option<String> = row.try_get("payload").ok();

            let op = match op_type_s.to_uppercase().as_str() {
                "ADD" => OpType::Add,
                "UPDATE" => OpType::Update,
                "DELETE" => OpType::Delete,
                other => return Err(anyhow::anyhow!("unknown op_type {}", other)),
            };

            // fallback: use current timestamp for sync payloads (SQLite `created_at` parsing varies)
            let timestamp: DateTime<Utc> = Utc::now();

            let payload = if let Some(s) = payload_s {
                // payload is a JSON object representing Node (id, summary, heat)
                let v: serde_json::Value = serde_json::from_str(&s).context("invalid payload json")?;
                // map to Node struct if possible
                if let Ok(node) = serde_json::from_value::<Node>(v.clone()) {
                    Some(node)
                } else {
                    // try minimal mapping
                    let id_s = v.get("id").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("payload missing id"))?;
                    let id = uuid::Uuid::parse_str(id_s)?;
                    let summary = v.get("summary").and_then(|x| x.as_str()).unwrap_or_default().to_string();
                    let heat = v.get("heat").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
                    Some(Node { id, summary, heat })
                }
            } else {
                None
            };

            out.push((seq_id, MemoryOp { op, payload, timestamp }));
        }

        Ok(out)
    }

    /// Push pending ops to a remote `SyncEngine` implementation and update `last_seq`.
    pub async fn push_to_engine<E: SyncEngine + ?Sized>(&mut self, engine: &E) -> anyhow::Result<()> {
        let since_seq = self.last_seq;
        let pending = self.gather_pending_ops(since_seq).await?;
        if pending.is_empty() {
            return Ok(());
        }

        let ops: Vec<MemoryOp> = pending.iter().map(|(_seq, op)| op.clone()).collect();
        let res = engine.push(ops).await?;

        // advance last_seq (local WAL) on success and persist it
        if let Some((last_seq, _)) = pending.last() {
            self.last_seq = Some(*last_seq);
            // persist last_seq so restarts/resumes are durable
            self.storage.set_last_seq(self.last_seq).await?;
        }

        // update server cursor when provided by the remote and persist
        if let Some(seq) = res.new_cursor_seq {
            self.server_cursor = Some(seq);
            self.storage.set_server_cursor_seq(self.server_cursor).await?;
        }
        if let Some(cursor_s) = res.new_cursor {
            self.storage.set_server_cursor(Some(&cursor_s)).await?;
        }

        Ok(())
    }

    /// Pull ops from remote `SyncEngine` (since timestamp) and apply them locally.
    pub async fn pull_from_engine_and_apply<E: SyncEngine + ?Sized>(&mut self, engine: &E, since: Option<DateTime<Utc>>) -> anyhow::Result<()> {
        let res = engine.pull(since).await?;
        for op in res.ops.into_iter() {
            match op.op {
                OpType::Add | OpType::Update => {
                    if let Some(node) = op.payload {
                        self.storage.upsert_node(node).await?;
                    }
                }
                OpType::Delete => {
                    if let Some(node) = op.payload {
                        sqlx::query("DELETE FROM nodes WHERE id = ?").bind(node.id.to_string()).execute(self.storage.pool()).await?;
                    }
                }
            }
        }

        // update server cursor if provided and persist
        if let Some(seq) = res.new_cursor_seq {
            self.server_cursor = Some(seq);
            self.storage.set_server_cursor_seq(self.server_cursor).await?;
        }
        if let Some(cursor_s) = res.new_cursor {
            self.storage.set_server_cursor(Some(&cursor_s)).await?;
        }

        Ok(())
    }

    /// Spawn a background sync worker that periodically pushes local WAL ops and pulls remote ops.
    ///
    /// - `engine` is an Arc-wrapped implementation of `SyncEngine` (e.g., HTTP client)
    /// - `interval` is the tick interval for pushes/pulls
    pub fn spawn_sync_worker(engine: Arc<dyn SyncEngine + Send + Sync>, storage: SqliteStorage, interval: Duration) -> JoinHandle<()> {
        tokio::spawn(async move {
            let mut client = LocalSyncClient::new(storage);
            // attempt to restore persisted sync state; log and continue on error
            if let Err(e) = client.load_persisted_state().await {
                tracing::warn!(error = %e, "failed to load persisted sync state");
            }

            let mut ticker = tokio::time::interval(interval);
            loop {
                ticker.tick().await;
                if let Err(e) = client.push_to_engine(engine.as_ref()).await {
                    tracing::error!(error = %e, "sync push failed");
                }
                if let Err(e) = client.pull_from_engine_and_apply(engine.as_ref(), None).await {
                    tracing::error!(error = %e, "sync pull failed");
                }
            }
        })
    }
}

/// Convenience free function wrapper for spawning a sync worker.
pub fn spawn_sync_worker(engine: Arc<dyn SyncEngine + Send + Sync>, storage: SqliteStorage, interval: Duration) -> JoinHandle<()> {
    LocalSyncClient::spawn_sync_worker(engine, storage, interval)
}
