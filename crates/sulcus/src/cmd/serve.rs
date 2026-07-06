//! `sulcus serve` — local REST API server compatible with the cloud protocol.
//!
//! Exposes the same endpoints as `api.sulcus.ca` but backed by the local
//! SQLite storage. Clients can point `SULCUS_BASE_URL=http://localhost:PORT`
//! and use the same client code transparently.

use std::sync::Arc;

use anyhow::Result;
use hyper::{body::Incoming, Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use sulcus_core::backend::StorageBackend;
use sulcus_core::*;
use tokio::net::TcpListener;

/// Shared state for the server.
struct ServerState {
    backend: Arc<dyn StorageBackend>,
}

pub async fn run(backend: Arc<dyn StorageBackend>, host: &str, port: u16) -> Result<()> {
    let addr = format!("{host}:{port}");
    let listener = TcpListener::bind(&addr).await?;

    eprintln!("🧵 sulcus serve listening on http://{addr}");
    eprintln!("   namespace: {}", backend.namespace());
    eprintln!("   Ctrl-C to stop\n");

    let state = Arc::new(ServerState { backend });

    loop {
        let (stream, peer) = listener.accept().await?;
        let state = state.clone();
        let io = TokioIo::new(stream);

        tokio::spawn(async move {
            let svc = hyper::service::service_fn(move |req| {
                let state = state.clone();
                async move { handle_request(req, &state).await }
            });
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, svc)
                .await
            {
                tracing::error!("Connection error from {peer}: {e}");
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async fn handle_request(
    req: Request<Incoming>,
    state: &ServerState,
) -> Result<Response<String>, hyper::Error> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    // Collect body for POST/PATCH/PUT
    let body_bytes = match collect_body(req).await {
        Ok(b) => b,
        Err(_) => return Ok(error_response(StatusCode::BAD_REQUEST, "Failed to read body")),
    };

    let result = route(&method, &path, &body_bytes, state).await;

    match result {
        Ok(value) => Ok(json_response(StatusCode::OK, &value)),
        Err(e) => {
            let msg = format!("{e}");
            let status = if msg.contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            Ok(error_response(status, &msg))
        }
    }
}

async fn route(
    method: &Method,
    path: &str,
    body: &[u8],
    state: &ServerState,
) -> Result<Value> {
    let b = &state.backend;

    // Strip query string for matching; keep raw path for query parsing.
    let (route, query) = path.split_once('?').unwrap_or((path, ""));

    match (method, route) {
        // -- Status ---------------------------------------------------------
        (&Method::GET, "/api/v1/status") => b.status().await,
        (&Method::GET, "/api/v1/agent/memory/status") => b.memory_status().await,

        // -- Nodes CRUD -----------------------------------------------------
        (&Method::POST, "/api/v1/agent/nodes") => {
            let body: Value = parse_json(body)?;
            let params = RememberParams {
                content: str_field(&body, "label")
                    .or_else(|| str_field(&body, "content"))
                    .unwrap_or_default(),
                memory_type: str_field(&body, "memory_type").unwrap_or_else(|| "episodic".into()),
                heat: body.get("heat").and_then(|v| v.as_f64()).map(|h| h * 100.0),
                namespace: str_field(&body, "namespace"),
            };
            b.remember(&params).await
        }

        (&Method::GET, "/api/v1/agent/nodes") => {
            let qs = parse_query(query);
            let params = ListParams {
                page: qs_u32(&qs, "page", 1),
                page_size: qs_u32(&qs, "page_size", 50),
                memory_type: qs_str(&qs, "memory_type"),
                namespace: qs_str(&qs, "namespace"),
                pinned: qs_bool(&qs, "pinned"),
            };
            b.list(&params).await
        }

        (&Method::POST, "/api/v1/agent/search") => {
            let body: Value = parse_json(body)?;
            let params = SearchParams {
                query: str_field(&body, "query").unwrap_or_default(),
                limit: body.get("limit").and_then(|v| v.as_u64()).unwrap_or(5) as u32,
                memory_type: str_field(&body, "memory_type"),
            };
            b.search(&params).await
        }

        (&Method::GET, "/api/v1/agent/hot_nodes") => {
            let qs = parse_query(query);
            let limit = qs_u32(&qs, "limit", 10);
            b.hot_nodes(limit).await
        }

        // Single node operations — extract ID from path
        (&Method::GET, p) if p.starts_with("/api/v1/agent/nodes/") => {
            let id = &p["/api/v1/agent/nodes/".len()..];
            let mem = b.get_memory(id).await?;
            Ok(serde_json::to_value(mem)?)
        }

        (&Method::DELETE, p) if p.starts_with("/api/v1/agent/nodes/") => {
            let id = &p["/api/v1/agent/nodes/".len()..];
            b.forget(id).await
        }

        (&Method::PATCH, p) if p.starts_with("/api/v1/agent/nodes/") => {
            let id = &p["/api/v1/agent/nodes/".len()..];
            let body: Value = parse_json(body)?;
            let params = UpdateParams {
                memory_id: id.to_string(),
                label: str_field(&body, "label"),
                memory_type: str_field(&body, "memory_type"),
                is_pinned: body.get("is_pinned").and_then(|v| v.as_bool()),
                heat: body.get("current_heat").and_then(|v| v.as_f64()).map(|h| h * 100.0),
            };
            b.update(&params).await
        }

        // -- Context --------------------------------------------------------
        (&Method::POST, "/api/v1/agent/context") => {
            let body: Value = parse_json(body)?;
            let query = str_field(&body, "query").unwrap_or_default();
            let budget = body.get("token_budget").and_then(|v| v.as_u64()).unwrap_or(4000) as u32;
            b.build_context(&query, budget).await
        }

        (&Method::POST, "/api/v1/agent/auto-recall") => {
            let body: Value = parse_json(body)?;
            let params = AutoRecallParams {
                query: str_field(&body, "query").unwrap_or_default(),
                token_budget: body.get("token_budget").and_then(|v| v.as_u64()).unwrap_or(4000) as u32,
                graph_hops: body.get("graph_hops").and_then(|v| v.as_bool()).unwrap_or(true),
            };
            b.auto_recall(&params).await
        }

        (&Method::POST, "/api/v1/agent/auto-capture") => {
            let body: Value = parse_json(body)?;
            let text = str_field(&body, "text").unwrap_or_default();
            let source = str_field(&body, "source").unwrap_or_else(|| "serve".into());
            b.auto_capture(&text, &source).await
        }

        // -- Graph ----------------------------------------------------------
        (&Method::POST, "/api/v1/agent/graph/relate") => {
            let body: Value = parse_json(body)?;
            let params = RelateParams {
                source_id: str_field(&body, "source_id").unwrap_or_default(),
                target_id: str_field(&body, "target_id").unwrap_or_default(),
                relation: str_field(&body, "relation").unwrap_or_else(|| "related".into()),
            };
            b.relate(&params).await
        }

        (&Method::GET, p) if p.starts_with("/api/v1/agent/graph/neighbors/") => {
            let id = &p["/api/v1/agent/graph/neighbors/".len()..];
            let qs = parse_query(query);
            let depth = qs_u32(&qs, "depth", 1);
            b.graph_traverse(id, depth).await
        }

        // -- Triggers -------------------------------------------------------
        (&Method::POST, "/api/v1/triggers") => {
            let body: Value = parse_json(body)?;
            let params = CreateTriggerParams {
                event: str_field(&body, "event").unwrap_or_default(),
                action: str_field(&body, "action").unwrap_or_default(),
                name: str_field(&body, "name"),
                filter_memory_type: str_field(&body, "filter_memory_type"),
                filter_namespace: str_field(&body, "filter_namespace"),
                filter_label_pattern: str_field(&body, "filter_label_pattern"),
            };
            b.create_trigger(&params).await
        }

        (&Method::GET, "/api/v1/triggers") => b.list_triggers().await,

        (&Method::DELETE, p) if p.starts_with("/api/v1/triggers/") => {
            let id = &p["/api/v1/triggers/".len()..];
            b.delete_trigger(id).await
        }

        // -- Classification -------------------------------------------------
        (&Method::POST, "/api/v2/siu/label") => {
            let body: Value = parse_json(body)?;
            let text = str_field(&body, "text").unwrap_or_default();
            b.classify(&text).await
        }

        (&Method::POST, "/api/v1/agent/scan-pii") => {
            let body: Value = parse_json(body)?;
            let text = str_field(&body, "text").unwrap_or_default();
            b.scan_pii(&text).await
        }

        // -- Fallback -------------------------------------------------------
        _ => {
            anyhow::bail!("Not found: {} {}", method, path);
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn collect_body(req: Request<Incoming>) -> Result<Vec<u8>> {
    use http_body_util::BodyExt;
    let collected = req.into_body().collect().await
        .map_err(|e| anyhow::anyhow!("Body read error: {e}"))?;
    Ok(collected.to_bytes().to_vec())
}

fn parse_json(body: &[u8]) -> Result<Value> {
    if body.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_slice(body).map_err(|e| anyhow::anyhow!("Invalid JSON: {e}"))
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|s| !s.is_empty())
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next()?.to_string();
            let val = parts.next().unwrap_or("").to_string();
            Some((key, val))
        })
        .collect()
}

fn qs_str(qs: &[(String, String)], key: &str) -> Option<String> {
    qs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
}

fn qs_u32(qs: &[(String, String)], key: &str, default: u32) -> u32 {
    qs_str(qs, key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn qs_bool(qs: &[(String, String)], key: &str) -> Option<bool> {
    qs_str(qs, key).map(|v| v == "true" || v == "1")
}

fn json_response(status: StatusCode, value: &Value) -> Response<String> {
    let body = serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string());
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        .header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        .body(body)
        .unwrap()
}

fn error_response(status: StatusCode, message: &str) -> Response<String> {
    json_response(status, &json!({ "error": message }))
}
