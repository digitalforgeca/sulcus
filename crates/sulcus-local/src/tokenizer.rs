//! Token counting — delegates to the embed dylib via the global embedding provider.
//! If the dylib is unavailable, falls back to whitespace splitting.

/// Return approximate token count for `text`.
/// Uses tiktoken cl100k_base via the sulcus-embed dylib when available.
pub fn count_tokens(text: &str) -> usize {
    crate::embeddings::count_tokens(text)
}
