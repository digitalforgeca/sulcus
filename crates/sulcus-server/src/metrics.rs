use once_cell::sync::OnceCell;
use prometheus::{Encoder, Gauge, Registry, TextEncoder};
use std::net::SocketAddr;
use std::sync::Arc;

#[derive(Clone)]
pub struct Metrics {
    pub registry: Registry,
    pub golden_index_size: Gauge,
    pub server_ops_in_wal: Gauge,
    pub db_size_bytes: Gauge,
    pub pg_enabled: Gauge,
}

impl Metrics {
    pub fn new() -> anyhow::Result<Self> {
        let registry = Registry::new();

        let golden_index_size = Gauge::with_opts(prometheus::Opts::new(
            "sulcus_server_golden_index_size",
            "Number of nodes in the server golden index",
        ))?;
        let server_ops_in_wal = Gauge::with_opts(prometheus::Opts::new(
            "sulcus_server_ops_in_wal",
            "Number of ops currently in the server WAL",
        ))?;
        let db_size_bytes = Gauge::with_opts(prometheus::Opts::new(
            "sulcus_server_db_size_bytes",
            "Postgres DB size in bytes (0 if unavailable)",
        ))?;
        let pg_enabled = Gauge::with_opts(prometheus::Opts::new(
            "sulcus_server_pg_enabled",
            "1.0 if Postgres is configured, 0.0 otherwise",
        ))?;

        registry.register(Box::new(golden_index_size.clone()))?;
        registry.register(Box::new(server_ops_in_wal.clone()))?;
        registry.register(Box::new(db_size_bytes.clone()))?;
        registry.register(Box::new(pg_enabled.clone()))?;

        Ok(Self {
            registry,
            golden_index_size,
            server_ops_in_wal,
            db_size_bytes,
            pg_enabled,
        })
    }

    pub fn gather_text(&self) -> anyhow::Result<String> {
        let encoder = TextEncoder::new();
        let mfs = self.registry.gather();
        let mut buf = Vec::new();
        encoder.encode(&mfs, &mut buf)?;
        Ok(String::from_utf8(buf)?)
    }
}

static GLOBAL: OnceCell<Arc<Metrics>> = OnceCell::new();

/// Initialize global metrics (idempotent). If `SULCUS_METRICS_ADDR` is set (`host:port`
/// or bare port number), a small HTTP endpoint will be started on that address serving `/metrics`.
pub fn init_from_env() -> anyhow::Result<Arc<Metrics>> {
    if let Some(existing) = GLOBAL.get() {
        return Ok(existing.clone());
    }

    let m = Arc::new(Metrics::new()?);
    GLOBAL
        .set(m.clone())
        .map_err(|_| anyhow::anyhow!("metrics already set"))?;

    if let Ok(addr_s) = std::env::var("SULCUS_METRICS_ADDR") {
        let addr: Option<SocketAddr> = addr_s.parse().ok().or_else(|| {
            addr_s.parse::<u16>().ok().map(|p| SocketAddr::from(([0, 0, 0, 0], p)))
        });
        if let Some(addr) = addr {
            spawn_http_server(m.clone(), addr);
        }
    }

    Ok(m)
}

pub fn try_get() -> Option<Arc<Metrics>> {
    GLOBAL.get().cloned()
}

fn spawn_http_server(m: Arc<Metrics>, addr: SocketAddr) {
    tokio::spawn(async move {
        use hyper::service::{make_service_fn, service_fn};
        use hyper::{Body, Request, Response, Server, StatusCode};

        let make_svc = make_service_fn(move |_conn| {
            let m = m.clone();
            async move {
                Ok::<_, hyper::Error>(service_fn(move |req: Request<Body>| {
                    let m = m.clone();
                    async move {
                        if req.uri().path() == "/metrics" {
                            match m.gather_text() {
                                Ok(body) => Ok::<_, hyper::Error>(Response::new(Body::from(body))),
                                Err(_) => Ok(Response::builder()
                                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                                    .body(Body::from("encode error")).unwrap()),
                            }
                        } else {
                            Ok(Response::builder()
                                .status(StatusCode::NOT_FOUND)
                                .body(Body::from("not found")).unwrap())
                        }
                    }
                }))
            }
        });

        let server = hyper::Server::bind(&addr).serve(make_svc);
        tracing::info!(%addr, "prometheus metrics server started (sulcus-server)");
        if let Err(e) = server.await {
            tracing::error!(error = %e, "metrics server failed");
        }
    });
}
