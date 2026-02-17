use chrono::Utc;
use reqwest::StatusCode;
use serde_json::json;
use std::sync::Arc;

use rand::Rng;
use sulcus_core::sync::{MemoryOp, SyncEngine};

/// Simple HTTP-based SyncEngine client for `/api/v1/agent/sync`.
#[derive(Clone)]
pub struct HttpSyncEngine {
    client: reqwest::Client,
    base_url: String,
    api_key: Option<String>,
    max_retries: usize,
    backoff_base_ms: u64,
}

impl HttpSyncEngine {
    pub fn new(base_url: impl Into<String>, api_key: Option<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.into(),
            api_key,
            max_retries: 3,
            backoff_base_ms: 200,
        }
    }

    fn url(&self) -> String {
        format!("{}/api/v1/agent/sync", self.base_url.trim_end_matches('/'))
    }

    async fn send_with_retry(
        &self,
        mut req: reqwest::RequestBuilder,
    ) -> anyhow::Result<reqwest::Response> {
        let mut last_err: Option<anyhow::Error> = None;
        for attempt in 0..=self.max_retries {
            let r = req.try_clone().expect("request clone").send().await;
            match r {
                Ok(resp) => {
                    if resp.status().is_server_error() {
                        last_err = Some(anyhow::anyhow!("server error: {}", resp.status()));
                    } else {
                        return Ok(resp);
                    }
                }
                Err(e) => {
                    last_err = Some(anyhow::anyhow!(e));
                }
            }

            // backoff
            if attempt < self.max_retries {
                let backoff = self
                    .backoff_base_ms
                    .saturating_mul(2u64.pow(attempt as u32));
                let jitter = rand::random::<u64>() % (backoff / 2 + 1);
                tokio::time::sleep(std::time::Duration::from_millis(backoff + jitter)).await;
            }
        }
        Err(last_err.unwrap_or_else(|| anyhow::anyhow!("unknown error")))
    }
}

#[async_trait::async_trait]
impl SyncEngine for HttpSyncEngine {
    async fn push(&self, ops: Vec<MemoryOp>) -> anyhow::Result<sulcus_core::sync::SyncPushResult> {
        let body = json!({ "ops": ops, "last_cursor": null });
        let mut req = self.client.post(self.url()).json(&body);
        if let Some(k) = &self.api_key {
            req = req.bearer_auth(k);
        }
        let resp = self.send_with_retry(req).await?;
        if resp.status() != StatusCode::OK {
            return Err(anyhow::anyhow!("sync push failed: {}", resp.status()));
        }
        let j: serde_json::Value = resp.json().await?;
        let new_cursor = j
            .get("new_cursor")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let new_cursor_seq = j.get("new_cursor_seq").and_then(|v| v.as_i64());
        Ok(sulcus_core::sync::SyncPushResult {
            new_cursor,
            new_cursor_seq,
        })
    }

    async fn pull(
        &self,
        since: Option<chrono::DateTime<chrono::Utc>>,
    ) -> anyhow::Result<sulcus_core::sync::SyncPullResult> {
        let cursor = since.map(|s| s.to_rfc3339());
        let body = json!({ "ops": [], "last_cursor": cursor });
        let mut req = self.client.post(self.url()).json(&body);
        if let Some(k) = &self.api_key {
            req = req.bearer_auth(k);
        }
        let resp = self.send_with_retry(req).await?;
        if resp.status() != StatusCode::OK {
            return Err(anyhow::anyhow!("sync pull failed: {}", resp.status()));
        }
        let j: serde_json::Value = resp.json().await?;
        let new_ops = j.get("new_ops").cloned().unwrap_or_default();
        eprintln!("http sync new_ops: {}", new_ops);
        let ops: Vec<MemoryOp> = serde_json::from_value(new_ops)?;
        let new_cursor = j
            .get("new_cursor")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let new_cursor_seq = j.get("new_cursor_seq").and_then(|v| v.as_i64());
        Ok(sulcus_core::sync::SyncPullResult {
            ops,
            new_cursor,
            new_cursor_seq,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hyper::service::{make_service_fn, service_fn};
    use hyper::{Body, Method, Request, Response, Server, StatusCode};
    use serde_json::Value;
    use std::net::SocketAddr;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn http_sync_engine_push_and_pull_roundtrip() -> anyhow::Result<()> {
        let received: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let rcv = received.clone();

        let make_svc = make_service_fn(move |_conn| {
            let rcv = rcv.clone();
            async move {
                Ok::<_, hyper::Error>(service_fn(move |req: Request<Body>| {
                    let rcv = rcv.clone();
                    async move {
                        if req.method() == Method::POST && req.uri().path() == "/api/v1/agent/sync"
                        {
                            let bytes = hyper::body::to_bytes(req.into_body()).await?;
                            let v: Value = serde_json::from_slice(&bytes).unwrap_or(json!({}));
                            rcv.lock().await.push(v);
                            let resp = json!({ "new_ops": [], "new_cursor": chrono::Utc::now().to_rfc3339(), "new_cursor_seq": 1 });
                            Ok::<_, hyper::Error>(
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header("content-type", "application/json")
                                    .body(Body::from(resp.to_string()))
                                    .unwrap(),
                            )
                        } else {
                            Ok::<_, hyper::Error>(
                                Response::builder()
                                    .status(StatusCode::NOT_FOUND)
                                    .body(Body::empty())
                                    .unwrap(),
                            )
                        }
                    }
                }))
            }
        });

        let server = Server::bind(&SocketAddr::from(([127, 0, 0, 1], 0))).serve(make_svc);
        let local_addr = server.local_addr();
        let _jh = tokio::spawn(server);

        let engine = HttpSyncEngine::new(format!("http://{}", local_addr), None);

        // push
        let push_res = engine.push(vec![]).await?;
        assert!(push_res.new_cursor.is_some());
        // pull
        let pull_res = engine.pull(None).await?;
        assert!(pull_res.ops.is_empty());
        assert!(pull_res.new_cursor_seq.is_some());

        let guard = received.lock().await;
        assert!(!guard.is_empty());
        Ok(())
    }
}
