use std::path::PathBuf;

use anyhow::Context;

/// Lightweight runtime configuration loaded from an INI file (optional).
/// Precedence: environment variables > CLI args > config file > defaults.
#[derive(Debug, Clone, Default)]
pub struct Config {
    pub database_url: Option<String>,
    pub therm_interval_ms: Option<u64>,
    pub server_url: Option<String>,
    pub server_api_key: Option<String>,

    // thermodynamics tuning
    pub decay: Option<f32>,
    pub prune_threshold: Option<f32>,
    pub active_limit: Option<usize>,
    pub sync_interval_secs: Option<u64>,
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
                    "database_url" => cfg.database_url = Some(val),
                    "therm_interval_ms" => cfg.therm_interval_ms = val.parse().ok(),
                    "server_url" => cfg.server_url = Some(val),
                    "server_api_key" => cfg.server_api_key = Some(val),
                    "decay" => cfg.decay = val.parse().ok(),
                    "prune_threshold" => cfg.prune_threshold = val.parse().ok(),
                    "active_limit" => cfg.active_limit = val.parse().ok(),
                    "sync_interval_secs" => cfg.sync_interval_secs = val.parse().ok(),
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
        assert_eq!(cfg.database_url.as_deref(), Some("postgres://sulcus@127.0.0.1:4201/sulcus?sslmode=disable"));
        assert_eq!(cfg.therm_interval_ms, Some(12345));
        assert!((cfg.decay.unwrap() - 0.42).abs() < 1e-6);
        assert_eq!(cfg.active_limit, Some(50));
    }

    #[test]
    fn load_via_env_var() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        writeln!(f, "[sulcus]\ndatabase_url = postgres://sulcus@127.0.0.1:4201/sulcus?sslmode=disable\ndecay = 0.5").unwrap();
        let path = f.path().to_path_buf();
        std::env::set_var("SULCUS_CONFIG", &path);
        let cfg = Config::load();
        std::env::remove_var("SULCUS_CONFIG");
        assert_eq!(cfg.database_url.as_deref(), Some("postgres://sulcus@127.0.0.1:4201/sulcus?sslmode=disable"));
        assert!((cfg.decay.unwrap() - 0.5).abs() < 1e-6);
    }
}
