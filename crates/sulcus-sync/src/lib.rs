//! sulcus-sync: cloud and LAN sync extension for SULCUS.
//!
//! Compiled as a cdylib and loaded at runtime by sulcus's plugin system.
//! Subscribers place `libsulcus_sync.dylib` (macOS) or `libsulcus_sync.so` (Linux)
//! in `~/.sulcus/plugins/` to enable cloud sync.

pub mod discovery;
pub mod sync;
pub mod sync_http;

pub use sync::{spawn_auto_sync_worker, spawn_sync_worker, LocalSyncClient};
pub use sync_http::HttpSyncEngine;

use sulcus::plugin::SulcusPlugin;
use sulcus::{Config, LocalStorage};
use tokio::task::JoinHandle;

struct SulcusSyncPlugin {
    handle: std::sync::Mutex<Option<JoinHandle<()>>>,
    /// The plugin owns its own tokio runtime because dlopen loads a separate
    /// copy of the tokio symbols — the host's runtime handle is not visible here.
    runtime: std::sync::Mutex<Option<tokio::runtime::Runtime>>,
}

impl SulcusPlugin for SulcusSyncPlugin {
    fn start_sync(&self, storage: LocalStorage, _config: Config) {
        // Build a dedicated tokio runtime on a background OS thread.
        // We cannot reuse the host binary's runtime across the dlopen boundary
        // because dlopen loads a separate copy of all tokio symbols — the host
        // runtime handle is invisible from inside the dylib.
        //
        // Spawning a dedicated thread + block_on is the canonical solution for
        // embedding a tokio runtime in a plugin without access to the host runtime.
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .thread_name("sulcus-sync")
            .build()
            .expect("failed to create sulcus-sync tokio runtime");

        // Drive the runtime from a background thread so it doesn't block the caller.
        std::thread::Builder::new()
            .name("sulcus-sync-driver".into())
            .spawn(move || {
                rt.block_on(async move {
                    if let Some(jh) = sync::spawn_auto_sync_worker(storage) {
                        let _ = jh.await;
                    }
                });
            })
            .expect("failed to spawn sulcus-sync driver thread");

        // The runtime and JoinHandle live on the driver thread; we don't hold
        // them here (the thread owns them for the process lifetime).
        // handle/runtime fields are no longer needed but kept for API compat.
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
        // Drop the runtime after aborting the task
        if let Some(rt) = self.runtime.lock().unwrap().take() {
            rt.shutdown_background();
        }
    }

    fn version(&self) -> &'static str {
        env!("CARGO_PKG_VERSION")
    }
}

/// C-ABI entry point. sulcus's PluginLoader calls this symbol after dlopen.
///
/// # Safety
/// The returned pointer is valid for the lifetime of the loaded library.
/// The caller must not free it directly — call `sulcus_sync_destroy` instead.
#[no_mangle]
pub unsafe extern "Rust" fn sulcus_sync_create() -> *mut dyn SulcusPlugin {
    let plugin = Box::new(SulcusSyncPlugin {
        handle: std::sync::Mutex::new(None),
        runtime: std::sync::Mutex::new(None),
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
