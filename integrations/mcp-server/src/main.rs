//! sulcus-mcp — MCP server for Sulcus Thermodynamic Memory.
//!
//! Transports:
//!   - stdio (default): For Claude Desktop, Cursor, VS Code, local sidecar
//!   - Streamable HTTP (--http): For remote/multi-tenant, web agents, MAF
//!
//! Auth:
//!   - SULCUS_API_KEY env var
//!   - SULCUS_BASE_URL env var (optional, defaults to Sulcus Cloud)
//!   - SULCUS_NAMESPACE env var (optional, defaults to "default")

mod client;
mod server;
mod types;

use std::sync::Arc;

use anyhow::Result;
use clap::Parser;
use rmcp::ServiceExt;
use rmcp::transport::streamable_http_server::{
    StreamableHttpService,
    StreamableHttpServerConfig,
    session::local::LocalSessionManager,
};
use tracing_subscriber::{fmt, EnvFilter};

use crate::client::SulcusClient;
use crate::server::SulcusMcp;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/// MCP server for Sulcus — Thermodynamic Memory for AI Agents
#[derive(Parser, Debug)]
#[command(name = "sulcus-mcp", version, about)]
struct Cli {
    /// Use Streamable HTTP transport instead of stdio
    #[arg(long)]
    http: bool,

    /// HTTP port (default: 3100, only used with --http)
    #[arg(long, default_value = "3100")]
    port: u16,

    /// HTTP host (default: 127.0.0.1, only used with --http)
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging (stderr so stdio transport works)
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();

    // Create the Sulcus API client
    let client = SulcusClient::from_env()?;
    let service = SulcusMcp::new(client);

    if cli.http {
        // Streamable HTTP transport
        let addr = format!("{}:{}", cli.host, cli.port);

        let config = StreamableHttpServerConfig::default();
        let session_manager = Arc::new(LocalSessionManager::default());

        let svc = service.clone();
        let app = StreamableHttpService::new(
            move || Ok(svc.clone()),
            session_manager,
            config,
        );

        let listener = tokio::net::TcpListener::bind(&addr).await?;
        tracing::info!("sulcus-mcp HTTP server listening on http://{addr}/mcp");

        // StreamableHttpService implements tower::Service<Request>,
        // so we can serve it directly with hyper/axum
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
    } else {
        // stdio transport (default)
        tracing::info!("sulcus-mcp running on stdio");
        let transport = rmcp::transport::io::stdio();
        let server = service.serve(transport).await?;
        server.waiting().await?;
    }

    Ok(())
}
