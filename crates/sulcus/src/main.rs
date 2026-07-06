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
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// MCP server (stdio or Streamable HTTP)
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
    },

    /// Export all memories as markdown
    Export {
        /// Output file (default: stdout)
        #[arg(short, long)]
        output: Option<String>,
    },
}

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

    match cli.command {
        Commands::Mcp { transport } => cmd::mcp::run(transport).await,
        Commands::Status => cmd::status::run().await,
        Commands::Search {
            query,
            limit,
            memory_type,
            min_heat,
        } => cmd::search::run(&query, limit, memory_type.as_deref(), min_heat).await,
        Commands::Remember {
            text,
            memory_type,
            source,
        } => cmd::remember::run(&text, &memory_type, source.as_deref()).await,
        Commands::Import { file } => cmd::import::run(&file).await,
        Commands::Export { output } => cmd::export::run(output.as_deref()).await,
    }
}
