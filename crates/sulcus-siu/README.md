# sulcus-siu

**Semantic Intelligence Unit** — a `cdylib` for the [SULCUS](https://github.com/digitalforgeca/sulcus) memory system.

`sulcus-siu` classifies memory fragments into one of five semantic types and decomposes raw text into atomic, classifiable sentences. It is loaded at runtime by `sulcus` via `dlopen`, following the same pattern as `sulcus-embed`.

---

## Memory Types

| Label | Description |
|---|---|
| `episodic` | Autobiographical events — *"I went to the store yesterday"* |
| `preference` | Likes, dislikes, values — *"I prefer dark mode"* |
| `procedural` | How-to knowledge — *"To reset the router, hold the button for 10 s"* |
| `semantic` | Factual/conceptual knowledge — *"Paris is the capital of France"* |
| `synthesis` | Inferred or aggregated insight — *"Based on recent patterns, X tends to Y"* |

---

## Model

- Architecture: trained scikit-learn / ONNX classifier on all-MiniLM-L6-v2 384-dim embeddings
- Input: `float32[1, 384]` (a single normalised embedding)
- Output: `float32[1, 5]` logits — softmax applied at inference time
- Files (bundled in `model/`):
  - `memory_classifier.onnx` — 14 KB ONNX model
  - `label_map.json` — index → label mapping

---

## FFI Surface

All symbols use the C ABI (`#[no_mangle] pub unsafe extern "C"`).

### Lifecycle

```c
// Load ONNX model + label map from `model_dir`.
// Returns NULL on failure.
SiuHandle* siu_create(const char* model_dir);

// Free handle. Safe to call with NULL.
void siu_destroy(SiuHandle* handle);
```

### Classification

```c
// Classify a 384-dim embedding (JSON float array).
// Input:  "[0.1, -0.2, 0.05, ...]"
// Output: "{\"type\":\"episodic\",\"confidence\":0.95}"
// Returns NULL on error. Caller must free with siu_free_string.
char* siu_classify(const SiuHandle* handle, const char* embedding_json);
```

### Decomposition

```c
// Split text into sentence-level fragments.
// Output JSON array:
// [
//   {"fragment": "Hello world.", "type": null, "confidence": null},
//   ...
// ]
//
// ⚠ type and confidence are always null.
// Host process must embed each fragment and call siu_classify separately.
// Returns NULL on error. Caller must free with siu_free_string.
char* siu_decompose(const SiuHandle* handle, const char* text);
```

### Confidence Threshold

```c
// Get current threshold (default: 0.70).
float siu_confidence_threshold(const SiuHandle* handle);

// Set threshold (clamped to [0.0, 1.0]).
void siu_set_confidence_threshold(SiuHandle* handle, float threshold);
```

### Memory Management

```c
// Free any string returned by siu_* functions. Safe to call with NULL.
void siu_free_string(char* ptr);
```

---

## Host Integration Pattern

```rust
// Pseudo-code — actual integration is in sulcus

let model_dir = CString::new("/path/to/model").unwrap();
let siu = unsafe { siu_create(model_dir.as_ptr()) };

// Decompose text into fragments
let text = CString::new("I love Rust. It is fast and safe.").unwrap();
let frags_ptr = unsafe { siu_decompose(siu, text.as_ptr()) };
let frags_json = unsafe { CStr::from_ptr(frags_ptr).to_str().unwrap() };
// frags_json = [{"fragment":"I love Rust.","type":null,"confidence":null}, ...]

// For each fragment, embed it (via sulcus-embed) then classify:
for fragment in fragments {
    let embedding = sulcus_embed_text(embed_handle, fragment.as_ptr()); // from sulcus-embed
    let result_ptr = unsafe { siu_classify(siu, embedding) };
    // result_ptr = {"type":"preference","confidence":0.91}
    unsafe { siu_free_string(embedding) };
    unsafe { siu_free_string(result_ptr) };
}

unsafe { siu_free_string(frags_ptr) };
unsafe { siu_destroy(siu) };
```

---

## Building

```bash
# From the crate directory (standalone — not part of workspace Cargo.toml)
cd crates/sulcus-siu
cargo build --release

# Check only (fast)
cargo check
```

The output dylib is `target/release/libsulcus_siu.dylib` (macOS) or
`libsulcus_siu.so` (Linux).

---

## Design Decisions

- **No dependency on `sulcus-embed`**: The host process owns the embed dylib. Embedding handles are intentionally not passed into `sulcus-siu` to keep the two dylibs fully decoupled and independently upgradeable.
- **Null classification in decompose**: `siu_decompose` returns raw text fragments. Classification requires embeddings, which requires `sulcus-embed`. The host orchestrates the embed → classify pipeline.
- **Mutex-wrapped session**: The ONNX `Session` is not `Send + Sync` by default; wrapping in `Mutex` makes `SiuHandle` safe to use from multiple threads.
- **Panic catching at FFI boundary**: All entry points use `std::panic::catch_unwind` where ORT may panic (e.g., missing libonnxruntime).
