//! Progressive dynamic library loader for sulcus-local.
//!
//! Instead of statically linking the entire dependency tree (580+ crates),
//! sulcus-local loads heavy components as separate cdylibs at runtime:
//!
//! - `libsulcus_embed` — embedding engine (fastembed + ONNX Runtime + tiktoken)
//! - `libsulcus_store` — storage engine (pg-embed + SQLx)
//! - `libsulcus_sync`  — cloud sync (paywalled, optional)
//!
//! Each library is loaded independently and reports its status through the
//! `ProgressiveLoader`. This gives us:
//!
//! 1. **Fast rebuilds** — change core logic, rebuild in seconds (not 15 min)
//! 2. **Progressive startup** — MCP server starts immediately, components
//!    become available as they load
//! 3. **Feedback** — callers can query which components are ready
//! 4. **Isolation** — a crash in the embedding engine doesn't take down storage

use std::ffi::{c_char, CStr};
use std::path::PathBuf;

/// Status of a loadable component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ComponentStatus {
    /// Not yet attempted to load.
    Pending,
    /// Currently loading (download or dlopen in progress).
    Loading,
    /// Loaded and ready to use.
    Ready,
    /// Failed to load (missing dylib, symbol error, etc).
    Failed,
    /// Not available on this platform / not installed.
    Unavailable,
}

impl std::fmt::Display for ComponentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Loading => write!(f, "loading"),
            Self::Ready => write!(f, "ready"),
            Self::Failed => write!(f, "failed"),
            Self::Unavailable => write!(f, "unavailable"),
        }
    }
}

/// A loaded component with its library handle and function pointers.
struct LoadedComponent {
    _lib: libloading::Library,
    version: String,
}

/// Tracks the state of all dynamically-loaded components.
pub struct ProgressiveLoader {
    embed: ComponentState,
    store: ComponentState,
    sync: ComponentState,
}

struct ComponentState {
    status: ComponentStatus,
    loaded: Option<LoadedComponent>,
    error: Option<String>,
}

impl ComponentState {
    fn new() -> Self {
        ComponentState {
            status: ComponentStatus::Pending,
            loaded: None,
            error: None,
        }
    }
}

impl ProgressiveLoader {
    /// Create a new loader with all components in Pending state.
    pub fn new() -> Self {
        ProgressiveLoader {
            embed: ComponentState::new(),
            store: ComponentState::new(),
            sync: ComponentState::new(),
        }
    }

    /// Load the embedding engine dylib.
    pub fn load_embed(&mut self) -> ComponentStatus {
        self.embed.status = ComponentStatus::Loading;
        tracing::info!("loading sulcus-embed...");

        let path = dylib_path("sulcus_embed");
        match load_and_verify(&path, "sulcus_embed_version") {
            Ok(component) => {
                tracing::info!(version = %component.version, "sulcus-embed loaded");
                self.embed.loaded = Some(component);
                self.embed.status = ComponentStatus::Ready;
                ComponentStatus::Ready
            }
            Err(e) => {
                tracing::warn!(error = %e, "sulcus-embed not available — embeddings disabled");
                self.embed.error = Some(e.to_string());
                self.embed.status = ComponentStatus::Failed;
                ComponentStatus::Failed
            }
        }
    }

    /// Load the storage engine dylib.
    pub fn load_store(&mut self) -> ComponentStatus {
        self.store.status = ComponentStatus::Loading;
        tracing::info!("loading sulcus-store...");

        let path = dylib_path("sulcus_store");
        match load_and_verify(&path, "sulcus_store_version") {
            Ok(component) => {
                tracing::info!(version = %component.version, "sulcus-store loaded");
                self.store.loaded = Some(component);
                self.store.status = ComponentStatus::Ready;
                ComponentStatus::Ready
            }
            Err(e) => {
                tracing::warn!(error = %e, "sulcus-store not available — storage disabled");
                self.store.error = Some(e.to_string());
                self.store.status = ComponentStatus::Failed;
                ComponentStatus::Failed
            }
        }
    }

    /// Load the sync plugin dylib (paywalled).
    pub fn load_sync(&mut self) -> ComponentStatus {
        self.sync.status = ComponentStatus::Loading;
        tracing::info!("loading sulcus-sync...");

        let path = sync_dylib_path();
        match load_and_verify(&path, "sulcus_sync_version") {
            Ok(component) => {
                tracing::info!(version = %component.version, "sulcus-sync loaded");
                self.sync.loaded = Some(component);
                self.sync.status = ComponentStatus::Ready;
                ComponentStatus::Ready
            }
            Err(_) => {
                // Sync is optional / paywalled — not a failure, just unavailable
                tracing::info!("sulcus-sync not found — running in local-only mode");
                self.sync.status = ComponentStatus::Unavailable;
                ComponentStatus::Unavailable
            }
        }
    }

    /// Load all components and report progress. Returns a summary.
    pub fn load_all(&mut self) -> LoadReport {
        let embed = self.load_embed();
        let store = self.load_store();
        let sync = self.load_sync();

        LoadReport { embed, store, sync }
    }

    /// Get current status of all components.
    pub fn status(&self) -> LoadReport {
        LoadReport {
            embed: self.embed.status,
            store: self.store.status,
            sync: self.sync.status,
        }
    }

    /// Get the raw library handle for the embed component (for FFI calls).
    pub fn embed_lib(&self) -> Option<&libloading::Library> {
        self.embed.loaded.as_ref().map(|c| &c._lib)
    }

    /// Get the raw library handle for the store component (for FFI calls).
    pub fn store_lib(&self) -> Option<&libloading::Library> {
        self.store.loaded.as_ref().map(|c| &c._lib)
    }

    /// Get the raw library handle for the sync component (for FFI calls).
    pub fn sync_lib(&self) -> Option<&libloading::Library> {
        self.sync.loaded.as_ref().map(|c| &c._lib)
    }
}

/// Summary of a load operation.
#[derive(Debug, serde::Serialize)]
pub struct LoadReport {
    pub embed: ComponentStatus,
    pub store: ComponentStatus,
    pub sync: ComponentStatus,
}

impl std::fmt::Display for LoadReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "embed: {} | store: {} | sync: {}",
            self.embed, self.store, self.sync
        )
    }
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Construct the platform-specific dylib path for a component.
/// Searches: same dir as exe, ~/.sulcus/lib/, /usr/local/lib/
fn dylib_path(name: &str) -> PathBuf {
    let filename = dylib_filename(name);

    // 1. Next to the executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(&filename);
            if candidate.exists() {
                return candidate;
            }
        }
    }

    // 2. ~/.sulcus/lib/
    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".sulcus").join("lib").join(&filename);
        if candidate.exists() {
            return candidate;
        }
    }

    // 3. /usr/local/lib/
    let candidate = PathBuf::from("/usr/local/lib").join(&filename);
    if candidate.exists() {
        return candidate;
    }

    // Fallback: return the home path (will fail with a nice error)
    dirs::home_dir()
        .unwrap_or_default()
        .join(".sulcus")
        .join("lib")
        .join(&filename)
}

/// The sync plugin lives in ~/.sulcus/plugins/ (existing convention).
fn sync_dylib_path() -> PathBuf {
    let filename = dylib_filename("sulcus_sync");
    dirs::home_dir()
        .unwrap_or_default()
        .join(".sulcus")
        .join("plugins")
        .join(filename)
}

fn dylib_filename(name: &str) -> String {
    #[cfg(target_os = "macos")]
    return format!("lib{name}.dylib");
    #[cfg(target_os = "linux")]
    return format!("lib{name}.so");
    #[cfg(windows)]
    return format!("{name}.dll");
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    return format!("lib{name}.so");
}

/// Load a dylib and verify it exports the expected version symbol.
fn load_and_verify(
    path: &PathBuf,
    version_symbol: &str,
) -> anyhow::Result<LoadedComponent> {
    if !path.exists() {
        anyhow::bail!("dylib not found: {}", path.display());
    }

    // SAFETY: We trust our own dylibs (built from the same workspace).
    let lib = unsafe { libloading::Library::new(path) }
        .map_err(|e| anyhow::anyhow!("dlopen failed for {}: {}", path.display(), e))?;

    let version = unsafe {
        let version_fn: libloading::Symbol<unsafe extern "C" fn() -> *const c_char> =
            lib.get(version_symbol.as_bytes())
                .map_err(|e| anyhow::anyhow!("symbol {} not found: {}", version_symbol, e))?;
        let ptr = version_fn();
        if ptr.is_null() {
            anyhow::bail!("{} returned null", version_symbol);
        }
        CStr::from_ptr(ptr).to_string_lossy().into_owned()
    };

    Ok(LoadedComponent {
        _lib: lib,
        version,
    })
}
