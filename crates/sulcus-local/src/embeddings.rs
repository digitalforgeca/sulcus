use anyhow::Context;
use std::sync::OnceLock;

/// Embedding provider trait — allows graceful degradation for tests and CI.
pub trait EmbeddingProvider: Send + Sync {
    fn embed(&self, text: &str) -> Result<Vec<f32>, anyhow::Error>;
}

/// FastEmbed provider (wraps the `fastembed` crate). May perform model load on creation.
pub struct FastEmbedProvider {
    inner: fastembed::TextEmbedding,
}

impl FastEmbedProvider {
    pub fn try_new() -> anyhow::Result<Self> {
        // Select the lightweight AllMiniLML6V2 model via default config when available.
        let cfg = Default::default();
        let e = fastembed::TextEmbedding::try_new(cfg).context("failed to initialize fastembed provider")?;
        Ok(Self { inner: e })
    }
}

impl EmbeddingProvider for FastEmbedProvider {
    fn embed(&self, text: &str) -> Result<Vec<f32>, anyhow::Error> {
        let v = self
            .inner
            .embed(text)
            .context("fastembed embed call failed")?;
        Ok(v.into_iter().map(|x| x as f32).collect())
    }
}

// Global singleton using std::sync::OnceLock (thread-safe, zero-cost after init).
static GLOBAL_FASTEMBED: OnceLock<fastembed::TextEmbedding> = OnceLock::new();

/// Embed text using the global fastembed instance (lazy init).
pub fn embed_text(text: &str) -> anyhow::Result<Vec<f32>> {
    let inst = GLOBAL_FASTEMBED.get_or_try_init(|| {
        // Default config targets the AllMiniLML6V2 variant (no extra features).
        fastembed::TextEmbedding::try_new(Default::default()).context("failed to init fastembed singleton")
    })?;

    let v = inst.embed(text).context("fastembed embed failed")?;
    Ok(v.into_iter().map(|x| x as f32).collect())
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
