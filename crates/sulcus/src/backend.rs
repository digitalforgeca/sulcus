//! Backend resolution — picks cloud or local based on environment/config.
//!
//! Resolution order:
//! 1. If `--local` flag or `SULCUS_LOCAL=1` → local SQLite backend
//! 2. If `SULCUS_API_KEY` is set → cloud backend
//! 3. If `local` feature is available → fall back to local
//! 4. Error with guidance

use std::sync::Arc;

use anyhow::{Context, Result};
use sulcus_core::StorageBackend;

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

/// Resolve the storage backend from environment and feature flags.
///
/// Prefers cloud when `SULCUS_API_KEY` is set, falls back to local when
/// the `local` feature is compiled in.
pub fn resolve(force_local: bool) -> Result<ResolvedBackend> {
    // Explicit local override
    let env_local = std::env::var("SULCUS_LOCAL")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if force_local || env_local {
        return resolve_local();
    }

    // Try cloud first
    #[cfg(feature = "cloud")]
    {
        if std::env::var("SULCUS_API_KEY").is_ok() {
            let client = sulcus_cloud::SulcusClient::from_env()
                .context("Failed to initialize cloud backend")?;
            return Ok(ResolvedBackend {
                backend: Arc::new(client),
                mode: BackendMode::Cloud,
            });
        }
    }

    // Fall back to local
    #[cfg(feature = "local")]
    {
        return resolve_local();
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

/// Resolve the local SQLite backend.
#[cfg(feature = "local")]
fn resolve_local() -> Result<ResolvedBackend> {
    let namespace = std::env::var("SULCUS_NAMESPACE")
        .unwrap_or_else(|_| "default".to_string());

    // Database path: SULCUS_DB or default to ~/.sulcus/memories.db
    let db_path = std::env::var("SULCUS_DB").unwrap_or_else(|_| {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        format!("{home}/.sulcus/memories.db")
    });

    let store = sulcus_local::LocalStore::open(&db_path, &namespace)
        .with_context(|| format!("Failed to open local database: {db_path}"))?;

    Ok(ResolvedBackend {
        backend: Arc::new(store),
        mode: BackendMode::Local,
    })
}

#[cfg(not(feature = "local"))]
fn resolve_local() -> Result<ResolvedBackend> {
    anyhow::bail!(
        "Local mode requested but `local` feature not compiled.\n\
         Rebuild with: cargo build --features local"
    );
}
