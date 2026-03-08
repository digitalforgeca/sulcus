use anyhow::Context;
use std::path::PathBuf;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use std::process::Command;
use std::sync::{Mutex, OnceLock};

fn candidate_onnx_dylib_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("libonnxruntime.dylib"));
            candidates.push(dir.join("lib").join("libonnxruntime.dylib"));
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join("lib").join("libonnxruntime.dylib"));
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        let roots = [
            home.join(".sulcus").join("onnxruntime"),
            home.join(".sulcus").join("local").join("onnxruntime"),
        ];
        for root in roots {
            candidates.push(root.join("lib").join("libonnxruntime.dylib"));
            if root.exists() {
                if let Ok(entries) = std::fs::read_dir(&root) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir() {
                            candidates.push(path.join("lib").join("libonnxruntime.dylib"));
                        }
                    }
                }
            }
        }
    }

    candidates.push(PathBuf::from("/opt/homebrew/lib/libonnxruntime.dylib"));
    candidates.push(PathBuf::from("/usr/local/lib/libonnxruntime.dylib"));

    candidates
}

fn detect_onnx_dylib() -> Option<PathBuf> {
    candidate_onnx_dylib_paths()
        .into_iter()
        .find(|path| path.is_file())
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn run_command(command: &mut Command, action: &str) -> anyhow::Result<()> {
    let status = command
        .status()
        .with_context(|| format!("failed to {}", action))?;
    if !status.success() {
        anyhow::bail!("failed to {} (exit status: {status})", action);
    }
    Ok(())
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn provision_onnxruntime_macos_arm64() -> anyhow::Result<Option<PathBuf>> {
    let version =
        std::env::var("SULCUS_ONNX_RUNTIME_VERSION").unwrap_or_else(|_| "1.23.2".to_string());
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("home directory not found"))?;
    let root = home.join(".sulcus").join("onnxruntime");
    std::fs::create_dir_all(&root)?;

    let archive_name = format!("onnxruntime-osx-arm64-{version}.tgz");
    let archive_path = root.join(&archive_name);
    let extracted_dir = root.join(format!("onnxruntime-osx-arm64-{version}"));
    let dylib_path = extracted_dir.join("lib").join("libonnxruntime.dylib");
    if dylib_path.is_file() {
        return Ok(Some(dylib_path));
    }

    let url = format!(
        "https://github.com/microsoft/onnxruntime/releases/download/v{version}/{archive_name}"
    );

    if !archive_path.is_file() {
        let mut curl = Command::new("curl");
        curl.arg("-L")
            .arg("--fail")
            .arg("--silent")
            .arg("--show-error")
            .arg("-o")
            .arg(&archive_path)
            .arg(&url);
        run_command(&mut curl, "download ONNX Runtime archive")?;
    }

    let mut tar = Command::new("tar");
    tar.arg("-xzf").arg(&archive_path).arg("-C").arg(&root);
    run_command(&mut tar, "extract ONNX Runtime archive")?;

    if dylib_path.is_file() {
        return Ok(Some(dylib_path));
    }

    Ok(detect_onnx_dylib())
}



pub fn ensure_onnx_runtime_env() {
    if let Ok(path) = std::env::var("ORT_DYLIB_PATH") {
        if PathBuf::from(&path).is_file() {
            return;
        }
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    match provision_onnxruntime_macos_arm64() {
        Ok(Some(path)) => {
            std::env::set_var("ORT_DYLIB_PATH", path.as_os_str());
            tracing::info!(path = %path.display(), "provisioned ONNX Runtime dylib");
            return;
        }
        Ok(None) => {
            tracing::warn!(
                "provisioning did not produce ONNX Runtime dylib; trying discovered locations"
            );
        }
        Err(err) => {
            tracing::warn!(error = %err, "failed to provision ONNX Runtime dylib; trying discovered locations");
        }
    }

    if let Some(path) = detect_onnx_dylib() {
        std::env::set_var("ORT_DYLIB_PATH", path.as_os_str());
        tracing::info!(path = %path.display(), "using discovered ONNX Runtime dylib");
        return;
    }

    tracing::warn!("ONNX Runtime dylib not found; fastembed may fall back to mock embeddings");
}

/// Embedding provider trait — allows graceful degradation for tests and CI.
pub trait EmbeddingProvider: Send + Sync {
    fn embed(&self, text: &str) -> Result<Vec<f32>, anyhow::Error>;
    fn embed_image(&self, path: &str) -> Result<Vec<f32>, anyhow::Error>;
}

/// FastEmbed provider (wraps the `fastembed` crate). May perform model load on creation.
/// Uses interior mutability (`Mutex`) because fastembed 5.x `TextEmbedding::embed`
/// takes `&mut self`.
pub struct FastEmbedProvider {
    inner: Mutex<fastembed::TextEmbedding>,
    vision: OnceLock<Mutex<fastembed::ImageEmbedding>>,
}

impl FastEmbedProvider {
    pub fn try_new() -> anyhow::Result<Self> {
        ensure_onnx_runtime_env();
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
            Err(_panic) => anyhow::bail!(
                "fastembed/ort panicked during ONNX Runtime initialization. \
Set ORT_DYLIB_PATH to a compatible libonnxruntime.dylib (Apple Silicon note: version must satisfy ort requirements, currently >=1.23.x)."
            ),
        };
        Ok(Self {
            inner: Mutex::new(e),
            vision: OnceLock::new(),
        })
    }
}

impl EmbeddingProvider for FastEmbedProvider {
    fn embed(&self, text: &str) -> Result<Vec<f32>, anyhow::Error> {
        // fastembed 5.x: embed() is batch-in / batch-out, takes &mut self
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| anyhow::anyhow!("fastembed mutex poisoned"))?;
        let mut batch = guard
            .embed(vec![text], None)
            .context("fastembed embed call failed")?;
        Ok(batch.pop().unwrap_or_default())
    }

    fn embed_image(&self, path: &str) -> Result<Vec<f32>, anyhow::Error> {
        let model_mutex = self.vision.get_or_init(|| {
            let model = fastembed::ImageEmbedding::try_new(fastembed::ImageInitOptions::default())
                .expect("failed to init fastembed vision model");
            Mutex::new(model)
        });

        let mut guard = model_mutex.lock().map_err(|_| anyhow::anyhow!("vision lock poisoned"))?;
        let mut batch = guard.embed(vec![path.to_string()], None)
            .context("fastembed image embed failed")?;
        Ok(batch.pop().unwrap_or_default())
    }
}

// Global singleton using OnceLock<Mutex<...>> — avoids unstable `get_or_try_init`.
static GLOBAL_FASTEMBED: OnceLock<Mutex<fastembed::TextEmbedding>> = OnceLock::new();
static GLOBAL_FASTEMBED_VISION: OnceLock<Mutex<fastembed::ImageEmbedding>> = OnceLock::new();

/// Embed text using the global fastembed instance (lazy init).
/// Panics only if the model cannot be loaded from disk on first use.
pub fn embed_text(text: &str) -> anyhow::Result<Vec<f32>> {
    ensure_onnx_runtime_env();
    let inst = GLOBAL_FASTEMBED.get_or_init(|| {
        let model = fastembed::TextEmbedding::try_new(Default::default())
            .expect("failed to init fastembed singleton");
        Mutex::new(model)
    });
    let mut guard = inst
        .lock()
        .map_err(|_| anyhow::anyhow!("fastembed singleton mutex poisoned"))?;
    // fastembed 5.x: embed() is batch-in / batch-out, takes &mut self
    let mut batch = guard
        .embed(vec![text], None)
        .context("fastembed embed failed")?;
    Ok(batch.pop().unwrap_or_default())
}

/// Embed image using the global fastembed vision instance (lazy init).
pub fn embed_image(path: &str) -> anyhow::Result<Vec<f32>> {
    ensure_onnx_runtime_env();
    let inst = GLOBAL_FASTEMBED_VISION.get_or_init(|| {
        let model = fastembed::ImageEmbedding::try_new(fastembed::ImageInitOptions::default())
            .expect("failed to init fastembed vision singleton");
        Mutex::new(model)
    });
    let mut guard = inst
        .lock()
        .map_err(|_| anyhow::anyhow!("fastembed vision singleton mutex poisoned"))?;
    let mut batch = guard
        .embed(vec![path.to_string()], None)
        .context("fastembed image embed failed")?;
    Ok(batch.pop().unwrap_or_default())
}

/// Mock provider used in tests — deterministic and fast (no model download).
pub struct MockEmbeddingProvider;

impl Default for MockEmbeddingProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl MockEmbeddingProvider {
    pub fn new() -> Self {
        Self {}
    }
}

impl EmbeddingProvider for MockEmbeddingProvider {
    fn embed(&self, _text: &str) -> Result<Vec<f32>, anyhow::Error> {
        Ok(vec![0.1f32; 384])
    }
    fn embed_image(&self, _path: &str) -> Result<Vec<f32>, anyhow::Error> {
        Ok(vec![0.2f32; 512]) // Vision models often have different dimensions
    }
}
