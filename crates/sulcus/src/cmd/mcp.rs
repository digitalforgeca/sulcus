use std::sync::Arc;

use anyhow::Result;
use rmcp::ServiceExt;
use rmcp::transport::streamable_http_server::{
    StreamableHttpService,
    StreamableHttpServerConfig,
    session::local::LocalSessionManager,
};
use tracing_subscriber::{fmt, EnvFilter};

use sulcus_cloud::SulcusClient;
use sulcus_mcp_impl::SulcusMcp;

use crate::McpTransport;

/// Initialize logging to stderr (so stdio transport works cleanly).
fn init_logging() {
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();
}

pub async fn run(transport: McpTransport) -> Result<()> {
    init_logging();

    // Create the Sulcus API client from env vars
    let client = SulcusClient::from_env()?;
    let service = SulcusMcp::new(client);

    match transport {
        McpTransport::Stdio => run_stdio(service).await,
        McpTransport::Http { host, port } => run_http(service, &host, port).await,
    }
}

/// Run MCP server on stdio (for Claude Desktop, Cursor, VS Code).
async fn run_stdio(service: SulcusMcp) -> Result<()> {
    tracing::info!("sulcus mcp running on stdio");
    let transport = rmcp::transport::io::stdio();
    let server = service.serve(transport).await?;
    server.waiting().await?;
    Ok(())
}

/// Run MCP server on Streamable HTTP.
async fn run_http(service: SulcusMcp, host: &str, port: u16) -> Result<()> {
    let addr = format!("{host}:{port}");

    let config = StreamableHttpServerConfig::default();
    let session_manager = Arc::new(LocalSessionManager::default());

    let svc = service.clone();
    let app = StreamableHttpService::new(
        move || Ok(svc.clone()),
        session_manager,
        config,
    );

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("sulcus mcp HTTP server listening on http://{addr}/mcp");

    let make_svc = hyper::service::service_fn(move |req| {
        let mut svc = app.clone();
        async move {
            use tower_service::Service;
            svc.call(req).await
        }
    });

    loop {
        let (stream, _peer) = listener.accept().await?;
        let svc = make_svc.clone();
        let io = hyper_util::rt::TokioIo::new(stream);
        tokio::spawn(async move {
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, svc)
                .await
            {
                tracing::error!("Connection error: {e}");
            }
        });
    }
}
