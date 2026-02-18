use std::sync::OnceLock;

// `tiktoken-rs` prebuilt `cl100k_base` feature is enabled in Cargo.toml.
// Provide a small, thread-safe singleton with a simple `count_tokens` helper.

static TOKENIZER: OnceLock<tiktoken_rs::CoreBPE> = OnceLock::new();

fn tokenizer() -> &'static tiktoken_rs::CoreBPE {
    TOKENIZER.get_or_init(|| {
        // feature-flagged prebuilt encoding for cl100k_base should be available
        // `tiktoken-rs` exposes `cl100k_base()` when the feature is enabled.
        tiktoken_rs::cl100k_base()
    })
}

/// Return approximate token count for `text` using the cl100k_base encoder.
pub fn count_tokens(text: &str) -> usize {
    let enc = tokenizer();
    // Prefer the standard `encode_with_special_tokens` when available; fall back to `encode`.
    // Both return a Vec<u32> of token ids; we only need the length.
    if let Ok(tokens) = enc.encode_with_special_tokens(text) {
        tokens.len()
    } else if let Ok(tokens) = enc.encode(text) {
        tokens.len()
    } else {
        // Fallback: conservative whitespace-based estimate (very unlikely to run).
        text.split_whitespace().count()
    }
}
