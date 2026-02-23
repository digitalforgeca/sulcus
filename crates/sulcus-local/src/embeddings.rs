use anyhow::Context;
use std::sync::{Mutex, OnceLock};

/// Embedding provider trait — allows graceful degradation for tests and CI.
pub trait EmbeddingProvider: Send + Sync {
    fn embed(&self, text: &str) -> Result<Vec<f32>, anyhow::Error>;
}

/// FastEmbed provider (wraps the `fastembed` crate). May perform model load on creation.
/// Uses interior mutability (`Mutex`) because fastembed 5.x `TextEmbedding::embed`
/// takes `&mut self`.
pub struct FastEmbedProvider {
    inner: Mutex<fastembed::TextEmbedding>,
}

impl FastEmbedProvider {
    pub fn try_new() -> anyhow::Result<Self> {
        let cfg = Default::default();
        // `ort` (ONNX Runtime) calls `panic!` when the dylib is not found instead of
        // returning an Err. Wrap in catch_unwind so the process doesn't abort.
        // AssertUnwindSafe is safe here: we discard cfg on unwind, no shared state.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            fastembed::TextEmbedding::try_new(cfg)
        }));
        let e = match result {
            Ok(Ok(model)) => model,
            Ok(Err(err)) => anyhow::bail!("fastembed init error: {err}"),
            Err(_panic) => anyhow::bail!("fastembed/ort panicked (ONNX Runtime dylib not found)"),
        };
        Ok(Self { inner: Mutex::new(e) })
    }
}

impl EmbeddingProvider for FastEmbedProvider {
    fn embed(&self, text: &str) -> Result<Vec<f32>, anyhow::Error> {
        // fastembed 5.x: embed() is batch-in / batch-out, takes &mut self
        let mut guard = self.inner.lock()
            .map_err(|_| anyhow::anyhow!("fastembed mutex poisoned"))?;
        let mut batch = guard
            .embed(vec![text], None)
            .context("fastembed embed call failed")?;
        Ok(batch.pop().unwrap_or_default())
    }
}

// Global singleton using OnceLock<Mutex<...>> — avoids unstable `get_or_try_init`.
static GLOBAL_FASTEMBED: OnceLock<Mutex<fastembed::TextEmbedding>> = OnceLock::new();

/// Embed text using the global fastembed instance (lazy init).
/// Panics only if the model cannot be loaded from disk on first use.
pub fn embed_text(text: &str) -> anyhow::Result<Vec<f32>> {
    let inst = GLOBAL_FASTEMBED.get_or_init(|| {
        let model = fastembed::TextEmbedding::try_new(Default::default())
            .expect("failed to init fastembed singleton");
        Mutex::new(model)
    });
    let mut guard = inst.lock()
        .map_err(|_| anyhow::anyhow!("fastembed singleton mutex poisoned"))?;
    // fastembed 5.x: embed() is batch-in / batch-out, takes &mut self
    let mut batch = guard.embed(vec![text], None).context("fastembed embed failed")?;
    Ok(batch.pop().unwrap_or_default())
}

/// Mock provider used in tests — deterministic and fast (no model download).
pub struct MockEmbeddingProvider;

impl MockEmbeddingProvider {
    pub fn new() -> Self {
        Self {}
    }
}

impl EmbeddingProvider for MockEmbeddingProvider {
    fn embed(&self, _text: &str) -> Result<Vec<f32>, anyhow::Error> {
        Ok(vec![0.1f32; 384])
    }
}
