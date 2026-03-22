//! Library manifest — declares required and optional dylibs.
//!
//! On startup, sulcus-local reads the manifest, checks each expected library
//! against the filesystem, and refuses to run if required components are missing.
//! Provides clear diagnostics about what's missing and where it looked.

use std::path::PathBuf;

/// A single library entry in the manifest.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LibEntry {
    /// Human-readable name (e.g. "sulcus-embed").
    pub name: &'static str,
    /// The dylib filename (platform-specific).
    pub filename: String,
    /// Whether this library is required to start.
    pub required: bool,
    /// What this library provides.
    pub provides: &'static str,
    /// Resolved path (filled in during check).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved: Option<PathBuf>,
    /// Error message if not found.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Result of checking all manifest entries.
#[derive(Debug, serde::Serialize)]
pub struct ManifestReport {
    pub entries: Vec<LibEntry>,
    pub search_paths: Vec<PathBuf>,
    pub all_required_found: bool,
    pub missing_required: Vec<String>,
    pub missing_optional: Vec<String>,
}

impl std::fmt::Display for ManifestReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "╔══════════════════════════════════════════════╗")?;
        writeln!(f, "║         SULCUS LIBRARY MANIFEST              ║")?;
        writeln!(f, "╠══════════════════════════════════════════════╣")?;

        for entry in &self.entries {
            let status = if entry.resolved.is_some() {
                "✓ FOUND"
            } else if entry.required {
                "✗ MISSING (REQUIRED)"
            } else {
                "○ MISSING (optional)"
            };
            let req = if entry.required { "required" } else { "optional" };
            writeln!(f, "║ {:<16} [{req}] {status}", entry.name)?;
            if let Some(path) = &entry.resolved {
                writeln!(f, "║   → {}", path.display())?;
            }
            writeln!(f, "║   provides: {}", entry.provides)?;
        }

        writeln!(f, "╠══════════════════════════════════════════════╣")?;
        writeln!(f, "║ Search paths:")?;
        for p in &self.search_paths {
            writeln!(f, "║   {}", p.display())?;
        }

        if !self.missing_required.is_empty() {
            writeln!(f, "╠══════════════════════════════════════════════╣")?;
            writeln!(f, "║ ⚠ CANNOT START — missing required libraries:")?;
            for name in &self.missing_required {
                writeln!(f, "║   • {name}")?;
            }
            writeln!(f, "║")?;
            writeln!(f, "║ Install missing libraries to one of the")?;
            writeln!(f, "║ search paths listed above, or set")?;
            writeln!(f, "║ SULCUS_LIB_DIR to a custom location.")?;
        }

        if !self.missing_optional.is_empty() {
            writeln!(f, "╠══════════════════════════════════════════════╣")?;
            writeln!(f, "║ Optional libraries not found:")?;
            for name in &self.missing_optional {
                writeln!(f, "║   • {name} (functionality will be limited)")?;
            }
        }

        writeln!(f, "╚══════════════════════════════════════════════╝")?;
        Ok(())
    }
}

/// Build the manifest of expected libraries.
fn build_manifest() -> Vec<LibEntry> {
    vec![
        LibEntry {
            name: "sulcus-embed",
            filename: dylib_name("sulcus_embed"),
            // Optional: falls back to mock embeddings (no vectors, whitespace tokenizer).
            // Required for production use — without it, semantic search is disabled.
            required: false,
            provides: "text embeddings, token counting (fastembed + ONNX + tiktoken)",
            resolved: None,
            error: None,
        },
        LibEntry {
            name: "sulcus-store",
            filename: dylib_name("sulcus_store"),
            // Optional: sulcus-local still has sqlx + pg-embed compiled in (phase 2 will extract).
            // When present, loaded via progressive loader for hot-swappable storage backends.
            required: false,
            provides: "embedded PostgreSQL storage engine (pg-embed + SQLx)",
            resolved: None,
            error: None,
        },
        LibEntry {
            name: "sulcus-sync",
            filename: dylib_name("sulcus_sync"),
            required: false,
            provides: "cloud sync, multi-agent memory mesh (paid subscription)",
            resolved: None,
            error: None,
        },
    ]
}

/// Get the search paths for dylibs.
fn search_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    // 1. SULCUS_LIB_DIR env override
    if let Ok(dir) = std::env::var("SULCUS_LIB_DIR") {
        paths.push(PathBuf::from(dir));
    }

    // 2. Same directory as the executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.to_path_buf());
        }
    }

    // 3. ~/.sulcus/lib/
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".sulcus").join("lib"));
        // Also check plugins dir for sync (legacy location)
        paths.push(home.join(".sulcus").join("plugins"));
    }

    // 4. System locations
    paths.push(PathBuf::from("/usr/local/lib"));

    paths
}

/// Check all manifest entries against the filesystem.
/// Returns a report with resolution status for each library.
pub fn check() -> ManifestReport {
    let paths = search_paths();
    let mut entries = build_manifest();
    let mut missing_required = Vec::new();
    let mut missing_optional = Vec::new();

    for entry in &mut entries {
        let mut found = false;
        for dir in &paths {
            let candidate = dir.join(&entry.filename);
            if candidate.exists() && candidate.is_file() {
                entry.resolved = Some(candidate);
                found = true;
                break;
            }
        }
        if !found {
            let msg = format!(
                "{} not found in any search path",
                entry.filename
            );
            entry.error = Some(msg);
            if entry.required {
                missing_required.push(entry.name.to_string());
            } else {
                missing_optional.push(entry.name.to_string());
            }
        }
    }

    ManifestReport {
        all_required_found: missing_required.is_empty(),
        entries,
        search_paths: paths,
        missing_required,
        missing_optional,
    }
}

/// Check the manifest and abort if required libraries are missing.
/// Prints a detailed report to stderr.
pub fn check_or_die() {
    let report = check();

    // Always print the manifest on startup
    tracing::info!("\n{report}");

    if !report.all_required_found {
        eprintln!("{report}");
        eprintln!("FATAL: Required libraries missing. Cannot start sulcus-local.");
        eprintln!("See above for details on what to install and where.");
        std::process::exit(1);
    }

    // Log optional missing with clear warnings
    for entry in &report.entries {
        if entry.resolved.is_none() && !entry.required {
            tracing::warn!(
                lib = entry.name,
                provides = entry.provides,
                "optional library not found — related features will be limited"
            );
        }
    }
}

fn dylib_name(base: &str) -> String {
    #[cfg(target_os = "macos")]
    return format!("lib{base}.dylib");
    #[cfg(target_os = "linux")]
    return format!("lib{base}.so");
    #[cfg(windows)]
    return format!("{base}.dll");
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    return format!("lib{base}.so");
}
