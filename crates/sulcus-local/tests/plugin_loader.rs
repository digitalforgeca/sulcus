/// Integration test for the plugin loader: verifies that a locally-built
/// sulcus-sync cdylib can be loaded, symbols resolved, and the plugin
/// created/destroyed without crashing.
///
/// Requires: cargo build --release -p sulcus-sync (the dylib must exist)
use std::path::PathBuf;

fn dylib_path() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop(); // crates/
    path.pop(); // repo root
    path.push("target");
    path.push("release");

    #[cfg(target_os = "macos")]
    path.push("libsulcus_sync.dylib");
    #[cfg(target_os = "linux")]
    path.push("libsulcus_sync.so");

    path
}

#[test]
fn test_dylib_exists_and_has_correct_symbols() {
    let path = dylib_path();
    if !path.exists() {
        eprintln!(
            "Skipping plugin_loader test: {} not found. Run: cargo build --release -p sulcus-sync",
            path.display()
        );
        return;
    }

    // Load the library and verify symbols
    unsafe {
        let lib = libloading::Library::new(&path).expect("failed to load dylib");

        // Check sulcus_sync_create
        let create: libloading::Symbol<unsafe fn() -> *mut ()> = lib
            .get(b"sulcus_sync_create\0")
            .expect("sulcus_sync_create symbol not found");

        // Check sulcus_sync_destroy
        let destroy: libloading::Symbol<unsafe fn(*mut ())> = lib
            .get(b"sulcus_sync_destroy\0")
            .expect("sulcus_sync_destroy symbol not found");

        // Create and immediately destroy (smoke test)
        let ptr = create();
        assert!(!ptr.is_null(), "sulcus_sync_create returned null");
        destroy(ptr);
    }
}

#[test]
fn test_plugin_version_accessible() {
    let path = dylib_path();
    if !path.exists() {
        eprintln!(
            "Skipping: {} not found",
            path.display()
        );
        return;
    }

    // Use the actual SulcusPlugin trait — the create function returns a trait object
    unsafe {
        let lib = libloading::Library::new(&path).expect("failed to load dylib");

        type CreateFn = unsafe fn() -> *mut dyn sulcus_local::plugin::SulcusPlugin;

        let create: libloading::Symbol<CreateFn> = lib
            .get(b"sulcus_sync_create\0")
            .expect("symbol not found");

        let raw = create();
        assert!(!raw.is_null());

        let plugin = Box::from_raw(raw);
        let version = plugin.version();
        assert!(
            !version.is_empty(),
            "plugin version should not be empty"
        );
        assert_eq!(version, "0.1.0", "expected version 0.1.0");

        plugin.stop();
        drop(plugin);
    }
}
