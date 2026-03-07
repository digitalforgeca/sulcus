use std::net::UdpSocket;
use std::sync::Arc;
use std::time::Duration;
use tokio::time;
use crate::LocalStorage;
use serde::{Serialize, Deserialize};
use uuid::Uuid;
use sqlx::Row;

#[derive(Serialize, Deserialize, Debug)]
struct DiscoveryPacket {
    peer_id: String,
    mcp_port: u16,
}

pub async fn start_discovery_worker(storage: LocalStorage, mcp_port: u16) {
    let peer_id = match storage.get_or_create_client_id().await {
        Ok(id) => Uuid::from_bytes([id[0], id[1], id[2], id[3], id[4], id[5], id[6], id[7], 0, 0, 0, 0, 0, 0, 0, 0]).to_string(),
        Err(_) => Uuid::new_v4().to_string(),
    };

    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => {
            s.set_broadcast(true).ok();
            s.set_nonblocking(true).ok();
            Arc::new(s)
        }
        Err(e) => {
            tracing::error!("failed to bind discovery socket: {}", e);
            return;
        }
    };

    let listen_socket = socket.clone();
    let storage_clone = storage.clone();
    let peer_id_clone = peer_id.clone();

    // Listener task
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        loop {
            match listen_socket.recv_from(&mut buf) {
                Ok((len, addr)) => {
                    if let Ok(packet) = serde_json::from_slice::<DiscoveryPacket>(&buf[..len]) {
                        if packet.peer_id != peer_id_clone {
                            let peer_addr = format!("{}:{}", addr.ip(), packet.mcp_port);
                            let _ = sqlx::query("INSERT INTO peers (peer_id, address, last_seen_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT(peer_id) DO UPDATE SET address = EXCLUDED.address, last_seen_at = CURRENT_TIMESTAMP")
                                .bind(&packet.peer_id)
                                .bind(&peer_addr)
                                .execute(storage_clone.pool())
                                .await;
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    time::sleep(Duration::from_millis(100)).await;
                }
                Err(e) => {
                    tracing::error!("discovery socket recv error: {}", e);
                    break;
                }
            }
        }
    });

    // Broadcaster task
    let broadcast_addr = "255.255.255.255:4204"; // Default SULCUS discovery port
    let packet = DiscoveryPacket {
        peer_id,
        mcp_port,
    };
    let payload = serde_json::to_vec(&packet).unwrap_or_default();

    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            if let Err(e) = socket.send_to(&payload, broadcast_addr) {
                tracing::debug!("discovery broadcast failed: {}", e);
            }
        }
    });
}

pub async fn start_p2p_sync_worker(storage: LocalStorage) {
    let storage_clone = storage.clone();
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(60)); // Sync every minute
        let client = reqwest::Client::new();

        loop {
            interval.tick().await;

            let peers = match sqlx::query("SELECT peer_id, address FROM peers WHERE last_seen_at > datetime('now', '-5 minutes')")
                .fetch_all(storage_clone.pool())
                .await {
                    Ok(p) => p,
                    Err(_) => continue,
                };

            for peer in peers {
                let peer_id: String = peer.get("peer_id");
                let address: String = peer.get("address");

                // Get pending local ops
                let pending = storage_clone.list_memory_ops_internal().await.unwrap_or_default();
                let mut out_ops = Vec::new();
                for (_seq, _op_type_str, p_val) in pending {
                    if let Ok(op) = serde_json::from_value::<sulcus_core::sync::MemoryOp>(p_val) {
                        out_ops.push(op);
                    }
                }

                let sync_url = format!("http://{}/api/v1/agent/sync", address);
                let payload = serde_json::json!({
                    "ops": out_ops,
                    "peer_id": peer_id
                });

                match client.post(&sync_url).json(&payload).send().await {
                    Ok(resp) => {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if let Some(new_ops_val) = json.get("new_ops") {
                                if let Ok(new_ops) = serde_json::from_value::<Vec<sulcus_core::sync::MemoryOp>>(new_ops_val.clone()) {
                                    if !new_ops.is_empty() {
                                        let mut sync_client = crate::LocalSyncClient::new(storage_clone.clone());
                                        struct PayloadEngine(Vec<sulcus_core::sync::MemoryOp>);
                                        #[async_trait::async_trait]
                                        impl sulcus_core::sync::SyncEngine for PayloadEngine {
                                            async fn push(&self, _ops: Vec<sulcus_core::sync::MemoryOp>) -> anyhow::Result<sulcus_core::sync::SyncPushResult> { Ok(sulcus_core::sync::SyncPushResult { new_cursor: None, new_cursor_seq: None }) }
                                            async fn pull(&self, _since: Option<chrono::DateTime<chrono::Utc>>) -> anyhow::Result<sulcus_core::sync::SyncPullResult> { Ok(sulcus_core::sync::SyncPullResult { ops: self.0.clone(), new_cursor: None, new_cursor_seq: None }) }
                                        }
                                        let _ = sync_client.pull_from_engine_and_apply(&PayloadEngine(new_ops), None).await;
                                    }
                                }
                            }
                            let _ = sqlx::query("UPDATE peers SET last_sync_at = CURRENT_TIMESTAMP, sync_status = 'synced' WHERE peer_id = $1")
                                .bind(&peer_id)
                                .execute(storage_clone.pool())
                                .await;
                        }
                    }
                    Err(e) => {
                        tracing::debug!("p2p sync with {} failed: {}", address, e);
                        let _ = sqlx::query("UPDATE peers SET sync_status = 'failed' WHERE peer_id = $1")
                            .bind(&peer_id)
                            .execute(storage_clone.pool())
                            .await;
                    }
                }
            }
        }
    });
}

