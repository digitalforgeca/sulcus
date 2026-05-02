//! sulcus-siu — Semantic Intelligence Unit
//!
//! A cdylib that classifies memory types and decomposes text into atomic
//! fragments for the SULCUS memory system.
//!
//! # Architecture
//! This library is loaded at runtime by `sulcus` via `dlopen`, following
//! the same pattern as `sulcus-vectors`. The embedding handle is intentionally
//! NOT passed into this library — the host process owns the embed dylib and
//! is responsible for:
//!
//! 1. Embedding each fragment returned by `siu_decompose`.
//! 2. Calling `siu_classify` on each embedding to get a type and confidence.
//!
//! This keeps `sulcus-siu` and `sulcus-vectors` fully decoupled.
//!
//! # FFI Surface
//! All public symbols follow the `siu_*` prefix convention and use the C ABI.
//! See README.md for a complete API reference.

mod classifier;
mod decompose;
mod types;

use std::ffi::{CStr, CString, c_char};
use std::path::Path;

use crate::classifier::Classifier;

// ── Handle ────────────────────────────────────────────────────────────────────

/// Opaque handle wrapping the loaded classifier.
/// Heap-allocated; lifetime managed by the caller via `siu_create`/`siu_destroy`.
pub struct SiuHandle {
    classifier: Classifier,
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/// Create a new SIU handle.
///
/// Loads `memory_classifier.onnx` and `label_map.json` from `model_dir`.
///
/// Returns a non-null `*mut SiuHandle` on success, or `null` on failure.
/// The caller owns the pointer and must eventually call `siu_destroy`.
///
/// # Safety
/// `model_dir` must be a valid, null-terminated UTF-8 C string pointing to a
/// readable directory.
#[no_mangle]
pub unsafe extern "C" fn siu_create(model_dir: *const c_char) -> *mut SiuHandle {
    if model_dir.is_null() {
        eprintln!("[sulcus-siu] siu_create: model_dir is null");
        return std::ptr::null_mut();
    }

    let dir_str = match CStr::from_ptr(model_dir).to_str() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[sulcus-siu] siu_create: invalid UTF-8 in model_dir: {e}");
            return std::ptr::null_mut();
        }
    };

    let result = std::panic::catch_unwind(|| Classifier::new(Path::new(dir_str)));
    match result {
        Ok(Ok(classifier)) => Box::into_raw(Box::new(SiuHandle { classifier })),
        Ok(Err(e)) => {
            eprintln!("[sulcus-siu] siu_create: failed to load classifier: {e:#}");
            std::ptr::null_mut()
        }
        Err(_panic) => {
            eprintln!("[sulcus-siu] siu_create: classifier panicked during load (ORT unavailable?)");
            std::ptr::null_mut()
        }
    }
}

/// Destroy a `SiuHandle` and free all resources.
///
/// # Safety
/// `handle` must be a valid pointer previously returned by `siu_create` and
/// not already freed.
#[no_mangle]
pub unsafe extern "C" fn siu_destroy(handle: *mut SiuHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

// ── Classification ────────────────────────────────────────────────────────────

/// Classify a 384-dim embedding.
///
/// `embedding_json` must be a JSON array of 384 f32 values, e.g.:
/// `[0.1, -0.2, 0.05, ...]`
///
/// Returns a heap-allocated JSON string of the form:
/// `{"type":"episodic","confidence":0.95}`
///
/// Returns `null` on error. The caller must free the string with `siu_free_string`.
///
/// # Safety
/// `handle` must be a valid, non-null `SiuHandle`. `embedding_json` must be a
/// valid null-terminated UTF-8 C string.
#[no_mangle]
pub unsafe extern "C" fn siu_classify(
    handle: *const SiuHandle,
    embedding_json: *const c_char,
) -> *mut c_char {
    if handle.is_null() || embedding_json.is_null() {
        return std::ptr::null_mut();
    }

    let handle = &*handle;

    let json_str = match CStr::from_ptr(embedding_json).to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };

    let embedding: Vec<f32> = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[sulcus-siu] siu_classify: failed to parse embedding JSON: {e}");
            return std::ptr::null_mut();
        }
    };

    match handle.classifier.classify(&embedding) {
        Ok(result) => match serde_json::to_string(&result) {
            Ok(json) => match CString::new(json) {
                Ok(c) => c.into_raw(),
                Err(_) => std::ptr::null_mut(),
            },
            Err(_) => std::ptr::null_mut(),
        },
        Err(e) => {
            eprintln!("[sulcus-siu] siu_classify: inference error: {e:#}");
            std::ptr::null_mut()
        }
    }
}

/// Multi-label classification: returns ALL applicable labels above threshold.
///
/// `embedding_json` must be a JSON array of 384 f32 values.
///
/// Returns a heap-allocated JSON string of the form:
/// ```json
/// {
///   "labels": [
///     {"type": "episodic", "confidence": 0.92},
///     {"type": "procedural", "confidence": 0.78}
///   ],
///   "primary": "episodic"
/// }
/// ```
///
/// Returns `null` on error. The caller must free the string with `siu_free_string`.
///
/// # Safety
/// `handle` must be a valid, non-null `SiuHandle`. `embedding_json` must be a
/// valid null-terminated UTF-8 C string.
#[no_mangle]
pub unsafe extern "C" fn siu_classify_multi(
    handle: *const SiuHandle,
    embedding_json: *const c_char,
) -> *mut c_char {
    if handle.is_null() || embedding_json.is_null() {
        return std::ptr::null_mut();
    }

    let handle = &*handle;

    let json_str = match CStr::from_ptr(embedding_json).to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };

    let embedding: Vec<f32> = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[sulcus-siu] siu_classify_multi: failed to parse embedding JSON: {e}");
            return std::ptr::null_mut();
        }
    };

    match handle.classifier.classify_multi(&embedding) {
        Ok(result) => match serde_json::to_string(&result) {
            Ok(json) => match CString::new(json) {
                Ok(c) => c.into_raw(),
                Err(_) => std::ptr::null_mut(),
            },
            Err(_) => std::ptr::null_mut(),
        },
        Err(e) => {
            eprintln!("[sulcus-siu] siu_classify_multi: inference error: {e:#}");
            std::ptr::null_mut()
        }
    }
}

/// Returns the current multi-label threshold (default: 0.50).
///
/// Per-class confidences above this threshold are included in multi-label results.
///
/// # Safety
/// `handle` must be a valid, non-null `SiuHandle`.
#[no_mangle]
pub unsafe extern "C" fn siu_multi_label_threshold(handle: *const SiuHandle) -> f32 {
    if handle.is_null() {
        return 0.50;
    }
    (*handle).classifier.multi_label_threshold
}

/// Update the multi-label threshold.
///
/// `threshold` is clamped to [0.0, 1.0].
///
/// # Safety
/// `handle` must be a valid, non-null `SiuHandle`.
#[no_mangle]
pub unsafe extern "C" fn siu_set_multi_label_threshold(
    handle: *mut SiuHandle,
    threshold: f32,
) {
    if handle.is_null() {
        return;
    }
    (*handle).classifier.multi_label_threshold = threshold.clamp(0.0, 1.0);
}

/// Returns 1 if the loaded model supports multi-label classification, 0 otherwise.
///
/// # Safety
/// `handle` must be a valid, non-null `SiuHandle`.
#[no_mangle]
pub unsafe extern "C" fn siu_is_multi_label(handle: *const SiuHandle) -> i32 {
    if handle.is_null() {
        return 0;
    }
    match (*handle).classifier.model_type {
        classifier::ModelType::MultiLabel => 1,
        classifier::ModelType::SingleLabel => 0,
    }
}

// ── Decomposition ─────────────────────────────────────────────────────────────

/// Decompose `text` into sentence-level fragments.
///
/// Returns a heap-allocated JSON array of fragment objects:
/// ```json
/// [
///   {"fragment": "Hello world.", "type": null, "confidence": null},
///   {"fragment": "Foo bar.",     "type": null, "confidence": null}
/// ]
/// ```
///
/// `type` and `confidence` are always `null` — the host process must embed each
/// fragment and call `siu_classify` separately to populate those fields.
///
/// Returns `null` on error. The caller must free the string with `siu_free_string`.
///
/// # Safety
/// `handle` must be a valid, non-null `SiuHandle`. `text` must be a valid
/// null-terminated UTF-8 C string.
#[no_mangle]
pub unsafe extern "C" fn siu_decompose(
    handle: *const SiuHandle,
    text: *const c_char,
) -> *mut c_char {
    if handle.is_null() || text.is_null() {
        return std::ptr::null_mut();
    }

    let text_str = match CStr::from_ptr(text).to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };

    let fragments = decompose::decompose(text_str);

    match serde_json::to_string(&fragments) {
        Ok(json) => match CString::new(json) {
            Ok(c) => c.into_raw(),
            Err(_) => std::ptr::null_mut(),
        },
        Err(_) => std::ptr::null_mut(),
    }
}

// ── Confidence Threshold ──────────────────────────────────────────────────────

/// Returns the current confidence threshold (default: 0.70).
///
/// Classifications with confidence below this threshold may be treated as
/// uncertain by the host process.
///
/// # Safety
/// `handle` must be a valid, non-null `SiuHandle`.
#[no_mangle]
pub unsafe extern "C" fn siu_confidence_threshold(handle: *const SiuHandle) -> f32 {
    if handle.is_null() {
        return 0.70;
    }
    (*handle).classifier.confidence_threshold
}

/// Update the confidence threshold.
///
/// `threshold` is clamped to [0.0, 1.0].
///
/// # Safety
/// `handle` must be a valid, non-null `SiuHandle`.
#[no_mangle]
pub unsafe extern "C" fn siu_set_confidence_threshold(
    handle: *mut SiuHandle,
    threshold: f32,
) {
    if handle.is_null() {
        return;
    }
    (*handle).classifier.confidence_threshold = threshold.clamp(0.0, 1.0);
}

// ── Memory Management ─────────────────────────────────────────────────────────

/// Free a string returned by any `siu_*` function.
///
/// Passing `null` is a no-op.
///
/// # Safety
/// `ptr` must be a `*mut c_char` previously returned by a `siu_*` function and
/// not yet freed. Do NOT pass pointers from any other source.
#[no_mangle]
pub unsafe extern "C" fn siu_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(CString::from_raw(ptr));
    }
}
