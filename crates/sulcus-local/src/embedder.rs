//! Embedding infrastructure for local vector search.
//!
//! Provides the `Embedder` trait and implementations:
//! - `FastEmbedder`: Uses `fastembed` crate with BGE-small-en-v1.5 (384 dims)
//! - Falls back gracefully when embeddings feature is disabled
//!
//! Vectors are stored as f32 blobs in the `embeddings` table and searched
//! via brute-force cosine similarity (sufficient for <100k memories).

use anyhow::Result;

/// Trait for generating text embeddings.
pub trait Embedder: Send + Sync {
    /// Generate an embedding vector for a single text.
    fn embed(&self, text: &str) -> Result<Vec<f32>>;

    /// Generate embeddings for multiple texts (batch).
    fn embed_batch(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        texts.iter().map(|t| self.embed(t)).collect()
    }

    /// Model name for metadata tracking.
    fn model_name(&self) -> &str;

    /// Vector dimensions.
    fn dimensions(&self) -> usize;
}

/// FastEmbed-based embedder using BGE-small-en-v1.5 (384 dimensions).
///
/// Available when the `embeddings` feature is enabled.
#[cfg(feature = "embeddings")]
pub struct FastEmbedder {
    model: fastembed::TextEmbedding,
}

#[cfg(feature = "embeddings")]
impl FastEmbedder {
    /// Initialize the embedder. Downloads the model on first use (~33MB).
    pub fn new() -> Result<Self> {
        use fastembed::{TextEmbedding, InitOptions, EmbeddingModel};

        let model = TextEmbedding::try_new(
            InitOptions::new(EmbeddingModel::BGESmallENV15)
                .with_show_download_progress(true),
        )?;

        Ok(Self { model })
    }

    /// Initialize with a custom cache directory for the model files.
    pub fn with_cache_dir(cache_dir: impl Into<std::path::PathBuf>) -> Result<Self> {
        use fastembed::{TextEmbedding, InitOptions, EmbeddingModel};

        let model = TextEmbedding::try_new(
            InitOptions::new(EmbeddingModel::BGESmallENV15)
                .with_cache_dir(cache_dir.into())
                .with_show_download_progress(true),
        )?;

        Ok(Self { model })
    }
}

#[cfg(feature = "embeddings")]
impl Embedder for FastEmbedder {
    fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let results = self.model.embed(vec![text], None)?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("Empty embedding result"))
    }

    fn embed_batch(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        let owned: Vec<String> = texts.iter().map(|s| s.to_string()).collect();
        let results = self.model.embed(owned, None)?;
        Ok(results)
    }

    fn model_name(&self) -> &str {
        "bge-small-en-v1.5"
    }

    fn dimensions(&self) -> usize {
        384
    }
}

/// Serialize an f32 vector to a byte blob for SQLite storage.
pub fn vector_to_blob(vec: &[f32]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(vec.len() * 4);
    for &v in vec {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    buf
}

/// Deserialize a byte blob back to an f32 vector.
pub fn blob_to_vector(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|chunk| {
            let bytes: [u8; 4] = chunk.try_into().unwrap();
            f32::from_le_bytes(bytes)
        })
        .collect()
}

/// Compute cosine similarity between two vectors.
/// Returns a value in [-1, 1] where 1 = identical direction.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    debug_assert_eq!(a.len(), b.len(), "Vector dimensions must match");

    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;

    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < f32::EPSILON {
        0.0
    } else {
        dot / denom
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vector_roundtrip() {
        let original = vec![1.0f32, -0.5, 0.0, 3.14, -2.718];
        let blob = vector_to_blob(&original);
        let recovered = blob_to_vector(&blob);
        assert_eq!(original, recovered);
    }

    #[test]
    fn test_cosine_identical() {
        let a = vec![1.0, 2.0, 3.0];
        let sim = cosine_similarity(&a, &a);
        assert!((sim - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_orthogonal() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6);
    }

    #[test]
    fn test_cosine_opposite() {
        let a = vec![1.0, 2.0, 3.0];
        let b: Vec<f32> = a.iter().map(|x| -x).collect();
        let sim = cosine_similarity(&a, &b);
        assert!((sim + 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_blob_empty() {
        let empty: Vec<f32> = vec![];
        let blob = vector_to_blob(&empty);
        assert!(blob.is_empty());
        let recovered = blob_to_vector(&blob);
        assert!(recovered.is_empty());
    }
}
