//! Configuration file support for the Sulcus CLI.
//!
//! Resolution hierarchy (highest wins):
//! 1. CLI flags (`--local`, `--namespace`, etc.)
//! 2. Environment variables (`SULCUS_API_KEY`, `SULCUS_NAMESPACE`, etc.)
//! 3. Config file (`~/.sulcus/config.toml` or `SULCUS_CONFIG`)
//! 4. Built-in defaults
//!
//! Config file format (TOML):
//! ```toml
//! # Default backend mode: "auto", "cloud", or "local"
//! mode = "auto"
//! namespace = "my-agent"
//!
//! [cloud]
//! api_key = "sk-..."
//! base_url = "https://api.sulcus.ca"
//!
//! [local]
//! db_path = "~/.sulcus/memories.db"
//!
//! [serve]
//! host = "127.0.0.1"
//! port = 3200
//! ```

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Config structs
// ---------------------------------------------------------------------------

/// Top-level configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SulcusConfig {
    /// Default backend mode: "auto" (default), "cloud", or "local"
    pub mode: Option<String>,
    /// Default namespace
    pub namespace: Option<String>,
    /// Cloud backend settings
    pub cloud: CloudConfig,
    /// Local backend settings
    pub local: LocalConfig,
    /// Serve subcommand defaults
    pub serve: ServeConfig,
}

/// Cloud backend configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct CloudConfig {
    /// API key (prefer env var SULCUS_API_KEY for security)
    pub api_key: Option<String>,
    /// Cloud API base URL
    pub base_url: Option<String>,
}

/// Local backend configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LocalConfig {
    /// Path to SQLite database
    pub db_path: Option<String>,
    /// Database URL for PostgreSQL
    pub database_url: Option<String>,
}

/// Serve subcommand defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ServeConfig {
    /// Bind host
    pub host: String,
    /// Bind port
    pub port: u16,
}

impl Default for ServeConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 3200,
        }
    }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/// Resolved configuration with all layers merged.
///
/// Fields are the final values after merging CLI → env → config → defaults.
#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    /// "auto", "cloud", or "local"
    pub mode: String,
    pub namespace: String,
    pub api_key: Option<String>,
    pub base_url: String,
    pub db_path: String,
    pub database_url: Option<String>,
    pub serve_host: String,
    pub serve_port: u16,
    /// Path to config file (if found)
    pub config_path: Option<PathBuf>,
}

impl ResolvedConfig {
    /// Whether the resolved mode forces local backend.
    pub fn is_local(&self) -> bool {
        self.mode == "local"
    }

    /// Whether the resolved mode forces cloud backend.
    pub fn is_cloud(&self) -> bool {
        self.mode == "cloud"
    }

    /// Whether mode is auto-detect (default).
    pub fn is_auto(&self) -> bool {
        self.mode == "auto"
    }
}

/// Load and resolve configuration from all sources.
///
/// `cli_overrides` are values explicitly set on the command line.
pub fn resolve(cli_overrides: &CliOverrides) -> Result<ResolvedConfig> {
    // 1. Load config file
    let (file_config, config_path) = load_config_file()?;

    // 2. Build resolved config with hierarchy: CLI > env > file > defaults
    let mode = cli_overrides
        .mode
        .clone()
        .or_else(|| std::env::var("SULCUS_MODE").ok())
        .or_else(|| {
            // Legacy SULCUS_LOCAL=1 support
            let local_env = std::env::var("SULCUS_LOCAL")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            if local_env {
                Some("local".to_string())
            } else {
                None
            }
        })
        .or(file_config.mode)
        .unwrap_or_else(|| "auto".to_string());

    let namespace = cli_overrides
        .namespace
        .clone()
        .or_else(|| std::env::var("SULCUS_NAMESPACE").ok())
        .or(file_config.namespace)
        .unwrap_or_else(|| "default".to_string());

    let api_key = std::env::var("SULCUS_API_KEY")
        .ok()
        .or(file_config.cloud.api_key);

    let base_url = std::env::var("SULCUS_BASE_URL")
        .ok()
        .or(file_config.cloud.base_url)
        .unwrap_or_else(|| "https://api.sulcus.ca".to_string())
        .trim_end_matches('/')
        .to_string();

    let default_db = default_db_path();
    let db_path = std::env::var("SULCUS_DB")
        .ok()
        .or(file_config.local.db_path.map(|p| expand_tilde(&p)))
        .unwrap_or(default_db);

    let database_url = std::env::var("SULCUS_DATABASE_URL")
        .ok()
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .or(file_config.local.database_url);

    let serve_host = file_config.serve.host;
    let serve_port = file_config.serve.port;

    Ok(ResolvedConfig {
        mode,
        namespace,
        api_key,
        base_url,
        db_path,
        database_url,
        serve_host,
        serve_port,
        config_path,
    })
}

/// CLI-level overrides (only set when the user explicitly passes a flag).
#[derive(Debug, Default)]
pub struct CliOverrides {
    /// --local flag → mode = "local"
    pub mode: Option<String>,
    /// --namespace flag
    pub namespace: Option<String>,
}

// ---------------------------------------------------------------------------
// Config file loading
// ---------------------------------------------------------------------------

/// Find and load the config file. Returns defaults if not found.
fn load_config_file() -> Result<(SulcusConfig, Option<PathBuf>)> {
    let path = config_file_path();

    if let Some(ref p) = path {
        if p.exists() {
            let contents = std::fs::read_to_string(p)
                .with_context(|| format!("Failed to read config file: {}", p.display()))?;
            let config: SulcusConfig = toml::from_str(&contents)
                .with_context(|| format!("Failed to parse config file: {}", p.display()))?;
            return Ok((config, Some(p.clone())));
        }
    }

    Ok((SulcusConfig::default(), None))
}

/// Determine config file path: SULCUS_CONFIG env var, or ~/.sulcus/config.toml
fn config_file_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SULCUS_CONFIG") {
        return Some(PathBuf::from(p));
    }

    sulcus_dir().map(|d| d.join("config.toml"))
}

/// Get the ~/.sulcus directory.
fn sulcus_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".sulcus"))
}

/// Default database path.
fn default_db_path() -> String {
    sulcus_dir()
        .map(|d| d.join("memories.db").to_string_lossy().to_string())
        .unwrap_or_else(|| "./memories.db".to_string())
}

/// Get home directory cross-platform.
fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(PathBuf::from)
}

/// Expand leading ~ to home directory.
fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

// ---------------------------------------------------------------------------
// Config init helper
// ---------------------------------------------------------------------------

/// Generate a default config file at ~/.sulcus/config.toml.
/// Returns the path written to.
pub fn init_config() -> Result<PathBuf> {
    let dir = sulcus_dir().context("Cannot determine home directory")?;
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create {}", dir.display()))?;

    let path = dir.join("config.toml");
    if path.exists() {
        anyhow::bail!("Config file already exists: {}", path.display());
    }

    let template = r#"# Sulcus CLI configuration
# See: https://sulcus.ca/docs/cli

# Backend mode: "auto" (default), "cloud", or "local"
# auto = use cloud if SULCUS_API_KEY is set, else local
mode = "auto"

# Default namespace for memory isolation
# namespace = "default"

[cloud]
# API key — prefer SULCUS_API_KEY env var for security
# api_key = "sk-..."
# base_url = "https://api.sulcus.ca"

[local]
# SQLite database path (~ expanded)
# db_path = "~/.sulcus/memories.db"

[serve]
# Local REST API server defaults
host = "127.0.0.1"
port = 3200
"#;

    std::fs::write(&path, template)
        .with_context(|| format!("Failed to write {}", path.display()))?;

    Ok(path)
}

/// Show the resolved configuration for debugging.
pub fn show_resolved(resolved: &ResolvedConfig) {
    eprintln!("┌─ Sulcus Configuration ─────────────────────────");
    if let Some(ref p) = resolved.config_path {
        eprintln!("│  Config file: {}", p.display());
    } else {
        eprintln!("│  Config file: (none)");
    }
    eprintln!("│  Mode:        {}", resolved.mode);
    eprintln!("│  Namespace:   {}", resolved.namespace);
    match resolved.api_key {
        Some(ref k) if k.len() > 8 => {
            eprintln!("│  API key:     {}...{}", &k[..4], &k[k.len()-4..]);
        }
        Some(_) => eprintln!("│  API key:     (set)"),
        None => eprintln!("│  API key:     (not set)"),
    }
    eprintln!("│  Base URL:    {}", resolved.base_url);
    eprintln!("│  DB path:     {}", resolved.db_path);
    eprintln!("└─────────────────────────────────────────────────");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_tilde() {
        // Without HOME set, tilde stays literal
        let plain = expand_tilde("/absolute/path");
        assert_eq!(plain, "/absolute/path");

        let relative = expand_tilde("relative/path");
        assert_eq!(relative, "relative/path");
    }

    #[test]
    fn test_default_config_parse() {
        let toml_str = r#"
mode = "cloud"
namespace = "test-ns"

[cloud]
api_key = "sk-test123"
base_url = "https://custom.api.com"

[local]
db_path = "/tmp/test.db"

[serve]
host = "0.0.0.0"
port = 8080
"#;
        let config: SulcusConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.mode.as_deref(), Some("cloud"));
        assert_eq!(config.namespace.as_deref(), Some("test-ns"));
        assert_eq!(config.cloud.api_key.as_deref(), Some("sk-test123"));
        assert_eq!(config.cloud.base_url.as_deref(), Some("https://custom.api.com"));
        assert_eq!(config.local.db_path.as_deref(), Some("/tmp/test.db"));
        assert_eq!(config.serve.host, "0.0.0.0");
        assert_eq!(config.serve.port, 8080);
    }

    #[test]
    fn test_empty_config_parse() {
        let config: SulcusConfig = toml::from_str("").unwrap();
        assert!(config.mode.is_none());
        assert!(config.namespace.is_none());
        assert!(config.cloud.api_key.is_none());
        assert_eq!(config.serve.port, 3200);
    }

    #[test]
    fn test_partial_config_parse() {
        let toml_str = r#"
namespace = "my-agent"
"#;
        let config: SulcusConfig = toml::from_str(toml_str).unwrap();
        assert!(config.mode.is_none());
        assert_eq!(config.namespace.as_deref(), Some("my-agent"));
        assert!(config.cloud.api_key.is_none());
        assert_eq!(config.serve.host, "127.0.0.1"); // default
    }
}
