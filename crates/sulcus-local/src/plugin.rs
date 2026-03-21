//! Plugin system for loading optional sync extensions (e.g. sulcus-sync).
//!
//! Plugins are Rust dylibs placed in `~/.sulcus/plugins/`. At startup,
//! sulcus-local calls `PluginLoader::try_load()` which attempts to open the
//! sync dylib. If present, the plugin's `start_sync` method is called and
//! cloud + LAN sync becomes available. If absent, the sidecar runs in
//! local-only mode.
//!
//! When `SULCUS_SERVER_URL` and `SULCUS_API_KEY` are set in the environment,
//! `PluginLoader::try_download_plugin` will fetch the encrypted dylib from the
//! server, decrypt it locally (AES-256-GCM, key derived via HKDF-SHA256 from
//! the API key), verify integrity, and write it to `~/.sulcus/plugins/`.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};

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

#[derive(serde::Deserialize)]
struct ExtensionDownloadResponse {
    version: String,
    #[allow(dead_code)]
    platform: String,
    /// Hex-encoded 12-byte AES-GCM nonce.
    nonce: String,
    /// Base64-encoded AES-256-GCM ciphertext.
    encrypted_blob: String,
    /// Hex-encoded SHA-256 of the plaintext binary.
    sha256_plaintext: String,
}

/// Returns the platform identifier for the current build target.
/// Returns `None` on unsupported platforms.
fn current_platform() -> Option<&'static str> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("darwin-arm64")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("darwin-x86_64")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("linux-x86_64")
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("linux-aarch64")
    } else {
        None
    }
}

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
                Ok(lib) => match lib.get::<CreatePluginFn>(b"sulcus_sync_create\0") {
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
                        tracing::info!(version = plugin.version(), "sulcus-sync plugin loaded");
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
                },
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

    /// Download, decrypt, and install the sulcus-sync plugin dylib from the server.
    ///
    /// - Detects the current platform at compile time.
    /// - Fetches `GET {server_url}/api/v1/extensions/sync?platform={platform}` with Bearer auth.
    /// - Derives the decryption key: HKDF-SHA256(IKM=api_key, salt="sulcus-sync-v1", info=platform).
    /// - Decrypts the blob with AES-256-GCM.
    /// - Verifies SHA-256 of the decrypted binary.
    /// - Writes the binary to `~/.sulcus/plugins/libsulcus_sync.{ext}` with mode 0o755.
    pub async fn try_download_plugin(api_key: &str, server_url: &str) -> anyhow::Result<()> {
        let platform = current_platform()
            .ok_or_else(|| anyhow::anyhow!("unsupported platform for plugin download"))?;

        let url = format!(
            "{}/api/v1/extensions/sync?platform={}",
            server_url.trim_end_matches('/'),
            platform
        );

        tracing::info!(url = %url, platform = %platform, "downloading sulcus-sync plugin");

        let client = reqwest::Client::builder().use_rustls_tls().build()?;

        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("extension download failed: {} — {}", status, body);
        }

        let data: ExtensionDownloadResponse = resp.json().await?;

        // Decode nonce (12 bytes)
        let nonce_bytes = hex::decode(&data.nonce)
            .map_err(|_| anyhow::anyhow!("invalid nonce hex in server response"))?;
        if nonce_bytes.len() != 12 {
            anyhow::bail!("nonce must be 12 bytes, got {}", nonce_bytes.len());
        }

        // Decode ciphertext
        let ciphertext = general_purpose::STANDARD
            .decode(&data.encrypted_blob)
            .map_err(|_| anyhow::anyhow!("invalid base64 encrypted_blob in server response"))?;

        // Derive decryption key: HKDF-SHA256(IKM=api_key, salt="sulcus-sync-v1", info=platform)
        let hk = Hkdf::<Sha256>::new(Some(b"sulcus-sync-v1"), api_key.as_bytes());
        let mut okm = [0u8; 32];
        hk.expand(platform.as_bytes(), &mut okm)
            .map_err(|_| anyhow::anyhow!("HKDF expand failed"))?;

        // Decrypt with AES-256-GCM
        let key = Key::<Aes256Gcm>::from_slice(&okm);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
            anyhow::anyhow!("AES-GCM decryption failed — key mismatch or corrupt blob")
        })?;

        // Verify SHA-256 integrity
        let mut sha_hasher = Sha256::new();
        sha_hasher.update(&plaintext);
        let computed = hex::encode(sha_hasher.finalize());
        if computed != data.sha256_plaintext {
            anyhow::bail!(
                "SHA-256 mismatch: server={} local={}",
                data.sha256_plaintext,
                computed
            );
        }

        // Write to plugin directory
        let plugin_path = Self::plugin_path();
        if let Some(parent) = plugin_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&plugin_path, &plaintext)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&plugin_path, std::fs::Permissions::from_mode(0o755))?;
        }

        tracing::info!(
            path = %plugin_path.display(),
            version = %data.version,
            platform = %platform,
            "sulcus-sync plugin downloaded and installed"
        );

        Ok(())
    }

    /// Returns a reference to the loaded plugin, if any.
    pub fn plugin(&self) -> Option<&dyn SulcusPlugin> {
        self.plugin.as_deref()
    }

    /// Returns the expected path of the plugin dylib.
    pub fn plugin_path() -> std::path::PathBuf {
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
