use anyhow::Context;
use once_cell::sync::OnceCell;

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
        let e = fastembed::TextEmbedding::try_new(Default::default())
            .context("failed to initialize fastembed provider")?;
        Ok(Self { inner: e })
    }
}

impl EmbeddingProvider for FastEmbedProvider {
    fn embed(&self, text: &str) -> Result<Vec<f32>, anyhow::Error> {
        // fastembed returns a Vec<f32> or similar; propagate any error as anyhow::Error
        let v = self
            .inner
            .embed(text)
            .context("fastembed embed call failed")?;
        Ok(v.into_iter().map(|x| x as f32).collect())
    }
}

/// Convenience singleton helper for quick embedding calls from procedural code.
/// Uses a OnceCell to ensure model is loaded once and shared across threads.
static GLOBAL_FASTEMBED: OnceCell<fastembed::TextEmbedding> = OnceCell::new();

/// Embed text using the global fastembed instance (lazy init).
pub fn embed_text(text: &str) -> anyhow::Result<Vec<f32>> {
    let inst = GLOBAL_FASTEMBED.get_or_try_init(|| {
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
