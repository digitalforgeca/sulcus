//! Plugin system for loading optional sync extensions (e.g. sulcus-sync).
//!
//! Plugins are Rust dylibs placed in `~/.sulcus/plugins/`. At startup,
//! sulcus-local calls `PluginLoader::try_load()` which attempts to open the
//! sync dylib. If present, the plugin's `start_sync` method is called and
//! cloud + LAN sync becomes available. If absent, the sidecar runs in
//! local-only mode.

use crate::{Config, LocalStorage};

/// Interface that every sulcus plugin dylib must implement.
pub trait SulcusPlugin: Send + Sync {
    /// Start the background sync worker(s).
    fn start_sync(&self, storage: LocalStorage, config: Config);
    /// Hint to trigger an immediate sync cycle (fire-and-forget).
    fn sync_now(&self);
    /// Stop and clean up background workers.
    fn stop(&self);
    /// Human-readable plugin version string.
    fn version(&self) -> &'static str;
}

/// Function pointer type for the plugin entry point.
/// Every sulcus plugin dylib must export a symbol named `sulcus_sync_create`
/// with this signature.
pub type CreatePluginFn = unsafe fn() -> *mut dyn SulcusPlugin;

/// Loads a sulcus plugin dylib from `~/.sulcus/plugins/` and owns the handle.
pub struct PluginLoader {
    // Keep the Library alive so that vtable/code pointers remain valid for
    // the lifetime of the plugin object.
    _lib: Option<libloading::Library>,
    plugin: Option<Box<dyn SulcusPlugin>>,
}

impl PluginLoader {
    /// Try to load the sync plugin from the default location.
    /// Returns a loader with no plugin if the dylib is absent or fails to load.
    pub fn try_load() -> Self {
        let plugin_path = Self::plugin_path();

        if !plugin_path.exists() {
            tracing::info!(
                "cloud sync not available — subscribe at sulcus.ca \
                 (place libsulcus_sync.dylib/.so in ~/.sulcus/plugins/ to enable)"
            );
            return PluginLoader {
                _lib: None,
                plugin: None,
            };
        }

        // SAFETY: We verify the path exists and trust the dylib exported by sulcus-sync.
        // Both the loader and the dylib are compiled from the same workspace, guaranteeing
        // compatible Rust ABIs and vtable layouts for `dyn SulcusPlugin`.
        unsafe {
            match libloading::Library::new(&plugin_path) {
                Ok(lib) => {
                    match lib.get::<CreatePluginFn>(b"sulcus_sync_create\0") {
                        Ok(create_fn) => {
                            let raw = create_fn();
                            if raw.is_null() {
                                tracing::error!("sulcus_sync_create returned null pointer");
                                return PluginLoader {
                                    _lib: Some(lib),
                                    plugin: None,
                                };
                            }
                            let plugin = Box::from_raw(raw);
                            tracing::info!(
                                version = plugin.version(),
                                "sulcus-sync plugin loaded"
                            );
                            PluginLoader {
                                _lib: Some(lib),
                                plugin: Some(plugin),
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                error = %e,
                                path = %plugin_path.display(),
                                "failed to resolve sulcus_sync_create symbol"
                            );
                            PluginLoader {
                                _lib: Some(lib),
                                plugin: None,
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(
                        error = %e,
                        path = %plugin_path.display(),
                        "failed to load sulcus-sync plugin"
                    );
                    PluginLoader {
                        _lib: None,
                        plugin: None,
                    }
                }
            }
        }
    }

    /// Returns a reference to the loaded plugin, if any.
    pub fn plugin(&self) -> Option<&dyn SulcusPlugin> {
        self.plugin.as_deref()
    }

    /// Returns the expected path of the plugin dylib.
    fn plugin_path() -> std::path::PathBuf {
        let mut path = dirs::home_dir().unwrap_or_default();
        path.push(".sulcus");
        path.push("plugins");
        #[cfg(target_os = "macos")]
        path.push("libsulcus_sync.dylib");
        #[cfg(target_os = "linux")]
        path.push("libsulcus_sync.so");
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        path.push("libsulcus_sync.dll");
        path
    }
}

impl Drop for PluginLoader {
    fn drop(&mut self) {
        // Stop the plugin before dropping the library handle so that background
        // threads are joined before the code pages are unmapped.
        if let Some(plugin) = self.plugin.take() {
            plugin.stop();
            drop(plugin);
        }
        // _lib is dropped here, unmapping the dylib
    }
}
