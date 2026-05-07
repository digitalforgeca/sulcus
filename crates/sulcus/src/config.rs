use std::path::PathBuf;

use anyhow::Context;

/// Lightweight runtime configuration loaded from an INI file (optional).
/// Precedence: environment variables > CLI args > config file > defaults.
#[derive(Debug, Clone, Default)]
pub struct Config {
    pub database_url: Option<String>,
    pub therm_interval_ms: Option<u64>,

    // thermodynamics tuning
    pub decay: Option<f32>,
    pub prune_threshold: Option<f32>,
    pub active_limit: Option<usize>,
    pub sync_interval_secs: Option<u64>,

    // storage governance — disk protection
    /// Hard cap on total nodes per agent. Default: 10,000. 0 = unlimited.
    pub max_total_nodes: Option<usize>,
    /// Maximum disk usage in MB for the embedded PG data dir. Default: 500. 0 = unlimited.
    pub max_storage_mb: Option<u64>,
    /// Automatically purge coldest nodes when at capacity. Default: true.
    pub auto_purge: Option<bool>,
    /// Heat threshold below which nodes are candidates for auto-purge. Default: 0.05.
    pub auto_purge_threshold: Option<f32>,

    // agent identity & plugin features (Phase 3-6)
    /// Agent namespace. Default: "default".
    pub namespace: Option<String>,
    /// Enable core memory (persistent identity block). Default: true.
    pub core_memory_enabled: Option<bool>,
    /// Enable structured episode capture on session end/compaction. Default: true.
    pub episode_capture: Option<bool>,
    /// Enable automatic memory recall (context injection). Default: true.
    pub auto_recall: Option<bool>,
    /// Enable automatic memory capture from conversations. Default: true.
    pub auto_capture: Option<bool>,
    /// Consolidation schedule: "off", "daily", "weekly". Default: "daily".
    pub consolidation_schedule: Option<String>,
}

impl Config {
    /// Default hard cap on total stored nodes. 10,000 is generous for most agents.
    pub const DEFAULT_MAX_TOTAL_NODES: usize = 10_000;
    /// Default disk quota in MB for embedded PG data directory.
    pub const DEFAULT_MAX_STORAGE_MB: u64 = 500;

    /// Effective max total nodes. 0 = unlimited.
    pub fn effective_max_total_nodes(&self) -> usize {
        self.max_total_nodes
            .unwrap_or(Self::DEFAULT_MAX_TOTAL_NODES)
    }

    /// Effective max storage in MB. 0 = unlimited.
    pub fn effective_max_storage_mb(&self) -> u64 {
        self.max_storage_mb.unwrap_or(Self::DEFAULT_MAX_STORAGE_MB)
    }

    /// Whether auto-purge is enabled when at capacity.
    pub fn auto_purge_enabled(&self) -> bool {
        self.auto_purge.unwrap_or(true)
    }

    /// Heat threshold below which nodes can be auto-purged.
    pub fn effective_auto_purge_threshold(&self) -> f32 {
        self.auto_purge_threshold.unwrap_or(0.05)
    }

    /// Effective namespace. Default: "default".
    pub fn effective_namespace(&self) -> &str {
        self.namespace.as_deref().unwrap_or("default")
    }

    /// Whether core memory is enabled. Default: true.
    pub fn core_memory_enabled(&self) -> bool {
        self.core_memory_enabled.unwrap_or(true)
    }

    /// Whether episode capture is enabled. Default: true.
    pub fn episode_capture_enabled(&self) -> bool {
        self.episode_capture.unwrap_or(true)
    }

    /// Whether auto-recall is enabled. Default: true.
    pub fn auto_recall_enabled(&self) -> bool {
        self.auto_recall.unwrap_or(true)
    }

    /// Whether auto-capture is enabled. Default: true.
    pub fn auto_capture_enabled(&self) -> bool {
        self.auto_capture.unwrap_or(true)
    }

    /// Consolidation schedule. Default: "daily".
    pub fn effective_consolidation_schedule(&self) -> &str {
        self.consolidation_schedule.as_deref().unwrap_or("daily")
    }

    /// Returns `true` if `url` points to localhost or 127.0.0.1 only.
    /// sulcus is a local-only binary and must not connect to remote databases.
    pub fn is_local_url(url: &str) -> bool {
        let lower = url.to_lowercase();
        lower.contains("127.0.0.1") || lower.contains("localhost")
    }

    /// Validate a database URL at the point of use. Returns an error if the URL
    /// does not point to a local host.
    pub fn validate_database_url(url: &str) -> anyhow::Result<()> {
        if Self::is_local_url(url) {
            Ok(())
        } else {
            anyhow::bail!(
                "sulcus only connects to local databases (127.0.0.1 / localhost). \
                 Got: {url}"
            )
        }
    }

    /// Load config from (in priority): $SULCUS_CONFIG, ~/.config/sulcus/sulcus.ini,
    /// ~/.sulcus/sulcus.ini, /etc/sulcus/sulcus.ini. If no file found, returns Default.
    pub fn load() -> Self {
        // check explicit env override first
        if let Ok(p) = std::env::var("SULCUS_CONFIG") {
            if let Ok(cfg) = Self::from_path(&PathBuf::from(p)) {
                return cfg;
            }
        }

        // candidate locations
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(mut cfg_dir) = dirs::config_dir() {
            cfg_dir.push("sulcus");
            cfg_dir.push("sulcus.ini");
            candidates.push(cfg_dir);
        }

        if let Some(mut home) = dirs::home_dir() {
            home.push(".sulcus");
            home.push("sulcus.ini");
            candidates.push(home);
        }

        candidates.push(PathBuf::from("/etc/sulcus/sulcus.ini"));

        for p in candidates.into_iter() {
            if p.exists() {
                if let Ok(cfg) = Self::from_path(&p) {
                    return cfg;
                }
            }
        }

        Default::default()
    }

    fn from_path(p: &PathBuf) -> anyhow::Result<Self> {
        let s = std::fs::read_to_string(p)
            .with_context(|| format!("failed to read {}", p.display()))?;
        let mut in_sulcus_section = false;
        let mut saw_any_section = false;
        let mut cfg = Config::default();

        for raw in s.lines() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                saw_any_section = true;
                let name = &line[1..line.len() - 1];
                in_sulcus_section = name.eq_ignore_ascii_case("sulcus");
                continue;
            }

            // if file uses sections and we're not in [sulcus], skip key/value pairs
            if saw_any_section && !in_sulcus_section {
                continue;
            }

            if let Some(eq) = line.find('=') {
                let key = line[..eq].trim();
                let mut val = line[eq + 1..].trim().to_string();
                // strip quotes
                if (val.starts_with('"') && val.ends_with('"'))
                    || (val.starts_with('\'') && val.ends_with('\''))
                {
                    val = val[1..val.len() - 1].to_string();
                }
                match key {
                    "database_url" => {
                        if Self::is_local_url(&val) {
                            cfg.database_url = Some(val);
                        } else {
                            tracing::warn!(
                                url = %val,
                                "ignoring non-local database_url — sulcus only connects to 127.0.0.1 or localhost"
                            );
                        }
                    }
                    "therm_interval_ms" => cfg.therm_interval_ms = val.parse().ok(),
                    // server_url and server_api_key are handled by sulcus-sync (paid tier)
                    "server_url" | "server_api_key" => {}
                    "decay" => cfg.decay = val.parse().ok(),
                    "prune_threshold" => cfg.prune_threshold = val.parse().ok(),
                    "active_limit" => cfg.active_limit = val.parse().ok(),
                    "sync_interval_secs" => cfg.sync_interval_secs = val.parse().ok(),
                    // Accept both naming conventions for compatibility
                    "max_total_nodes" | "max_nodes" => cfg.max_total_nodes = val.parse().ok(),
                    "max_storage_mb" => cfg.max_storage_mb = val.parse().ok(),
                    "auto_purge" => {
                        cfg.auto_purge = match val.to_lowercase().as_str() {
                            "true" | "1" | "yes" => Some(true),
                            "false" | "0" | "no" => Some(false),
                            _ => None,
                        }
                    }
                    // Accept both naming conventions
                    "auto_purge_threshold" | "auto_prune_threshold" => {
                        cfg.auto_purge_threshold = val.parse().ok()
                    }
                    "namespace" | "agent_namespace" => cfg.namespace = Some(val),
                    "core_memory_enabled" | "core_memory" => {
                        cfg.core_memory_enabled = match val.to_lowercase().as_str() {
                            "true" | "1" | "yes" => Some(true),
                            "false" | "0" | "no" => Some(false),
                            _ => None,
                        }
                    }
                    "episode_capture" | "episodes" => {
                        cfg.episode_capture = match val.to_lowercase().as_str() {
                            "true" | "1" | "yes" => Some(true),
                            "false" | "0" | "no" => Some(false),
                            _ => None,
                        }
                    }
                    "auto_recall" => {
                        cfg.auto_recall = match val.to_lowercase().as_str() {
                            "true" | "1" | "yes" => Some(true),
                            "false" | "0" | "no" => Some(false),
                            _ => None,
                        }
                    }
                    "auto_capture" => {
                        cfg.auto_capture = match val.to_lowercase().as_str() {
                            "true" | "1" | "yes" => Some(true),
                            "false" | "0" | "no" => Some(false),
                            _ => None,
                        }
                    }
                    "consolidation_schedule" | "consolidation" => {
                        let lower = val.to_lowercase();
                        if matches!(lower.as_str(), "off" | "daily" | "weekly") {
                            cfg.consolidation_schedule = Some(lower);
                        }
                    }
                    _ => {}
                }
            }
        }

        Ok(cfg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn load_from_explicit_path() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        writeln!(
            f,
            "[sulcus]\ndatabase_url = postgres://sulcus@127.0.0.1:4201/sulcus?sslmode=disable\ntherm_interval_ms = 12345\ndecay = 0.42\nactive_limit = 50"
        )
        .unwrap();
        let path = f.path().to_path_buf();
        let cfg = Config::from_path(&path).expect("parse");
        assert_eq!(
            cfg.database_url.as_deref(),
            Some("postgres://sulcus@127.0.0.1:4201/sulcus?sslmode=disable")
        );
        assert_eq!(cfg.therm_interval_ms, Some(12345));
        assert!((cfg.decay.unwrap() - 0.42).abs() < 1e-6);
        assert_eq!(cfg.active_limit, Some(50));
    }

    #[test]
    fn parse_phase3_6_fields() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        writeln!(f, "[sulcus]").unwrap();
        writeln!(f, "database_url = postgres://sulcus@127.0.0.1:4201/sulcus").unwrap();
        writeln!(f, "namespace = ariadne").unwrap();
        writeln!(f, "core_memory_enabled = true").unwrap();
        writeln!(f, "episode_capture = yes").unwrap();
        writeln!(f, "auto_recall = 1").unwrap();
        writeln!(f, "auto_capture = false").unwrap();
        writeln!(f, "consolidation_schedule = weekly").unwrap();
        let path = f.path().to_path_buf();
        let cfg = Config::from_path(&path).expect("parse");
        assert_eq!(cfg.effective_namespace(), "ariadne");
        assert!(cfg.core_memory_enabled());
        assert!(cfg.episode_capture_enabled());
        assert!(cfg.auto_recall_enabled());
        assert!(!cfg.auto_capture_enabled());
        assert_eq!(cfg.effective_consolidation_schedule(), "weekly");
    }

    #[test]
    fn load_via_env_var() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        writeln!(f, "[sulcus]\ndatabase_url = postgres://sulcus@127.0.0.1:4201/sulcus?sslmode=disable\ndecay = 0.5").unwrap();
        let path = f.path().to_path_buf();
        std::env::set_var("SULCUS_CONFIG", &path);
        let cfg = Config::load();
        std::env::remove_var("SULCUS_CONFIG");
        assert_eq!(
            cfg.database_url.as_deref(),
            Some("postgres://sulcus@127.0.0.1:4201/sulcus?sslmode=disable")
        );
        assert!((cfg.decay.unwrap() - 0.5).abs() < 1e-6);
    }
}
