//! Backend resolution — picks cloud or local based on config hierarchy.
//!
//! Resolution order (highest wins):
//! 1. CLI flags (`--local`, `--namespace`)
//! 2. Environment variables (`SULCUS_API_KEY`, `SULCUS_LOCAL`, etc.)
//! 3. Config file (`~/.sulcus/config.toml` or `SULCUS_CONFIG`)
//! 4. Built-in defaults
//!
//! Mode logic:
//! - "local" → always use local SQLite backend
//! - "cloud" → always use cloud backend (errors if no API key)
//! - "auto"  → cloud if API key available, else local if compiled in, else error

use std::sync::Arc;

use anyhow::{Context, Result};
use sulcus_core::StorageBackend;

use crate::config::ResolvedConfig;

/// Which backend mode was resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendMode {
    Cloud,
    Local,
}

impl std::fmt::Display for BackendMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackendMode::Cloud => write!(f, "cloud"),
            BackendMode::Local => write!(f, "local"),
        }
    }
}

/// Resolved backend with mode metadata.
pub struct ResolvedBackend {
    pub backend: Arc<dyn StorageBackend>,
    pub mode: BackendMode,
}

/// Resolve the storage backend from the merged configuration.
pub fn resolve(config: &ResolvedConfig) -> Result<ResolvedBackend> {
    match config.mode.as_str() {
        "local" => resolve_local(config),
        "cloud" => resolve_cloud(config),
        "auto" | _ => resolve_auto(config),
    }
}

/// Auto-detect: try cloud first, fall back to local.
fn resolve_auto(config: &ResolvedConfig) -> Result<ResolvedBackend> {
    // Try cloud if API key is available
    #[cfg(feature = "cloud")]
    {
        if config.api_key.is_some() {
            return resolve_cloud(config);
        }
    }

    // Fall back to local
    #[cfg(feature = "local")]
    {
        return resolve_local(config);
    }

    // Neither available
    #[allow(unreachable_code)]
    {
        anyhow::bail!(
            "No backend available.\n\
             Set SULCUS_API_KEY for cloud mode, or compile with --features local for local mode.\n\
             Get an API key at https://sulcus.ca/dashboard/settings"
        );
    }
}

/// Resolve cloud backend from config.
#[cfg(feature = "cloud")]
fn resolve_cloud(config: &ResolvedConfig) -> Result<ResolvedBackend> {
    let api_key = config
        .api_key
        .as_ref()
        .context(
            "Cloud mode requires an API key.\n\
             Set SULCUS_API_KEY or add api_key to [cloud] in ~/.sulcus/config.toml\n\
             Get a key at https://sulcus.ca/dashboard/settings",
        )?;

    // Build SulcusConfig manually from resolved values (don't re-read env)
    let client_config = sulcus_cloud::SulcusConfig {
        api_key: api_key.clone(),
        base_url: config.base_url.clone(),
        namespace: config.namespace.clone(),
        timeout: std::time::Duration::from_secs(30),
    };

    let client = sulcus_cloud::SulcusClient::new(client_config)
        .context("Failed to initialize cloud backend")?;

    Ok(ResolvedBackend {
        backend: Arc::new(client),
        mode: BackendMode::Cloud,
    })
}

#[cfg(not(feature = "cloud"))]
fn resolve_cloud(_config: &ResolvedConfig) -> Result<ResolvedBackend> {
    anyhow::bail!(
        "Cloud mode requested but `cloud` feature not compiled.\n\
         Rebuild with: cargo build --features cloud"
    );
}

/// Resolve local SQLite backend from config.
#[cfg(feature = "local")]
fn resolve_local(config: &ResolvedConfig) -> Result<ResolvedBackend> {
    // Ensure parent directory exists
    let db_path = std::path::Path::new(&config.db_path);
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create directory: {}", parent.display()))?;
    }

    let store = sulcus_local::LocalStore::open(&config.db_path, &config.namespace)
        .with_context(|| format!("Failed to open local database: {}", config.db_path))?;

    Ok(ResolvedBackend {
        backend: Arc::new(store),
        mode: BackendMode::Local,
    })
}

#[cfg(not(feature = "local"))]
fn resolve_local(_config: &ResolvedConfig) -> Result<ResolvedBackend> {
    anyhow::bail!(
        "Local mode requested but `local` feature not compiled.\n\
         Rebuild with: cargo build --features local"
    );
}
