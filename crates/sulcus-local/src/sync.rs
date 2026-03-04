use chrono::{DateTime, Utc};

use sulcus_core::graph::Node;
use sulcus_core::sync::{MemoryOp, OpType, SyncEngine};
use sulcus_core::StorageBackend;

use crate::LocalStorage;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use uuid::Uuid;

/// Client that pushes local `memory_ops` to a `SyncEngine` and pulls remote
/// ops to apply them locally.
pub struct LocalSyncClient {
    storage: LocalStorage,
    server_cursor: Option<String>,
    server_cursor_seq: Option<i64>,
    last_seq: Option<i64>,
}

impl LocalSyncClient {
    pub fn new(storage: LocalStorage) -> Self {
        Self {
            storage,
            server_cursor: None,
            server_cursor_seq: None,
            last_seq: None,
        }
    }

    pub fn server_cursor_seq(&self) -> Option<i64> {
        self.server_cursor_seq
    }
    pub fn last_seq(&self) -> Option<i64> {
        self.last_seq
    }

    pub async fn load_persisted_state(&mut self) -> anyhow::Result<()> {
        self.server_cursor = self.storage.get_server_cursor().await?;
        self.server_cursor_seq = self.storage.get_server_cursor_seq().await?;
        self.last_seq = self.storage.get_last_seq().await?;
        Ok(())
    }

    /// Push all pending local ops to the engine.
    /// Idempotent: the engine is responsible for deduplicating ops it has already seen.
    pub async fn push_to_engine(&mut self, engine: &dyn SyncEngine) -> anyhow::Result<()> {
        let ops = self.gather_pending_ops().await?;
        if ops.is_empty() {
            return Ok(());
        }

        let (seqs, mem_ops): (Vec<i64>, Vec<MemoryOp>) = ops.into_iter().unzip();
        let res = engine.push(mem_ops).await?;

        // Update local high-water mark
        if let Some(s) = seqs.last() {
            self.last_seq = Some(*s);
            self.storage.set_last_seq(self.last_seq).await?;
        }
        if let Some(c) = res.new_cursor {
            self.server_cursor = Some(c);
            self.storage.set_server_cursor(self.server_cursor.as_deref()).await?;
        }
        if let Some(s) = res.new_cursor_seq {
            self.server_cursor_seq = Some(s);
            self.storage.set_server_cursor_seq(self.server_cursor_seq).await?;
        }

        Ok(())
    }

    async fn gather_pending_ops(&self) -> anyhow::Result<Vec<(i64, MemoryOp)>> {
        let rows = self.storage.list_memory_ops_internal().await?;
        let mut out = Vec::new();

        for (seq, op_type_str, payload) in rows {
            let op = match op_type_str.to_uppercase().as_str() {
                "ADD" => OpType::Add,
                "UPDATE" => OpType::Update,
                "DELETE" => OpType::Delete,
                "PATCH" => OpType::Patch,
                _ => continue,
            };

            let id_str = payload.get("id").or_else(|| payload.get("node_id")).and_then(|v| v.as_str()).unwrap_or("");
            let id = Uuid::parse_str(id_str).unwrap_or_default();

            let (node, patch) = if op == OpType::Patch {
                let p: sulcus_core::crdt::NodePatch = serde_json::from_value(payload.clone()).unwrap_or_else(|_| sulcus_core::crdt::NodePatch::new(id));
                (None, Some(p))
            } else {
                let node = Node {
                    id,
                    label: payload
                        .get("label")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    pointer_summary: payload
                        .get("pointer_summary")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    base_utility: payload
                        .get("base_utility")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0) as f32,
                    current_heat: payload
                        .get("current_heat")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0) as f32,
                    is_pinned: payload
                        .get("is_pinned")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                    memory_type: payload
                        .get("memory_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("episodic")
                        .to_string(),
                };
                (Some(node), None)
            };

            let raw_content = payload
                .get("raw_content")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let vector = self.storage.get_node_embedding(id).await.unwrap_or(None);
            let mem_op = MemoryOp {
                op,
                payload: node,
                patch,
                raw_content,
                vector,
                timestamp: Utc::now(),
            };
            out.push((seq, mem_op));
        }
        Ok(out)
    }

    /// Pull remote ops and apply them locally.
    pub async fn pull_from_engine_and_apply(
        &mut self,
        engine: &dyn SyncEngine,
        since: Option<DateTime<Utc>>,
    ) -> anyhow::Result<()> {
        let res = engine.pull(since).await?;
        for op in res.ops {
            match op.op {
                OpType::Add | OpType::Update => {
                    if let Some(node) = op.payload {
                        if let Some(raw) = op.raw_content {
                            let mut tx = self.storage.pool().begin().await?;

                            let upsert_nodes_sql = r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, created_at)
                                 VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
                                 ON CONFLICT(id) DO UPDATE SET label = EXCLUDED.label, pointer_summary = EXCLUDED.pointer_summary, base_utility = EXCLUDED.base_utility, current_heat = EXCLUDED.current_heat, is_pinned = EXCLUDED.is_pinned, memory_type = EXCLUDED.memory_type"#;
                            sqlx::query(upsert_nodes_sql)
                                .bind(node.id.to_string())
                                .bind(node.label.clone())
                                .bind(node.pointer_summary.clone())
                                .bind(node.base_utility)
                                .bind(node.current_heat)
                                .bind(node.is_pinned)
                                .bind(node.memory_type.clone())
                                .execute(&mut *tx)
                                .await?;

                            if let Some(v) = op.vector {
                                let emb_sql = format!("[{}]", v.iter().map(|val| val.to_string()).collect::<Vec<_>>().join(","));
                                let res = sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2::vector) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                                    .bind(node.id.to_string())
                                    .bind(&emb_sql)
                                    .execute(&mut *tx)
                                    .await;
                                
                                if res.is_err() {
                                    // Fallback to BYTEA blob
                                    let bytes: Vec<u8> = v.iter().flat_map(|f| f.to_le_bytes()).collect();
                                    sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
                                        .bind(node.id.to_string())
                                        .bind(bytes)
                                        .execute(&mut *tx)
                                        .await?;
                                }
                            }

                            let insert_payload_sql = "INSERT INTO payloads (node_id, raw_content) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET raw_content = EXCLUDED.raw_content";
                            sqlx::query(insert_payload_sql)
                                .bind(node.id.to_string())
                                .bind(raw)
                                .execute(&mut *tx)
                                .await?;

                            tx.commit().await?;
                        } else {
                            // fallback: simple upsert when there's no payload/territory
                            let nid = node.id;
                            self.storage.upsert_node_internal(node).await?;
                            if let Some(v) = op.vector {
                                self.storage.store_node_embedding(nid, v).await?;
                            }
                        }
                    }
                }
                OpType::Patch => {
                    if let Some(patch) = op.patch {
                        if let Some(mut existing) = self.storage.get_node_internal(patch.node_id).await?
                        {
                            let mut clocks = self.storage.get_crdt_clocks(patch.node_id).await?;
                            if patch.apply_to_with_clocks(&mut existing, &mut clocks) {
                                // ensure atomicity of patch apply
                                let mut tx = self.storage.pool().begin().await?;
                                let label = existing.label.clone();
                                let pointer_summary = existing.pointer_summary.clone();
                                let base_utility = existing.base_utility;
                                let current_heat = existing.current_heat;
                                let is_pinned = existing.is_pinned;
                                let memory_type = existing.memory_type.clone();
                                let id_s = existing.id.to_string();

                                sqlx::query(r#"
            INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT(id) DO UPDATE SET
                label = EXCLUDED.label,
                pointer_summary = EXCLUDED.pointer_summary,
                base_utility = EXCLUDED.base_utility,
                current_heat = EXCLUDED.current_heat,
                is_pinned = EXCLUDED.is_pinned,
                memory_type = EXCLUDED.memory_type"#)
                                    .bind(&id_s)
                                    .bind(&label)
                                    .bind(&pointer_summary)
                                    .bind(base_utility)
                                    .bind(current_heat)
                                    .bind(is_pinned)
                                    .bind(&memory_type)
                                    .execute(&mut *tx)
                                    .await?;

                                let clocks_val = serde_json::to_value(&clocks).unwrap_or(serde_json::Value::Null);
                                sqlx::query("UPDATE nodes SET crdt_clocks = $1 WHERE id = $2")
                                    .bind(clocks_val)
                                    .bind(&id_s)
                                    .execute(&mut *tx)
                                    .await?;
                                tx.commit().await?;

                                // refresh the mmap if this node is in the active index
                                if self.storage.is_node_active(&existing.id).await? {
                                     let nodes = self.storage.list_hot_nodes(100).await?;
                                     let pointers: Vec<_> = nodes.into_iter().map(|n| sulcus_core::NodePointer {
                                         id_bytes: *n.id.as_bytes(),
                                         heat: n.current_heat,
                                         label: n.label,
                                         summary: n.pointer_summary,
                                         is_tombstone: false,
                                         address: String::new(),
                                     }).collect();
                                     self.storage.write_shared_index(&pointers);
                                }
                            }
                        }
                    }
                }
                OpType::Delete => {
                    if let Some(node) = op.payload {
                        let is_active = self.storage.is_node_active(&node.id).await.unwrap_or(false);
                        
                        let mut tx = self.storage.pool().begin().await?;
                        let id_s = node.id.to_string();
                        sqlx::query("DELETE FROM embeddings WHERE node_id = $1")
                            .bind(&id_s)
                            .execute(&mut *tx)
                            .await?;
                        sqlx::query("DELETE FROM payloads WHERE node_id = $1")
                            .bind(&id_s)
                            .execute(&mut *tx)
                            .await?;
                        sqlx::query("DELETE FROM nodes WHERE id = $1")
                            .bind(&id_s)
                            .execute(&mut *tx)
                            .await?;
                        tx.commit().await?;

                        // refresh the mmap if this node was in the active index
                        if is_active {
                             let nodes = self.storage.list_hot_nodes(100).await?;
                             let pointers: Vec<_> = nodes.into_iter().map(|n| sulcus_core::NodePointer {
                                 id_bytes: *n.id.as_bytes(),
                                 heat: n.current_heat,
                                 label: n.label,
                                 summary: n.pointer_summary,
                                 is_tombstone: false,
                                 address: String::new(),
                             }).collect();
                             self.storage.write_shared_index(&pointers);
                        }
                    }
                }
            }
        }

        if let Some(c) = res.new_cursor {
            self.server_cursor = Some(c);
            self.storage.set_server_cursor(self.server_cursor.as_deref()).await?;
        }
        if let Some(s) = res.new_cursor_seq {
            self.server_cursor_seq = Some(s);
            self.storage.set_server_cursor_seq(self.server_cursor_seq).await?;
        }

        Ok(())
    }

    /// Run a background sync loop.
    pub fn spawn_sync_worker(
        engine: Arc<dyn SyncEngine + Send + Sync>,
        storage: LocalStorage,
        interval: Duration,
    ) -> JoinHandle<()> {
        tokio::spawn(async move {
            let mut client = LocalSyncClient::new(storage);
            let _ = client.load_persisted_state().await;

            loop {
                // Pull first to get remote changes
                if let Err(e) = client.pull_from_engine_and_apply(&*engine, None).await {
                    eprintln!("sync pull failed: {:?}", e);
                }

                // Push local changes
                if let Err(e) = client.push_to_engine(&*engine).await {
                    eprintln!("sync push failed: {:?}", e);
                }

                tokio::time::sleep(interval).await;
            }
        })
    }
}

/// Convenience for spawning a sync worker.
pub fn spawn_sync_worker(
    engine: Arc<dyn SyncEngine + Send + Sync>,
    storage: LocalStorage,
    interval: Duration,
) -> JoinHandle<()> {
    LocalSyncClient::spawn_sync_worker(engine, storage, interval)
}

/// Read server config from `sulcus.ini` and start a background sync loop.
pub fn spawn_auto_sync_worker(storage: LocalStorage) -> Option<JoinHandle<()>> {
    let config = crate::config::Config::load();

    // Config file takes priority; fall back to env vars.
    let server_url = config
        .server_url
        .or_else(|| std::env::var("SULCUS_SERVER_URL").ok())?;

    let api_key = config
        .server_api_key
        .or_else(|| std::env::var("SULCUS_API_KEY").ok());

    let interval_secs = config
        .sync_interval_secs
        .or_else(|| {
            std::env::var("SULCUS_SYNC_INTERVAL_MS")
                .ok()
                .and_then(|s| s.parse::<u64>().ok())
                .map(|ms| ms / 1000)
        })
        .unwrap_or(300); // 5 minutes

    let interval = Duration::from_secs(interval_secs);
    let engine = Arc::new(crate::sync_http::HttpSyncEngine::new(server_url, api_key));

    tracing::info!("auto-sync worker starting (interval: {}s)", interval_secs);
    Some(LocalSyncClient::spawn_sync_worker(engine, storage, interval))
}
