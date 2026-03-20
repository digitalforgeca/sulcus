//! sulcus-sync: cloud and LAN sync extension for SULCUS.
//!
//! Compiled as a cdylib and loaded at runtime by sulcus-local's plugin system.
//! Subscribers place `libsulcus_sync.dylib` (macOS) or `libsulcus_sync.so` (Linux)
//! in `~/.sulcus/plugins/` to enable cloud sync.

pub mod discovery;
pub mod sync;
pub mod sync_http;

pub use sync::{spawn_auto_sync_worker, spawn_sync_worker, LocalSyncClient};
pub use sync_http::HttpSyncEngine;

use sulcus_local::plugin::SulcusPlugin;
use sulcus_local::{Config, LocalStorage};
use std::sync::Arc;
use tokio::task::JoinHandle;

struct SulcusSyncPlugin {
    handle: std::sync::Mutex<Option<JoinHandle<()>>>,
}

impl SulcusPlugin for SulcusSyncPlugin {
    fn start_sync(&self, storage: LocalStorage, _config: Config) {
        let handle = sync::spawn_auto_sync_worker(storage);
        *self.handle.lock().unwrap() = handle;
    }

    fn sync_now(&self) {
        // The background worker handles periodic sync; triggering an immediate
        // out-of-band sync requires more plumbing (channels). For now this is a no-op
        // that callers can use as a hint — the next scheduled sync will fire shortly.
        tracing::info!("sulcus-sync: sync_now hint received (next worker cycle will sync)");
    }

    fn stop(&self) {
        if let Some(handle) = self.handle.lock().unwrap().take() {
            handle.abort();
        }
    }

    fn version(&self) -> &'static str {
        env!("CARGO_PKG_VERSION")
    }
}

/// C-ABI entry point. sulcus-local's PluginLoader calls this symbol after dlopen.
///
/// # Safety
/// The returned pointer is valid for the lifetime of the loaded library.
/// The caller must not free it directly — call `sulcus_sync_destroy` instead.
#[no_mangle]
pub unsafe extern "Rust" fn sulcus_sync_create() -> *mut dyn SulcusPlugin {
    let plugin = Box::new(SulcusSyncPlugin {
        handle: std::sync::Mutex::new(None),
    });
    Box::into_raw(plugin) as *mut dyn SulcusPlugin
}

/// Destroy a plugin previously returned by `sulcus_sync_create`.
///
/// # Safety
/// `ptr` must have been returned by `sulcus_sync_create` and not yet destroyed.
#[no_mangle]
pub unsafe extern "Rust" fn sulcus_sync_destroy(ptr: *mut dyn SulcusPlugin) {
    if !ptr.is_null() {
        let plugin = Box::from_raw(ptr);
        plugin.stop();
        drop(plugin);
    }
}

// Re-export Arc for convenience in the plugin init path
pub use std::sync::Arc as StdArc;
