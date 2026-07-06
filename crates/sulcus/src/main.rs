//! sulcus — Unified CLI for Sulcus Thermodynamic Memory.
//!
//! One binary, everything integral.
//!
//! Subcommands:
//!   sulcus mcp stdio     — MCP server on stdio
//!   sulcus mcp http      — MCP server on Streamable HTTP
//!   sulcus status        — Connection/memory stats
//!   sulcus search        — Search memories
//!   sulcus remember      — Store a memory
//!   sulcus import        — Import memories from markdown
//!   sulcus export        — Export memories as markdown

mod backend;
mod cmd;

use anyhow::Result;
use clap::{Parser, Subcommand};

// ---------------------------------------------------------------------------
// Top-level CLI
// ---------------------------------------------------------------------------

/// Sulcus — Thermodynamic Memory for AI Agents
#[derive(Parser, Debug)]
#[command(
    name = "sulcus",
    version,
    about = "Thermodynamic memory for AI agents. One binary, everything integral.",
    long_about = None,
)]
struct Cli {
    /// Force local SQLite backend (overrides cloud). Also: SULCUS_LOCAL=1
    #[arg(long, global = true)]
    local: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// MCP server (stdio or Streamable HTTP)
    #[cfg(feature = "cloud")]
    Mcp {
        #[command(subcommand)]
        transport: McpTransport,
    },

    /// Show connection and memory status
    Status,

    /// Search memories
    Search {
        /// Search query
        query: String,

        /// Maximum number of results
        #[arg(short = 'n', long, default_value = "5")]
        limit: u32,

        /// Filter by memory type (episodic, semantic, preference, procedural, fact)
        #[arg(short = 't', long = "type")]
        memory_type: Option<String>,

        /// Minimum heat threshold (0.0–1.0)
        #[arg(long)]
        min_heat: Option<f64>,
    },

    /// Store a memory
    Remember {
        /// Text content to remember
        text: String,

        /// Memory type (episodic, semantic, preference, procedural, fact)
        #[arg(short = 't', long = "type", default_value = "episodic")]
        memory_type: String,

        /// Optional source tag
        #[arg(short, long)]
        source: Option<String>,
    },

    /// Import memories from a markdown file
    Import {
        /// Path to markdown file
        file: String,

        /// Force local backend for import
        #[arg(long)]
        local_import: bool,
    },

    /// Export all memories as markdown
    Export {
        /// Output file (default: stdout)
        #[arg(short, long)]
        output: Option<String>,
    },

    /// Start a local REST API server (cloud-compatible endpoints)
    #[cfg(feature = "serve")]
    Serve {
        /// Port to listen on
        #[arg(short, long, default_value = "3200")]
        port: u16,

        /// Host/address to bind to
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
    },
}

#[cfg(feature = "cloud")]
#[derive(Subcommand, Debug)]
enum McpTransport {
    /// Run MCP server on stdio (for Claude Desktop, Cursor, VS Code)
    Stdio,

    /// Run MCP server on Streamable HTTP
    Http {
        /// Port to listen on
        #[arg(short, long, default_value = "3100")]
        port: u16,

        /// Host/address to bind to
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
    },
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    dispatch(cli).await
}

async fn dispatch(cli: Cli) -> Result<()> {
    let force_local = cli.local;

    match cli.command {
        // MCP is always cloud (serves remote API over MCP protocol)
        #[cfg(feature = "cloud")]
        Commands::Mcp { transport } => cmd::mcp::run(transport).await,

        // These commands use the unified backend
        Commands::Status => {
            let resolved = backend::resolve(force_local)?;
            cmd::status::run(&*resolved.backend, resolved.mode).await
        }
        Commands::Search {
            query,
            limit,
            memory_type,
            min_heat,
        } => {
            let resolved = backend::resolve(force_local)?;
            cmd::search::run(&*resolved.backend, &query, limit, memory_type.as_deref(), min_heat).await
        }
        Commands::Remember {
            text,
            memory_type,
            source,
        } => {
            let resolved = backend::resolve(force_local)?;
            cmd::remember::run(&*resolved.backend, &text, &memory_type, source.as_deref()).await
        }
        Commands::Import { file, .. } => {
            let resolved = backend::resolve(force_local)?;
            cmd::import::run(&*resolved.backend, &file).await
        }
        Commands::Export { output } => {
            let resolved = backend::resolve(force_local)?;
            cmd::export::run(&*resolved.backend, output.as_deref()).await
        }

        // Serve always uses local backend (it IS the local server)
        #[cfg(feature = "serve")]
        Commands::Serve { host, port } => {
            let resolved = backend::resolve(true)?; // force local
            cmd::serve::run(resolved.backend, &host, port).await
        }
    }
}
