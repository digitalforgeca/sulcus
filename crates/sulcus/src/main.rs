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
//!   sulcus config        — Show or initialize configuration

mod backend;
mod cmd;
pub mod config;

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

    /// Override namespace. Also: SULCUS_NAMESPACE=<name>
    #[arg(long, global = true)]
    namespace: Option<String>,

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

    /// Show or initialize configuration
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
}

#[derive(Subcommand, Debug)]
enum ConfigAction {
    /// Show resolved configuration (from all sources)
    Show,
    /// Initialize a new config file at ~/.sulcus/config.toml
    Init,
    /// Print the config file path
    Path,
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
    // Build CLI overrides from explicit flags
    let cli_overrides = config::CliOverrides {
        mode: if cli.local {
            Some("local".to_string())
        } else {
            None
        },
        namespace: cli.namespace,
    };

    match cli.command {
        // Config subcommand doesn't need a backend
        Commands::Config { action } => {
            match action {
                ConfigAction::Show => {
                    let resolved = config::resolve(&cli_overrides)?;
                    config::show_resolved(&resolved);
                }
                ConfigAction::Init => {
                    let path = config::init_config()?;
                    eprintln!("✓ Config file created: {}", path.display());
                    eprintln!("  Edit it to set your defaults.");
                }
                ConfigAction::Path => {
                    let resolved = config::resolve(&cli_overrides)?;
                    if let Some(ref p) = resolved.config_path {
                        println!("{}", p.display());
                    } else {
                        // Show where it would be
                        let home = std::env::var("HOME")
                            .or_else(|_| std::env::var("USERPROFILE"))
                            .unwrap_or_else(|_| ".".to_string());
                        println!("{home}/.sulcus/config.toml (not found)");
                    }
                }
            }
            Ok(())
        }

        // MCP routes dynamically based on configuration (cloud, local, or hybrid)
        #[cfg(feature = "cloud")]
        Commands::Mcp { transport } => {
            let config = config::resolve(&cli_overrides)?;
            let resolved = backend::resolve(&config).await?;
            cmd::mcp::run(transport, resolved.backend).await
        }

        // These commands use the unified backend via config resolution
        Commands::Status => {
            let config = config::resolve(&cli_overrides)?;
            let resolved = backend::resolve(&config).await?;
            cmd::status::run(&*resolved.backend, resolved.mode).await
        }
        Commands::Search {
            query,
            limit,
            memory_type,
            min_heat,
        } => {
            let config = config::resolve(&cli_overrides)?;
            let resolved = backend::resolve(&config).await?;
            cmd::search::run(&*resolved.backend, &query, limit, memory_type.as_deref(), min_heat).await
        }
        Commands::Remember {
            text,
            memory_type,
            source,
        } => {
            let config = config::resolve(&cli_overrides)?;
            let resolved = backend::resolve(&config).await?;
            cmd::remember::run(&*resolved.backend, &text, &memory_type, source.as_deref()).await
        }
        Commands::Import { file, .. } => {
            let config = config::resolve(&cli_overrides)?;
            let resolved = backend::resolve(&config).await?;
            cmd::import::run(&*resolved.backend, &file).await
        }
        Commands::Export { output } => {
            let config = config::resolve(&cli_overrides)?;
            let resolved = backend::resolve(&config).await?;
            cmd::export::run(&*resolved.backend, output.as_deref()).await
        }

        // Serve always uses local backend (it IS the local server)
        #[cfg(feature = "serve")]
        Commands::Serve { host, port } => {
            let mut overrides = cli_overrides;
            overrides.mode = Some("local".to_string()); // force local
            let config = config::resolve(&overrides)?;
            let resolved = backend::resolve(&config).await?;
            cmd::serve::run(resolved.backend, &host, port).await
        }
    }
}
