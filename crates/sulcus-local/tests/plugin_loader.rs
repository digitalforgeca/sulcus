/// Integration test for the plugin loader: verifies that a locally-built
/// sulcus-sync cdylib can be loaded, symbols resolved, and the plugin
/// created/destroyed without crashing.
///
/// Requires: cargo build --release -p sulcus-sync (the dylib must exist)
use sulcus_local::plugin::CreatePluginFn;
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

    // Load the library and verify symbols using the correct fat-pointer function type.
    // sulcus_sync_create returns *mut dyn SulcusPlugin (16 bytes on 64-bit).
    // Using *mut () would corrupt the stack — always use CreatePluginFn here.
    unsafe {
        let lib = libloading::Library::new(&path).expect("failed to load dylib");

        let create: libloading::Symbol<CreatePluginFn> = lib
            .get(b"sulcus_sync_create\0")
            .expect("sulcus_sync_create symbol not found");

        let raw = create();
        assert!(!raw.is_null(), "sulcus_sync_create returned null");

        // Destroy via the trait's stop + drop to avoid leaking.
        // We use Box::from_raw here since the dylib and test share the same workspace
        // and are compiled against identical trait definitions.
        let plugin = Box::from_raw(raw);
        plugin.stop();
        drop(plugin);
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

    unsafe {
        let lib = libloading::Library::new(&path).expect("failed to load dylib");

        let create: libloading::Symbol<CreatePluginFn> = lib
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
