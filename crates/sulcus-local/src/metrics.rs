use once_cell::sync::OnceCell;
use prometheus::{Encoder, Gauge, IntCounter, Registry, TextEncoder};
use std::net::SocketAddr;
use std::sync::Arc;

#[derive(Clone)]
pub struct Metrics {
    pub registry: Registry,
    pub active_index_size: Gauge,
    pub num_nodes: Gauge,
    pub memory_ops_count: IntCounter,
    pub db_size_bytes: Gauge,
}

impl Metrics {
    pub fn new() -> anyhow::Result<Self> {
        let registry = Registry::new();

        let active_index_size = Gauge::with_opts(prometheus::Opts::new(
            "sulcus_active_index_size",
            "Number of nodes in active_index (short-term working set)",
        ))?;
        let num_nodes = Gauge::with_opts(prometheus::Opts::new(
            "sulcus_num_nodes",
            "Number of nodes stored in SQLite",
        ))?;
        // WAL-based counters removed: keep the metric for compatibility but it will always be zero.
        let memory_ops_count = IntCounter::with_opts(prometheus::Opts::new(
            "sulcus_memory_ops_total",
            "(deprecated) Total memory operations recorded in WAL",
        ))?;
        let db_size_bytes = Gauge::with_opts(prometheus::Opts::new(
            "sulcus_db_size_bytes",
            "Size of the SQLite DB file in bytes",
        ))?;

        registry.register(Box::new(active_index_size.clone()))?;
        registry.register(Box::new(num_nodes.clone()))?;
        registry.register(Box::new(memory_ops_count.clone()))?;
        registry.register(Box::new(db_size_bytes.clone()))?;

        Ok(Self {
            registry,
            active_index_size,
            num_nodes,
            memory_ops_count,
            db_size_bytes,
        })
    }

    /// Encode current registry to Prometheus text format.
    pub fn gather_text(&self) -> anyhow::Result<String> {
        let encoder = TextEncoder::new();
        let mfs = self.registry.gather();
        let mut buf = Vec::new();
        encoder.encode(&mfs, &mut buf)?;
        Ok(String::from_utf8(buf)?)
    }
}

static GLOBAL: OnceCell<Arc<Metrics>> = OnceCell::new();

/// Initialize global metrics (idempotent). If `SULCUS_PROMETHEUS_PORT` is set,
/// a small HTTP endpoint will be started on that port serving `/metrics`.
pub fn init_from_env() -> anyhow::Result<Arc<Metrics>> {
    if let Some(existing) = GLOBAL.get() {
        return Ok(existing.clone());
    }

    let m = Arc::new(Metrics::new()?);
    GLOBAL
        .set(m.clone())
        .map_err(|_| anyhow::anyhow!("metrics already set"))?;

    // optional HTTP exporter
    if let Ok(port_s) = std::env::var("SULCUS_PROMETHEUS_PORT") {
        if let Ok(port) = port_s.parse::<u16>() {
            spawn_http_server(m.clone(), port);
        }
    }

    Ok(m)
}

pub fn try_get() -> Option<Arc<Metrics>> {
    GLOBAL.get().cloned()
}

fn spawn_http_server(m: Arc<Metrics>, port: u16) {
    // spawn a small hyper server that serves /metrics
    tokio::spawn(async move {
        use hyper::service::{make_service_fn, service_fn};
        use hyper::{Body, Request, Response, Server, StatusCode};

        let addr = SocketAddr::from(([0, 0, 0, 0], port));
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
                                    .body(Body::from("encode error"))
                                    .unwrap()),
                            }
                        } else {
                            Ok(Response::builder()
                                .status(StatusCode::NOT_FOUND)
                                .body(Body::from("not found"))
                                .unwrap())
                        }
                    }
                }))
            }
        });

        let server = Server::bind(&addr).serve(make_svc);
        tracing::info!(port = port, "prometheus metrics server started");
        if let Err(e) = server.await {
            tracing::error!(error = %e, "metrics server failed");
        }
    });
}
