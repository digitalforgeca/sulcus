// `tiktoken-rs` 0.6 API: use the singleton helper which returns Arc<Mutex<CoreBPE>>.
// encode_with_special_tokens returns Vec<u32>, not a Result.

/// Return approximate token count for `text` using the cl100k_base encoder.
pub fn count_tokens(text: &str) -> usize {
    // cl100k_base_singleton() lazily initialises the model once and caches it.
    let enc = tiktoken_rs::cl100k_base_singleton();
    // cl100k_base_singleton uses parking_lot::Mutex — lock() returns the guard directly.
    let guard = enc.lock();
    guard.encode_with_special_tokens(text).len()
}
