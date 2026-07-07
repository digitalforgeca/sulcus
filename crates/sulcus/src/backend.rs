//! Backend resolution — picks cloud, local, or hybrid based on config hierarchy.

use std::sync::Arc;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use sulcus_core::backend::StorageBackend;
use sulcus_core::*;

use crate::config::ResolvedConfig;

/// Which backend mode was resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendMode {
    Cloud,
    Local,
    Hybrid,
}

impl std::fmt::Display for BackendMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackendMode::Cloud => write!(f, "cloud"),
            BackendMode::Local => write!(f, "local"),
            BackendMode::Hybrid => write!(f, "hybrid"),
        }
    }
}

/// Resolved backend with mode metadata.
pub struct ResolvedBackend {
    pub backend: Arc<dyn StorageBackend>,
    pub mode: BackendMode,
}

/// Hybrid storage backend: local PostgreSQL writes synced asynchronously to cloud.
pub struct HybridBackend {
    pub local: Arc<dyn StorageBackend>,
    pub cloud: Arc<dyn StorageBackend>,
}

#[async_trait::async_trait]
impl StorageBackend for HybridBackend {
    async fn remember(&self, params: &RememberParams) -> Result<Value> {
        let local_res = self.local.remember(params).await?;

        let cloud_client = self.cloud.clone();
        let params_copy = params.clone();
        tokio::spawn(async move {
            if let Err(e) = cloud_client.remember(&params_copy).await {
                tracing::warn!("Hybrid sync failed to store memory in cloud: {}", e);
            }
        });

        Ok(local_res)
    }

    async fn search(&self, params: &SearchParams) -> Result<Value> {
        self.local.search(params).await
    }

    async fn list(&self, params: &ListParams) -> Result<Value> {
        self.local.list(params).await
    }

    async fn get_memory(&self, memory_id: &str) -> Result<Memory> {
        self.local.get_memory(memory_id).await
    }

    async fn forget(&self, memory_id: &str) -> Result<Value> {
        let local_res = self.local.forget(memory_id).await?;

        let cloud_client = self.cloud.clone();
        let id_str = memory_id.to_string();
        tokio::spawn(async move {
            if let Err(e) = cloud_client.forget(&id_str).await {
                tracing::warn!("Hybrid sync failed to delete memory from cloud: {}", e);
            }
        });

        Ok(local_res)
    }

    async fn update(&self, params: &UpdateParams) -> Result<Value> {
        let local_res = self.local.update(params).await?;

        let cloud_client = self.cloud.clone();
        let params_copy = params.clone();
        tokio::spawn(async move {
            if let Err(e) = cloud_client.update(&params_copy).await {
                tracing::warn!("Hybrid sync failed to update memory in cloud: {}", e);
            }
        });

        Ok(local_res)
    }

    async fn boost(&self, memory_id: &str, amount: f64) -> Result<Value> {
        let local_res = self.local.boost(memory_id, amount).await?;

        let cloud_client = self.cloud.clone();
        let id_str = memory_id.to_string();
        tokio::spawn(async move {
            if let Err(e) = cloud_client.boost(&id_str, amount).await {
                tracing::warn!("Hybrid sync failed to boost memory in cloud: {}", e);
            }
        });

        Ok(local_res)
    }

    async fn deprecate(&self, memory_id: &str, amount: f64) -> Result<Value> {
        let local_res = self.local.deprecate(memory_id, amount).await?;

        let cloud_client = self.cloud.clone();
        let id_str = memory_id.to_string();
        tokio::spawn(async move {
            if let Err(e) = cloud_client.deprecate(&id_str, amount).await {
                tracing::warn!("Hybrid sync failed to deprecate memory in cloud: {}", e);
            }
        });

        Ok(local_res)
    }

    async fn hot_nodes(&self, limit: u32) -> Result<Value> {
        self.local.hot_nodes(limit).await
    }

    async fn build_context(&self, query: &str, token_budget: u32) -> Result<Value> {
        self.local.build_context(query, token_budget).await
    }

    async fn auto_recall(&self, params: &AutoRecallParams) -> Result<Value> {
        self.local.auto_recall(params).await
    }

    async fn auto_capture(&self, text: &str, source: &str) -> Result<Value> {
        let local_res = self.local.auto_capture(text, source).await?;

        let cloud_client = self.cloud.clone();
        let text_str = text.to_string();
        let source_str = source.to_string();
        tokio::spawn(async move {
            if let Err(e) = cloud_client.auto_capture(&text_str, &source_str).await {
                tracing::warn!("Hybrid sync failed to auto-capture memory in cloud: {}", e);
            }
        });

        Ok(local_res)
    }

    async fn relate(&self, params: &RelateParams) -> Result<Value> {
        let local_res = self.local.relate(params).await?;

        let cloud_client = self.cloud.clone();
        let params_copy = params.clone();
        tokio::spawn(async move {
            if let Err(e) = cloud_client.relate(&params_copy).await {
                tracing::warn!("Hybrid sync failed to relate memories in cloud: {}", e);
            }
        });

        Ok(local_res)
    }

    async fn graph_traverse(&self, memory_id: &str, depth: u32) -> Result<Value> {
        self.local.graph_traverse(memory_id, depth).await
    }

    async fn create_trigger(&self, params: &CreateTriggerParams) -> Result<Value> {
        let local_res = self.local.create_trigger(params).await?;

        let cloud_client = self.cloud.clone();
        let params_copy = params.clone();
        tokio::spawn(async move {
            if let Err(e) = cloud_client.create_trigger(&params_copy).await {
                tracing::warn!("Hybrid sync failed to create trigger in cloud: {}", e);
            }
        });

        Ok(local_res)
    }

    async fn list_triggers(&self) -> Result<Value> {
        self.local.list_triggers().await
    }

    async fn delete_trigger(&self, trigger_id: &str) -> Result<Value> {
        let local_res = self.local.delete_trigger(trigger_id).await?;

        let cloud_client = self.cloud.clone();
        let id_str = trigger_id.to_string();
        tokio::spawn(async move {
            if let Err(e) = cloud_client.delete_trigger(&id_str).await {
                tracing::warn!("Hybrid sync failed to delete trigger from cloud: {}", e);
            }
        });

        Ok(local_res)
    }

    async fn classify(&self, text: &str) -> Result<Value> {
        self.local.classify(text).await
    }

    async fn scan_pii(&self, text: &str) -> Result<Value> {
        self.local.scan_pii(text).await
    }

    async fn status(&self) -> Result<Value> {
        let local_status = self.local.status().await.unwrap_or(json!({"status": "error"}));
        let cloud_status = self.cloud.status().await.unwrap_or(json!({"status": "offline"}));
        Ok(json!({
            "status": "healthy",
            "backend": "hybrid",
            "local": local_status,
            "cloud": cloud_status,
        }))
    }

    async fn memory_status(&self) -> Result<Value> {
        self.local.memory_status().await
    }

    fn namespace(&self) -> &str {
        self.local.namespace()
    }
}

/// Resolve the storage backend from the merged configuration.
pub async fn resolve(config: &ResolvedConfig) -> Result<ResolvedBackend> {
    match config.mode.as_str() {
        "local" => resolve_local(config).await,
        "cloud" => resolve_cloud(config),
        "hybrid" => resolve_hybrid(config).await,
        "auto" | _ => resolve_auto(config).await,
    }
}

/// Auto-detect: try hybrid first if both cloud credentials and local DB URL are present,
/// else cloud first, else local.
async fn resolve_auto(config: &ResolvedConfig) -> Result<ResolvedBackend> {
    #[cfg(all(feature = "cloud", feature = "local"))]
    {
        if config.api_key.is_some() && (config.database_url.is_some() || std::env::var("SULCUS_DATABASE_URL").is_ok()) {
            return resolve_hybrid(config).await;
        }
    }

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
        return resolve_local(config).await;
    }

    // Neither available
    #[allow(unreachable_code)]
    {
        anyhow::bail!(
            "No backend available.\n\
             Set SULCUS_API_KEY for cloud mode, or SULCUS_DATABASE_URL for local mode.\n\
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

/// Resolve local PostgreSQL backend from config.
#[cfg(feature = "local")]
async fn resolve_local(config: &ResolvedConfig) -> Result<ResolvedBackend> {
    let store = sulcus_local::LocalStore::open_compat(&config.db_path, &config.namespace)
        .await
        .with_context(|| format!("Failed to open local database connection: {}", config.db_path))?;

    Ok(ResolvedBackend {
        backend: Arc::new(store),
        mode: BackendMode::Local,
    })
}

#[cfg(not(feature = "local"))]
async fn resolve_local(_config: &ResolvedConfig) -> Result<ResolvedBackend> {
    anyhow::bail!(
        "Local mode requested but `local` feature not compiled.\n\
         Rebuild with: cargo build --features local"
    );
}

/// Resolve hybrid backend from config.
#[cfg(all(feature = "cloud", feature = "local"))]
async fn resolve_hybrid(config: &ResolvedConfig) -> Result<ResolvedBackend> {
    let local = resolve_local(config).await?.backend;
    let cloud = resolve_cloud(config)?.backend;

    Ok(ResolvedBackend {
        backend: Arc::new(HybridBackend { local, cloud }),
        mode: BackendMode::Hybrid,
    })
}

#[cfg(not(all(feature = "cloud", feature = "local")))]
async fn resolve_hybrid(_config: &ResolvedConfig) -> Result<ResolvedBackend> {
    anyhow::bail!(
        "Hybrid mode requested but cloud and/or local features not compiled.\n\
         Rebuild with: cargo build --features \"cloud local\""
    );
}
