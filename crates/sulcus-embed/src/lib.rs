//! sulcus-embed — shared library for embedding operations.
//!
//! This cdylib isolates the heaviest dependency chain (fastembed + ONNX Runtime +
//! tiktoken) so that it only needs to be compiled once and can be loaded at runtime.
//! The main `sulcus-local` binary loads this via `dlopen` through the progressive
//! loader, keeping its own compile times fast.

use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::OnceCell;

// ── Public C ABI ──────────────────────────────────────────────────────

/// Create the embedding provider. Returns a heap-allocated trait object.
/// The caller (sulcus-local) owns the pointer and must free it with
/// `sulcus_embed_destroy`.
///
/// # Safety
/// Returns a raw pointer. Caller must eventually call `sulcus_embed_destroy`.
#[no_mangle]
pub unsafe extern "C" fn sulcus_embed_create() -> *mut EmbedHandle {
    match EmbedHandle::new() {
        Ok(handle) => Box::into_raw(Box::new(handle)),
        Err(e) => {
            tracing::error!(error = %e, "failed to create embedding provider");
            std::ptr::null_mut()
        }
    }
}

/// Destroy an embedding handle returned by `sulcus_embed_create`.
///
/// # Safety
/// Must be a valid pointer returned by `sulcus_embed_create` and not yet freed.
#[no_mangle]
pub unsafe extern "C" fn sulcus_embed_destroy(handle: *mut EmbedHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// Embed a single text string. Returns a JSON-encoded `Vec<f32>`.
/// The returned pointer is a heap-allocated CString that must be freed
/// with `sulcus_embed_free_string`.
///
/// # Safety
/// `handle` must be a valid pointer. `text` must be a valid null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn sulcus_embed_text(
    handle: *const EmbedHandle,
    text: *const std::ffi::c_char,
) -> *mut std::ffi::c_char {
    if handle.is_null() || text.is_null() {
        return std::ptr::null_mut();
    }
    let handle = &*handle;
    let c_str = std::ffi::CStr::from_ptr(text);
    let text = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };

    match handle.embed(text) {
        Ok(embedding) => {
            let json = serde_json::to_string(&embedding).unwrap_or_default();
            match std::ffi::CString::new(json) {
                Ok(c) => c.into_raw(),
                Err(_) => std::ptr::null_mut(),
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "embedding failed");
            std::ptr::null_mut()
        }
    }
}

/// Embed multiple texts. Returns a JSON-encoded `Vec<Vec<f32>>`.
///
/// # Safety
/// `texts_json` must be a valid null-terminated JSON array of strings.
#[no_mangle]
pub unsafe extern "C" fn sulcus_embed_batch(
    handle: *const EmbedHandle,
    texts_json: *const std::ffi::c_char,
) -> *mut std::ffi::c_char {
    if handle.is_null() || texts_json.is_null() {
        return std::ptr::null_mut();
    }
    let handle = &*handle;
    let c_str = std::ffi::CStr::from_ptr(texts_json);
    let json_str = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    let texts: Vec<String> = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return std::ptr::null_mut(),
    };

    match handle.embed_batch(&texts) {
        Ok(embeddings) => {
            let json = serde_json::to_string(&embeddings).unwrap_or_default();
            match std::ffi::CString::new(json) {
                Ok(c) => c.into_raw(),
                Err(_) => std::ptr::null_mut(),
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "batch embedding failed");
            std::ptr::null_mut()
        }
    }
}

/// Count tokens in a string (tiktoken cl100k_base).
///
/// # Safety
/// `text` must be a valid null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn sulcus_embed_count_tokens(
    text: *const std::ffi::c_char,
) -> i64 {
    if text.is_null() {
        return -1;
    }
    let c_str = std::ffi::CStr::from_ptr(text);
    let text = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    count_tokens_inner(text) as i64
}

/// Free a string returned by any `sulcus_embed_*` function.
///
/// # Safety
/// Must be a valid pointer returned by this library and not yet freed.
#[no_mangle]
pub unsafe extern "C" fn sulcus_embed_free_string(s: *mut std::ffi::c_char) {
    if !s.is_null() {
        drop(std::ffi::CString::from_raw(s));
    }
}

/// Return the version of this dylib as a static string.
#[no_mangle]
pub extern "C" fn sulcus_embed_version() -> *const std::ffi::c_char {
    static VERSION: &[u8] = b"0.1.0\0";
    VERSION.as_ptr() as *const std::ffi::c_char
}

// ── Internal Implementation ───────────────────────────────────────────

static ONNX_LOADED: OnceCell<bool> = OnceCell::new();

fn ensure_onnx_runtime() -> anyhow::Result<()> {
    ONNX_LOADED.get_or_try_init::<_, anyhow::Error>(|| {
        // Search for ONNX Runtime dylib in standard locations
        let candidates = candidate_onnx_dylib_paths();
        for path in &candidates {
            if path.exists() {
                // ort's load-dynamic feature will find it via ORT_DYLIB_PATH or LD_LIBRARY_PATH
                std::env::set_var("ORT_DYLIB_PATH", path);
                tracing::info!(path = %path.display(), "found ONNX Runtime");
                return Ok(true);
            }
        }
        tracing::warn!("ONNX Runtime not found in expected locations — fastembed will attempt download");
        Ok(true)
    })?;
    Ok(())
}

fn candidate_onnx_dylib_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "macos")]
    let lib_names = &["libonnxruntime.dylib"];
    #[cfg(target_os = "linux")]
    let lib_names = &["libonnxruntime.so", "libonnxruntime.so.1"];
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let lib_names = &["libonnxruntime.dylib", "libonnxruntime.so"];

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in lib_names {
                candidates.push(dir.join(name));
                candidates.push(dir.join("lib").join(name));
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        let roots = [
            home.join(".sulcus").join("onnxruntime"),
            home.join(".sulcus").join("local").join("onnxruntime"),
        ];
        for root in roots {
            for name in lib_names {
                candidates.push(root.join("lib").join(name));
                candidates.push(root.join(name));
            }
        }
    }

    candidates
}

/// Opaque handle that wraps the fastembed model.
pub struct EmbedHandle {
    model: Mutex<fastembed::TextEmbedding>,
}

impl EmbedHandle {
    fn new() -> anyhow::Result<Self> {
        ensure_onnx_runtime()?;

        let model = fastembed::TextEmbedding::try_new(
            fastembed::InitOptions::new(fastembed::EmbeddingModel::BGESmallENV15)
                .with_show_download_progress(true),
        )?;

        tracing::info!("embedding model loaded (BGE-small-en-v1.5)");
        Ok(EmbedHandle {
            model: Mutex::new(model),
        })
    }

    fn embed(&self, text: &str) -> anyhow::Result<Vec<f32>> {
        let mut model = self.model.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let result = model.embed(vec![text], None)?;
        result
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("no embedding returned"))
    }

    fn embed_batch(&self, texts: &[String]) -> anyhow::Result<Vec<Vec<f32>>> {
        let mut model = self.model.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        Ok(model.embed(refs, None)?)
    }
}

fn count_tokens_inner(text: &str) -> usize {
    use tiktoken_rs::cl100k_base;
    let bpe = cl100k_base().unwrap();
    bpe.encode_with_special_tokens(text).len()
}
