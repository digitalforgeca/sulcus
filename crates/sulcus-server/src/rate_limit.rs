//! Per-IP and per-tenant rate limiting.
//!
//! Uses an in-memory sliding window counter with periodic cleanup.
//! No external dependencies (Redis etc) — appropriate for single-instance deployment.

use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use dashmap::DashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// A sliding window counter entry.
#[derive(Clone)]
struct WindowEntry {
    count: u64,
    window_start: Instant,
}

/// Rate limiter configuration.
#[derive(Clone)]
pub struct RateLimiter {
    /// IP -> window entry for public routes
    ip_windows: Arc<DashMap<String, WindowEntry>>,
    /// tenant_id -> window entry for authenticated routes
    tenant_windows: Arc<DashMap<String, WindowEntry>>,
    /// Requests per window for anonymous/IP-based limiting
    pub ip_limit: u64,
    /// Requests per window for tenant-based limiting
    pub tenant_limit: u64,
    /// Window duration
    pub window: Duration,
}

impl RateLimiter {
    pub fn new(ip_limit: u64, tenant_limit: u64, window: Duration) -> Self {
        let limiter = Self {
            ip_windows: Arc::new(DashMap::new()),
            tenant_windows: Arc::new(DashMap::new()),
            ip_limit,
            tenant_limit,
            window,
        };

        // Spawn background cleanup every 5 minutes
        let ip_map = Arc::clone(&limiter.ip_windows);
        let tenant_map = Arc::clone(&limiter.tenant_windows);
        let window_dur = window;
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            loop {
                interval.tick().await;
                let now = Instant::now();
                ip_map.retain(|_, v| now.duration_since(v.window_start) < window_dur * 2);
                tenant_map.retain(|_, v| now.duration_since(v.window_start) < window_dur * 2);
            }
        });

        limiter
    }

    /// Check and increment for an IP. Returns (allowed, current_count, limit).
    pub fn check_ip(&self, ip: &str) -> (bool, u64, u64) {
        let now = Instant::now();
        let mut entry = self.ip_windows.entry(ip.to_string()).or_insert(WindowEntry {
            count: 0,
            window_start: now,
        });

        if now.duration_since(entry.window_start) >= self.window {
            entry.count = 0;
            entry.window_start = now;
        }

        entry.count += 1;
        let count = entry.count;
        (count <= self.ip_limit, count, self.ip_limit)
    }

    /// Check and increment for a tenant. Returns (allowed, current_count, limit).
    pub fn check_tenant(&self, tenant_id: &str) -> (bool, u64, u64) {
        let now = Instant::now();
        let mut entry = self
            .tenant_windows
            .entry(tenant_id.to_string())
            .or_insert(WindowEntry {
                count: 0,
                window_start: now,
            });

        if now.duration_since(entry.window_start) >= self.window {
            entry.count = 0;
            entry.window_start = now;
        }

        entry.count += 1;
        let count = entry.count;
        (count <= self.tenant_limit, count, self.tenant_limit)
    }
}

/// Axum middleware: rate-limit public routes by source IP.
/// Expects `ConnectInfo<SocketAddr>` in extensions (provided by axum's `into_make_service_with_connect_info`).
/// Falls back to "unknown" if not available (behind a proxy without forwarded headers).
pub async fn rate_limit_by_ip(
    State(limiter): State<Arc<RateLimiter>>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, Response> {
    let ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip().to_string())
        .or_else(|| {
            // Check X-Forwarded-For (Azure Container Apps sets this)
            req.headers()
                .get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
        })
        .unwrap_or_else(|| "unknown".to_string());

    let (allowed, count, limit) = limiter.check_ip(&ip);

    if !allowed {
        tracing::warn!(ip = %ip, count, limit, "IP rate limit exceeded");
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            [
                ("Retry-After", "60"),
                ("X-RateLimit-Limit", &limit.to_string()),
            ],
            "rate limit exceeded — try again later",
        )
            .into_response());
    }

    Ok(next.run(req).await)
}

/// Axum middleware: rate-limit authenticated routes by tenant ID.
/// Must be applied AFTER `require_agent_api_key` so TenantContext is in extensions.
pub async fn rate_limit_by_tenant(
    State(limiter): State<Arc<RateLimiter>>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, Response> {
    let tenant_id = req
        .extensions()
        .get::<crate::middleware::TenantContext>()
        .map(|tc| tc.id.clone())
        .unwrap_or_else(|| "unknown".to_string());

    let (allowed, count, limit) = limiter.check_tenant(&tenant_id);

    if !allowed {
        tracing::warn!(tenant_id = %tenant_id, count, limit, "tenant rate limit exceeded");
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            [
                ("Retry-After", "60"),
                ("X-RateLimit-Limit", &limit.to_string()),
            ],
            "rate limit exceeded — try again later",
        )
            .into_response());
    }

    Ok(next.run(req).await)
}
