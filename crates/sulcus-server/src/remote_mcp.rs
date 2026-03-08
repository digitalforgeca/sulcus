use axum::{
    extract::{Query, State, Extension},
    response::sse::{Event, Sse},
    http::StatusCode,
    Json,
};
use dashmap::DashMap;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;
use serde_json::Value;

use sulcus_local::{LocalStorage, McpHandler};
use crate::SharedState;

pub struct McpSession {
    pub tx: mpsc::Sender<Result<Event, Infallible>>,
    pub tenant_id: String,
}

#[derive(Clone)]
pub struct McpManager {
    pub sessions: Arc<DashMap<String, McpSession>>,
    pub embedder: Arc<dyn sulcus_local::embeddings::EmbeddingProvider>,
}

impl std::fmt::Debug for McpManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpManager")
            .field("sessions_count", &self.sessions.len())
            .finish()
    }
}

impl std::fmt::Debug for McpSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpSession")
            .field("tenant_id", &self.tenant_id)
            .finish()
    }
}

impl Default for McpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl McpManager {
    pub fn new() -> Self {
        // We use FastEmbedProvider here so the server can compute embeddings
        let embedder: Arc<dyn sulcus_local::embeddings::EmbeddingProvider> = 
            match sulcus_local::FastEmbedProvider::try_new() {
                Ok(p) => Arc::new(p),
                Err(_) => Arc::new(sulcus_local::MockEmbeddingProvider::new()),
            };
        Self {
            sessions: Arc::new(DashMap::new()),
            embedder,
        }
    }
}

pub async fn sse_handler(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> Sse<ReceiverStream<Result<Event, Infallible>>> {
    let tenant_id = tenant_ctx.id;
    let session_id = Uuid::now_v7().to_string();
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(32);
    
    state.mcp_mgr.sessions.insert(session_id.clone(), McpSession {
        tx: tx.clone(),
        tenant_id: tenant_id.clone(),
    });

    let endpoint_event = Event::default()
        .event("endpoint")
        .data(format!("/api/v1/mcp/message?sessionId={}", session_id));
    let _ = tx.send(Ok(endpoint_event)).await;

    // Keepalive task: sends an SSE comment every 30 s so proxies don't close
    // idle connections.  When the client disconnects the receiver is dropped;
    // the resulting SendError triggers cleanup of the session from the DashMap.
    let sessions = Arc::clone(&state.mcp_mgr.sessions);
    let sid = session_id.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await; // consume the immediate t=0 tick
        loop {
            interval.tick().await;
            if tx.send(Ok(Event::default().comment("keepalive"))).await.is_err() {
                // Receiver dropped → client disconnected; remove session.
                sessions.remove(&sid);
                break;
            }
        }
    });

    Sse::new(ReceiverStream::new(rx))
}

pub async fn message_handler(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Query(params): Query<std::collections::HashMap<String, String>>,
    body: String,
) -> (StatusCode, Json<Value>) {
    let tenant_id = tenant_ctx.id;
    let session_id = match params.get("sessionId") {
        Some(s) => s,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "missing sessionId"}))),
    };

    let session = match state.mcp_mgr.sessions.get(session_id) {
        Some(s) => s,
        None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "session not found"}))),
    };

    if session.tenant_id != tenant_id {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "session tenant mismatch"})));
    }

    let storage = LocalStorage::from_pool(state.pool.clone());
    let handler = McpHandler::new(storage, state.mcp_mgr.embedder.clone(), 20);

    match handler.handle_request(&body).await {
        Ok(resp_str) => {
            let ev = Event::default().event("message").data(resp_str.clone());
            if session.tx.send(Ok(ev)).await.is_err() {
                state.mcp_mgr.sessions.remove(session_id);
            }
            let resp_v: Value = serde_json::from_str(&resp_str).unwrap_or(Value::Null);
            (StatusCode::OK, Json(resp_v))
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e.to_string()}))),
    }
}
