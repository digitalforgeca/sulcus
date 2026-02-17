use anyhow::Context;
use chrono::{DateTime, Utc};
use sqlx::Row;

use sulcus_core::graph::Node;
use sulcus_core::sync::{MemoryOp, OpType, SyncEngine};
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
        Self {
            storage,
            last_seq: None,
            server_cursor: None,
        }
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
    pub async fn gather_pending_ops(
        &self,
        since_seq: Option<i64>,
    ) -> anyhow::Result<Vec<(i64, MemoryOp)>> {
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

            let payload = if let Some(ref s) = payload_s {
                // payload is a JSON object representing Node (id, summary, heat)
                let v: serde_json::Value =
                    serde_json::from_str(s).context("invalid payload json")?;
                // map to Node struct if possible
                if let Ok(node) = serde_json::from_value::<Node>(v.clone()) {
                    Some(node)
                } else {
                    // try minimal / backward-compatible mapping from legacy payload shapes
                    let id_s = v
                        .get("id")
                        .and_then(|x| x.as_str())
                        .ok_or_else(|| anyhow::anyhow!("payload missing id"))?;
                    let id = uuid::Uuid::parse_str(id_s)?;

                    // pointer_summary may be stored under `pointer_summary` or legacy `summary`
                    let pointer_summary = v
                        .get("pointer_summary")
                        .and_then(|x| x.as_str())
                        .or_else(|| v.get("summary").and_then(|x| x.as_str()))
                        .unwrap_or_default()
                        .to_string();

                    // current_heat may be stored under `current_heat` or legacy `heat`
                    let current_heat = v
                        .get("current_heat")
                        .and_then(|x| x.as_f64())
                        .or_else(|| v.get("heat").and_then(|x| x.as_f64()))
                        .unwrap_or(0.0) as f32;

                    // label may be present, else derive a short label from pointer_summary
                    let label = v
                        .get("label")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| {
                            pointer_summary
                                .split_whitespace()
                                .next()
                                .unwrap_or("")
                                .to_string()
                        });

                    let base_utility = v
                        .get("base_utility")
                        .and_then(|x| x.as_f64())
                        .unwrap_or(0.0) as f32;
                    let is_pinned = v
                        .get("is_pinned")
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false);

                    Some(Node {
                        id,
                        label,
                        pointer_summary,
                        base_utility,
                        current_heat,
                        is_pinned,
                    })
                }
            } else {
                None
            };

            // extract optional raw_content (territory) when present in the WAL payload JSON
            let raw_content = if let Some(s) = &payload_s {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
                    v.get("raw_content").and_then(|r| r.as_str()).map(|s| s.to_string())
                } else {
                    None
                }
            } else {
                None
            };

            out.push((
                seq_id,
                MemoryOp {
                    op,
                    payload,
                    raw_content,
                    timestamp,
                },
            ));
        }

        Ok(out)
    }

    /// Push pending ops to a remote `SyncEngine` implementation and update `last_seq`.
    pub async fn push_to_engine<E: SyncEngine + ?Sized>(
        &mut self,
        engine: &E,
    ) -> anyhow::Result<()> {
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
            self.storage
                .set_server_cursor_seq(self.server_cursor)
                .await?;
        }
        if let Some(cursor_s) = res.new_cursor {
            self.storage.set_server_cursor(Some(&cursor_s)).await?;
        }

        Ok(())
    }

    /// Pull ops from remote `SyncEngine` (since timestamp) and apply them locally.
    pub async fn pull_from_engine_and_apply<E: SyncEngine + ?Sized>(
        &mut self,
        engine: &E,
        since: Option<DateTime<Utc>>,
    ) -> anyhow::Result<()> {
        eprintln!("pull_from_engine_and_apply: calling engine.pull");
        let res = engine.pull(since).await?;
        eprintln!("pull_from_engine_and_apply: got {} ops", res.ops.len());
        for op in res.ops.into_iter() {
            match op.op {
                OpType::Add | OpType::Update => {
                    if let Some(node) = op.payload {
                        eprintln!("applying remote node: id={}", node.id);
                        // debug: print node JSON for diagnosis
                        eprintln!(
                            "remote node payload: {}",
                            serde_json::to_string(&node).unwrap_or_default()
                        );

                        // If the incoming op includes `raw_content` (the territory), perform an
                        // atomic insert: nodes first, then payloads (foreign key requires order).
                        if let Some(raw) = op.raw_content {
                            let mut tx = self.storage.pool().begin().await?;

                            let upsert_nodes_sql = r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, created_at)
                                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                                 ON CONFLICT(id) DO UPDATE SET label = excluded.label, pointer_summary = excluded.pointer_summary, base_utility = excluded.base_utility, current_heat = excluded.current_heat, is_pinned = excluded.is_pinned"#;
                            eprintln!("SYNC TX: executing nodes upsert SQL");
                            if let Err(e) = sqlx::query(upsert_nodes_sql)
                                .bind(node.id.to_string())
                                .bind(node.label.clone())
                                .bind(node.pointer_summary.clone())
                                .bind(node.base_utility)
                                .bind(node.current_heat)
                                .bind(node.is_pinned as i64)
                                .execute(&mut *tx)
                                .await
                            {
                                eprintln!("SYNC TX: nodes upsert failed: {:?}", e);
                                return Err(e.into());
                            }

                            let insert_payload_sql = "INSERT INTO payloads (node_id, raw_content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET raw_content = excluded.raw_content";
                            eprintln!("SYNC TX: executing payload insert SQL");
                            if let Err(e) = sqlx::query(insert_payload_sql)
                                .bind(node.id.to_string())
                                .bind(raw)
                                .execute(&mut *tx)
                                .await
                            {
                                eprintln!("SYNC TX: payload insert failed: {:?}", e);
                                return Err(e.into());
                            }

                            if let Err(e) = tx.commit().await {
                                eprintln!("SYNC TX: commit failed: {:?}", e);
                                return Err(e.into());
                            }
                            eprintln!("SYNC TX: committed node+payload for id={}", node.id);
                        } else {
                            // fallback: simple upsert when there's no payload/territory
                            let nid = node.id.to_string();
                            if let Err(e) = self.storage.upsert_node(node).await {
                                eprintln!("upsert_node failed for node.id={}: {:?}", nid, e);
                                return Err(e);
                            }
                        }
                    }
                }
                OpType::Delete => {
                    if let Some(node) = op.payload {
                        sqlx::query("DELETE FROM nodes WHERE id = ?")
                            .bind(node.id.to_string())
                            .execute(self.storage.pool())
                            .await?;
                    }
                }
            }
        }

        // update server cursor if provided and persist
        if let Some(seq) = res.new_cursor_seq {
            self.server_cursor = Some(seq);
            self.storage
                .set_server_cursor_seq(self.server_cursor)
                .await?;
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
    pub fn spawn_sync_worker(
        engine: Arc<dyn SyncEngine + Send + Sync>,
        storage: SqliteStorage,
        interval: Duration,
    ) -> JoinHandle<()> {
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
                if let Err(e) = client
                    .pull_from_engine_and_apply(engine.as_ref(), None)
                    .await
                {
                    tracing::error!(error = %e, "sync pull failed");
                }
            }
        })
    }
}

/// Convenience free function wrapper for spawning a sync worker.
pub fn spawn_sync_worker(
    engine: Arc<dyn SyncEngine + Send + Sync>,
    storage: SqliteStorage,
    interval: Duration,
) -> JoinHandle<()> {
    LocalSyncClient::spawn_sync_worker(engine, storage, interval)
}
