use axum::{
    extract::{Extension, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    Json,
};
use dashmap::DashMap;
use serde_json::Value;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::SharedState;
use sulcus_local::{LocalStorage, McpHandler};

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
        // Try to initialize FastEmbed in a separate thread with panic guard.
        // ORT 2.x panics when libonnxruntime.so is missing instead of returning Err.
        sulcus_local::embeddings::ensure_onnx_runtime_env();
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = std::thread::Builder::new()
            .name("mcp-embed-init".to_string())
            .spawn(move || {
                let _ = tx.send(std::panic::catch_unwind(
                    sulcus_local::FastEmbedProvider::try_new,
                ));
            });
        let embedder: Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
            match rx.recv_timeout(std::time::Duration::from_secs(30)) {
                Ok(Ok(Ok(p))) => {
                    tracing::info!("MCP embedder initialized (FastEmbed)");
                    Arc::new(p)
                }
                _ => {
                    tracing::warn!("MCP embedder fallback to mock (FastEmbed/ORT unavailable)");
                    Arc::new(sulcus_local::MockEmbeddingProvider::new())
                }
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

    state.mcp_mgr.sessions.insert(
        session_id.clone(),
        McpSession {
            tx: tx.clone(),
            tenant_id: tenant_id.clone(),
        },
    );

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
            if tx
                .send(Ok(Event::default().comment("keepalive")))
                .await
                .is_err()
            {
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
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "missing sessionId"})),
            )
        }
    };

    let session = match state.mcp_mgr.sessions.get(session_id) {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "session not found"})),
            )
        }
    };

    if session.tenant_id != tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "session tenant mismatch"})),
        );
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
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

// ---------------------------------------------------------------------------
// Streamable HTTP Transport (MCP 2025-06-18)
// Single endpoint: POST for JSON-RPC requests, GET for SSE notification stream
// ---------------------------------------------------------------------------

/// POST /mcp — Streamable HTTP: receive JSON-RPC request, return JSON response
pub async fn streamable_post(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    headers: HeaderMap,
    body: String,
) -> Response {
    let tenant_id = tenant_ctx.id;

    // Parse session ID from Mcp-Session-Id header (optional on first request)
    let session_id = headers
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::now_v7().to_string());

    // Ensure session exists
    if !state.mcp_mgr.sessions.contains_key(&session_id) {
        let (tx, _rx) = mpsc::channel::<Result<Event, Infallible>>(4);
        state.mcp_mgr.sessions.insert(
            session_id.clone(),
            McpSession {
                tx,
                tenant_id: tenant_id.clone(),
            },
        );
    }

    // Check tenant match
    if let Some(sess) = state.mcp_mgr.sessions.get(&session_id) {
        if sess.tenant_id != tenant_id {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "session tenant mismatch"})),
            )
                .into_response();
        }
    }

    // Parse JSON-RPC to detect notifications/responses vs requests
    let parsed: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"jsonrpc": "2.0", "error": {"code": -32700, "message": format!("Parse error: {e}")}})),
            )
                .into_response();
        }
    };

    // If it's a notification or response (no "method" or has no "id"), accept with 202
    let is_request = parsed.get("method").is_some() && parsed.get("id").is_some();
    if !is_request {
        return (StatusCode::ACCEPTED, "").into_response();
    }

    // Process as request
    let storage = LocalStorage::from_pool(state.pool.clone());
    let handler = McpHandler::new(storage, state.mcp_mgr.embedder.clone(), 20);

    match handler.handle_request(&body).await {
        Ok(resp_str) => axum::http::Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "application/json")
            .header("Mcp-Session-Id", &session_id)
            .body(axum::body::Body::from(resp_str))
            .unwrap(),
        Err(e) => {
            let err_resp = serde_json::json!({
                "jsonrpc": "2.0",
                "error": {"code": -32603, "message": e.to_string()},
                "id": parsed.get("id").cloned().unwrap_or(Value::Null)
            });
            (StatusCode::INTERNAL_SERVER_ERROR, Json(err_resp)).into_response()
        }
    }
}

/// GET /mcp — Streamable HTTP: SSE stream for server-to-client notifications
pub async fn streamable_get(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    headers: HeaderMap,
) -> Response {
    let tenant_id = tenant_ctx.id;
    let session_id = headers
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::now_v7().to_string());

    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(32);

    state.mcp_mgr.sessions.insert(
        session_id.clone(),
        McpSession {
            tx: tx.clone(),
            tenant_id,
        },
    );

    // Keepalive
    let sessions = Arc::clone(&state.mcp_mgr.sessions);
    let sid = session_id.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await;
        loop {
            interval.tick().await;
            if tx
                .send(Ok(Event::default().comment("keepalive")))
                .await
                .is_err()
            {
                sessions.remove(&sid);
                break;
            }
        }
    });

    let sse = Sse::new(ReceiverStream::new(rx));

    let mut resp = sse.into_response();
    resp.headers_mut().insert(
        "Mcp-Session-Id",
        session_id
            .parse()
            .unwrap_or_else(|_| HeaderValue::from_static("")),
    );
    resp
}

/// DELETE /mcp — terminate session
pub async fn streamable_delete(State(state): State<SharedState>, headers: HeaderMap) -> StatusCode {
    if let Some(sid) = headers.get("mcp-session-id").and_then(|v| v.to_str().ok()) {
        state.mcp_mgr.sessions.remove(sid);
    }
    StatusCode::NO_CONTENT
}
