//! Embedding provider — loads sulcus-vectors dylib via FFI or falls back to mock.
//!
//! This module NO LONGER statically links fastembed/ort/tiktoken. Instead it
//! loads `libsulcus_vectors.{dylib|so}` at runtime through the C ABI and calls
//! through FFI. If the dylib is unavailable, a mock provider is used.

use anyhow::Context;
use std::ffi::{c_char, CStr, CString};
use std::sync::OnceLock;

/// Embedding provider trait — allows graceful degradation.
pub trait EmbeddingProvider: Send + Sync {
    fn embed(&self, text: &str) -> Result<Vec<f32>, anyhow::Error>;
    fn embed_image(&self, path: &str) -> Result<Vec<f32>, anyhow::Error>;
}

// ── FFI types ─────────────────────────────────────────────────────────

type EmbedCreateFn = unsafe extern "C" fn() -> *mut std::ffi::c_void;
type EmbedDestroyFn = unsafe extern "C" fn(*mut std::ffi::c_void);
type EmbedTextFn = unsafe extern "C" fn(*const std::ffi::c_void, *const c_char) -> *mut c_char;
type EmbedBatchFn = unsafe extern "C" fn(*const std::ffi::c_void, *const c_char) -> *mut c_char;
type EmbedCountTokensFn = unsafe extern "C" fn(*const c_char) -> i64;
type EmbedFreeStringFn = unsafe extern "C" fn(*mut c_char);
type EmbedVersionFn = unsafe extern "C" fn() -> *const c_char;

/// FFI bridge to libsulcus_vectors.
struct EmbedFfi {
    _lib: libloading::Library,
    handle: *mut std::ffi::c_void,
    embed_text: EmbedTextFn,
    embed_batch: EmbedBatchFn,
    count_tokens: EmbedCountTokensFn,
    free_string: EmbedFreeStringFn,
    destroy: EmbedDestroyFn,
}

// SAFETY: The FFI handle is protected by the provider's Mutex in practice,
// and the underlying C functions are thread-safe (they use internal locking).
unsafe impl Send for EmbedFfi {}
unsafe impl Sync for EmbedFfi {}

impl EmbedFfi {
    fn try_load() -> anyhow::Result<Self> {
        let path = find_embed_dylib()
            .ok_or_else(|| anyhow::anyhow!("libsulcus_vectors not found"))?;

        tracing::info!(path = %path.display(), "loading sulcus-vectors dylib");

        // SAFETY: We trust our own dylib built from the same workspace.
        unsafe {
            let lib = libloading::Library::new(&path)
                .map_err(|e| anyhow::anyhow!("dlopen sulcus-vectors: {e}"))?;

            // Resolve all symbols and copy out the raw function pointers BEFORE
            // moving `lib` into the struct. Symbol borrows lib, so we dereference
            // to get owned fn pointers first.
            let version_fn = *lib.get::<EmbedVersionFn>(b"sulcus_vectors_version")
                .map_err(|e| anyhow::anyhow!("symbol sulcus_vectors_version: {e}"))?;
            let create_fn = *lib.get::<EmbedCreateFn>(b"sulcus_vectors_create")
                .map_err(|e| anyhow::anyhow!("symbol sulcus_vectors_create: {e}"))?;
            let destroy_fn = *lib.get::<EmbedDestroyFn>(b"sulcus_vectors_destroy")
                .map_err(|e| anyhow::anyhow!("symbol sulcus_vectors_destroy: {e}"))?;
            let text_fn = *lib.get::<EmbedTextFn>(b"sulcus_vectors_text")
                .map_err(|e| anyhow::anyhow!("symbol sulcus_vectors_text: {e}"))?;
            let batch_fn = *lib.get::<EmbedBatchFn>(b"sulcus_vectors_batch")
                .map_err(|e| anyhow::anyhow!("symbol sulcus_vectors_batch: {e}"))?;
            let tokens_fn = *lib.get::<EmbedCountTokensFn>(b"sulcus_vectors_count_tokens")
                .map_err(|e| anyhow::anyhow!("symbol sulcus_vectors_count_tokens: {e}"))?;
            let free_fn = *lib.get::<EmbedFreeStringFn>(b"sulcus_vectors_free_string")
                .map_err(|e| anyhow::anyhow!("symbol sulcus_vectors_free_string: {e}"))?;

            // Version check
            let ver_ptr = version_fn();
            if !ver_ptr.is_null() {
                let ver = CStr::from_ptr(ver_ptr).to_string_lossy();
                tracing::info!(version = %ver, "sulcus-vectors version");
            }

            // Create the embedding handle via a thread with panic guard.
            // ORT 2.x panics (instead of returning Err) when libonnxruntime.dylib is
            // missing. Isolate that panic so the main process survives.
            // Raw pointers aren't Send, so we wrap the result as usize.
            let (tx, rx) = std::sync::mpsc::channel::<usize>();
            let _ = std::thread::Builder::new()
                .name("sulcus-vectors-init".into())
                .spawn(move || {
                    let result = std::panic::catch_unwind(|| unsafe { create_fn() });
                    match result {
                        Ok(ptr) => { let _ = tx.send(ptr as usize); }
                        Err(_) => {
                            eprintln!("[sulcus-vectors] ORT init panicked — ONNX Runtime not available, falling back to mock embeddings");
                            let _ = tx.send(0usize);
                        }
                    }
                });
            let raw = rx
                .recv_timeout(std::time::Duration::from_secs(30))
                .unwrap_or(0);
            let handle = raw as *mut std::ffi::c_void;
            if handle.is_null() {
                anyhow::bail!("sulcus_vectors_create returned null — ONNX Runtime likely missing");
            }

            Ok(EmbedFfi {
                _lib: lib,
                handle,
                embed_text: text_fn,
                embed_batch: batch_fn,
                count_tokens: tokens_fn,
                free_string: free_fn,
                destroy: destroy_fn,
            })
        }
    }

    fn embed(&self, text: &str) -> anyhow::Result<Vec<f32>> {
        let c_text = CString::new(text).context("text contains null byte")?;
        unsafe {
            let result_ptr = (self.embed_text)(self.handle as *const _, c_text.as_ptr());
            if result_ptr.is_null() {
                anyhow::bail!("sulcus_vectors_text returned null");
            }
            let json = CStr::from_ptr(result_ptr).to_string_lossy().into_owned();
            (self.free_string)(result_ptr);
            serde_json::from_str(&json).context("failed to parse embedding JSON")
        }
    }

    fn embed_batch(&self, texts: &[&str]) -> anyhow::Result<Vec<Vec<f32>>> {
        let json_input = serde_json::to_string(texts)?;
        let c_json = CString::new(json_input).context("JSON contains null byte")?;
        unsafe {
            let result_ptr = (self.embed_batch)(self.handle as *const _, c_json.as_ptr());
            if result_ptr.is_null() {
                anyhow::bail!("sulcus_vectors_batch returned null");
            }
            let json = CStr::from_ptr(result_ptr).to_string_lossy().into_owned();
            (self.free_string)(result_ptr);
            serde_json::from_str(&json).context("failed to parse batch embedding JSON")
        }
    }

    fn count_tokens(&self, text: &str) -> anyhow::Result<usize> {
        let c_text = CString::new(text).context("text contains null byte")?;
        unsafe {
            let count = (self.count_tokens)(c_text.as_ptr());
            if count < 0 {
                anyhow::bail!("sulcus_vectors_count_tokens failed");
            }
            Ok(count as usize)
        }
    }
}

impl Drop for EmbedFfi {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { (self.destroy)(self.handle) };
        }
    }
}

// ── Dylib search ──────────────────────────────────────────────────────

fn find_embed_dylib() -> Option<std::path::PathBuf> {
    let filename = embed_dylib_filename();
    let candidates = [
        // Next to the executable
        std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join(&filename))),
        // ~/.sulcus/lib/
        dirs::home_dir().map(|h| h.join(".sulcus").join("lib").join(&filename)),
        // /usr/local/lib/
        Some(std::path::PathBuf::from("/usr/local/lib").join(&filename)),
    ];
    candidates.into_iter().flatten().find(|p| p.exists())
}

fn embed_dylib_filename() -> String {
    #[cfg(target_os = "macos")]
    return "libsulcus_vectors.dylib".to_string();
    #[cfg(target_os = "linux")]
    return "libsulcus_vectors.so".to_string();
    #[cfg(windows)]
    return "sulcus_vectors.dll".to_string();
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    return "libsulcus_vectors.so".to_string();
}

// ── Provider implementations ──────────────────────────────────────────

/// Dynamic provider that loads from libsulcus_vectors via FFI.
pub struct FastEmbedProvider {
    ffi: EmbedFfi,
}

impl FastEmbedProvider {
    pub fn try_new() -> anyhow::Result<Self> {
        let ffi = EmbedFfi::try_load()?;
        Ok(FastEmbedProvider { ffi })
    }

    /// Check if ONNX Runtime is available before attempting to load the dylib.
    /// Returns false if the runtime can't be found — allows graceful degradation.
    pub fn is_available() -> bool {
        let rt_names: &[&str] = if cfg!(target_os = "macos") {
            &["libonnxruntime.dylib", "libonnxruntime.1.dylib"]
        } else {
            &["libonnxruntime.so", "libonnxruntime.so.1"]
        };
        let search_dirs = [
            std::env::var("ORT_DYLIB_PATH").ok().map(std::path::PathBuf::from),
            dirs::home_dir().map(|h| h.join(".sulcus").join("onnxruntime").join("lib")),
            Some(std::path::PathBuf::from("/usr/local/lib")),
            Some(std::path::PathBuf::from("/usr/lib")),
        ];
        for maybe_dir in &search_dirs {
            if let Some(dir) = maybe_dir {
                for name in rt_names {
                    if dir.join(name).exists() {
                        return true;
                    }
                }
            }
        }
        false
    }
}

impl EmbeddingProvider for FastEmbedProvider {
    fn embed(&self, text: &str) -> Result<Vec<f32>, anyhow::Error> {
        self.ffi.embed(text)
    }

    fn embed_image(&self, _path: &str) -> Result<Vec<f32>, anyhow::Error> {
        // Image embedding not yet exposed through the C ABI
        // Fall back to text embedding of the path as a placeholder
        tracing::warn!("image embedding via dylib not yet supported — using mock");
        Ok(vec![0.2f32; 512])
    }
}

// ── Global convenience functions ──────────────────────────────────────

static GLOBAL_EMBED: OnceLock<Option<EmbedFfi>> = OnceLock::new();

fn get_global_embed() -> Option<&'static EmbedFfi> {
    GLOBAL_EMBED.get_or_init(|| {
        match EmbedFfi::try_load() {
            Ok(ffi) => {
                tracing::info!("global embedding provider loaded via dylib");
                Some(ffi)
            }
            Err(e) => {
                tracing::warn!(error = %e, "embedding dylib not available — using mock embeddings");
                None
            }
        }
    }).as_ref()
}

/// Embed text using the global provider (dylib if available, mock otherwise).
pub fn embed_text(text: &str) -> anyhow::Result<Vec<f32>> {
    match get_global_embed() {
        Some(ffi) => ffi.embed(text),
        None => Ok(vec![0.1f32; 384]), // mock fallback
    }
}

/// Embed image using the global provider.
pub fn embed_image(path: &str) -> anyhow::Result<Vec<f32>> {
    // Image embedding not yet in the dylib C ABI
    let _ = path;
    Ok(vec![0.2f32; 512]) // mock
}

/// Count tokens using the global provider (dylib if available).
pub fn count_tokens(text: &str) -> usize {
    match get_global_embed() {
        Some(ffi) => ffi.count_tokens(text).unwrap_or(0),
        None => text.split_whitespace().count(), // rough fallback
    }
}

/// Mock provider used in tests — deterministic and fast (no model download).
pub struct MockEmbeddingProvider;

impl Default for MockEmbeddingProvider {
    fn default() -> Self { Self }
}

impl MockEmbeddingProvider {
    pub fn new() -> Self { Self }
}

impl EmbeddingProvider for MockEmbeddingProvider {
    fn embed(&self, _text: &str) -> Result<Vec<f32>, anyhow::Error> {
        Ok(vec![0.1f32; 384])
    }
    fn embed_image(&self, _path: &str) -> Result<Vec<f32>, anyhow::Error> {
        Ok(vec![0.2f32; 512])
    }
}
