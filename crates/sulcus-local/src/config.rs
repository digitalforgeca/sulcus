use std::path::PathBuf;

use anyhow::Context;

/// Lightweight runtime configuration loaded from an INI file (optional).
/// Precedence: environment variables > CLI args > config file > defaults.
#[derive(Debug, Clone, Default)]
pub struct Config {
    pub db_path: Option<String>,
    pub therm_interval_ms: Option<u64>,
    pub server_url: Option<String>,
    pub server_api_key: Option<String>,

    // thermodynamics tuning
    pub decay: Option<f32>,
    pub prune_threshold: Option<f32>,
    pub active_limit: Option<usize>,
}

impl Config {
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
        let ini = ini::Ini::load_from_file(p).with_context(|| format!("failed to load config {}", p.display()))?;
        // prefer explicit [sulcus] section, else general
        let section = ini.section(Some("sulcus")).or_else(|| ini.section(None));
        let mut cfg = Config::default();
        if let Some(sec) = section {
            if let Some(v) = sec.get("db_path") {
                cfg.db_path = Some(v.to_string());
            }
            if let Some(v) = sec.get("therm_interval_ms") {
                if let Ok(n) = v.parse::<u64>() {
                    cfg.therm_interval_ms = Some(n);
                }
            }
            if let Some(v) = sec.get("server_url") {
                cfg.server_url = Some(v.to_string());
            }
            if let Some(v) = sec.get("server_api_key") {
                cfg.server_api_key = Some(v.to_string());
            }
            if let Some(v) = sec.get("decay") {
                if let Ok(f) = v.parse::<f32>() {
                    cfg.decay = Some(f);
                }
            }
            if let Some(v) = sec.get("prune_threshold") {
                if let Ok(f) = v.parse::<f32>() {
                    cfg.prune_threshold = Some(f);
                }
            }
            if let Some(v) = sec.get("active_limit") {
                if let Ok(n) = v.parse::<usize>() {
                    cfg.active_limit = Some(n);
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
            "[sulcus]\ndb_path = /tmp/sulcus-test.db\ntherm_interval_ms = 12345\ndecay = 0.42\nactive_limit = 50"
        )
        .unwrap();
        let path = f.path().to_path_buf();
        let cfg = Config::from_path(&path).expect("parse");
        assert_eq!(cfg.db_path.as_deref(), Some("/tmp/sulcus-test.db"));
        assert_eq!(cfg.therm_interval_ms, Some(12345));
        assert!((cfg.decay.unwrap() - 0.42).abs() < 1e-6);
        assert_eq!(cfg.active_limit, Some(50));
    }
}
