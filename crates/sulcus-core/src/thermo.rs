//! Configurable Thermodynamic Engine for Sulcus.
//!
//! This module defines the heat decay model, resonance (edge diffusion),
//! recall reinforcement, and tick scheduling. All parameters are user-tunable
//! per tenant, with sane defaults.
//!
//! # Design principles
//!
//! - **Half-life is the user-facing abstraction.** "Episodic memories fade to 50%
//!   in 24 hours" is human-speak. The engine converts to per-tick decay factors.
//! - **Activity-driven ticks.** The system's clock runs proportional to usage.
//!   Quiet night = slow decay. Heavy day = fast metabolism.
//! - **Per-node overrides.** Individual memories can have custom decay classes,
//!   TTLs, and minimum heat floors.
//! - **Stability via spaced repetition.** Recalled memories become more resistant
//!   to decay over time, not just temporarily hotter.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Decay Profile ──────────────────────────────────────────────────────────

/// Per-memory-type decay profile. Half-life is in seconds.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DecayProfile {
    /// Time in seconds for heat to reach 50% of its current value.
    /// Larger = slower decay.
    pub half_life_secs: f64,
    /// Minimum heat floor — node never decays below this.
    pub floor: f32,
    /// Heat boost when this memory type is recalled.
    pub reinforce_on_recall: f32,
    /// Stability multiplier on recall (spaced repetition).
    /// Applied to the node's stability field. >1.0 means recalls make it stickier.
    pub stability_gain: f32,
}

impl DecayProfile {
    /// Compute the per-tick decay factor given a tick interval in seconds.
    ///
    /// `decay_factor = 2^(-tick_interval / half_life)`
    ///
    /// A half-life of 86400s (24h) with a tick every 300s (5min) gives:
    /// `2^(-300/86400) ≈ 0.9976` — very slow per-tick, but compounds to 50% in 24h.
    pub fn decay_factor(&self, tick_interval_secs: f64) -> f64 {
        if self.half_life_secs <= 0.0 {
            return 1.0; // no decay
        }
        2.0_f64.powf(-tick_interval_secs / self.half_life_secs)
    }
}

/// Default decay profiles for each memory type.
pub fn default_decay_profiles() -> HashMap<String, DecayProfile> {
    let mut m = HashMap::new();
    m.insert(
        "episodic".into(),
        DecayProfile {
            half_life_secs: 86_400.0, // 24 hours
            floor: 0.01,
            reinforce_on_recall: 0.20,
            stability_gain: 1.3,
        },
    );
    m.insert(
        "semantic".into(),
        DecayProfile {
            half_life_secs: 2_592_000.0, // 30 days
            floor: 0.05,
            reinforce_on_recall: 0.10,
            stability_gain: 1.5,
        },
    );
    m.insert(
        "preference".into(),
        DecayProfile {
            half_life_secs: 7_776_000.0, // 90 days
            floor: 0.10,
            reinforce_on_recall: 0.15,
            stability_gain: 1.8,
        },
    );
    m.insert(
        "procedural".into(),
        DecayProfile {
            half_life_secs: 15_552_000.0, // 180 days
            floor: 0.08,
            reinforce_on_recall: 0.10,
            stability_gain: 2.0,
        },
    );
    m.insert(
        "synthesis".into(),
        DecayProfile {
            half_life_secs: 5_184_000.0, // 60 days
            floor: 0.05,
            reinforce_on_recall: 0.10,
            stability_gain: 1.5,
        },
    );
    m
}

// ─── Decay Class (per-node override) ────────────────────────────────────────

/// Per-node decay speed override. Multiplies the type's half-life.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecayClass {
    /// 0.5x half-life (decays twice as fast).
    Volatile,
    /// 1.0x half-life (default).
    Normal,
    /// 2.0x half-life (decays half as fast).
    Persistent,
    /// No decay at all (equivalent to pinning, but without index priority).
    Permanent,
}

impl Default for DecayClass {
    fn default() -> Self {
        Self::Normal
    }
}

impl DecayClass {
    /// Half-life multiplier for this class.
    pub fn multiplier(self) -> f64 {
        match self {
            Self::Volatile => 0.5,
            Self::Normal => 1.0,
            Self::Persistent => 2.0,
            Self::Permanent => f64::INFINITY,
        }
    }

    pub fn from_str_lossy(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "volatile" => Self::Volatile,
            "persistent" => Self::Persistent,
            "permanent" => Self::Permanent,
            _ => Self::Normal,
        }
    }
}

// ─── Resonance (Edge Diffusion) ─────────────────────────────────────────────

/// Controls how heat spreads through edges in the knowledge graph.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ResonanceConfig {
    /// Base heat transfer factor through edges (0.0–1.0).
    pub spread_factor: f32,
    /// Maximum number of hops for heat diffusion.
    pub depth: u32,
    /// Heat multiplier per hop (0.0–1.0). Each hop reduces transferred heat.
    pub damping: f32,
    /// Minimum source node heat to propagate (thermal gate).
    pub thermal_gate: f32,
}

impl Default for ResonanceConfig {
    fn default() -> Self {
        Self {
            spread_factor: 0.3,
            depth: 2,
            damping: 0.5,
            thermal_gate: 0.05,
        }
    }
}

// ─── Tick Scheduling ────────────────────────────────────────────────────────

/// How the tick clock advances.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "mode")]
pub enum TickMode {
    /// Tick on a fixed wall-clock interval.
    Fixed {
        /// Interval in milliseconds.
        interval_ms: u64,
    },
    /// Tick after every N memory operations.
    Activity {
        /// Number of operations between ticks.
        trigger_ops: u32,
        /// Max idle time before forced tick (ms).
        max_idle_ms: u64,
    },
    /// Activity-driven with a fixed fallback.
    Hybrid {
        /// Operations between ticks.
        trigger_ops: u32,
        /// Max idle time before forced tick (ms).
        max_idle_ms: u64,
    },
}

impl Default for TickMode {
    fn default() -> Self {
        Self::Hybrid {
            trigger_ops: 10,
            max_idle_ms: 3_600_000, // 1 hour
        }
    }
}

impl TickMode {
    /// Effective tick interval in seconds, for decay factor calculation.
    /// For activity-driven modes, this is an estimate based on typical usage.
    pub fn effective_interval_secs(&self) -> f64 {
        match self {
            Self::Fixed { interval_ms } => *interval_ms as f64 / 1000.0,
            Self::Activity { max_idle_ms, .. } | Self::Hybrid { max_idle_ms, .. } => {
                // Estimate: assume ~5 min between activity ticks on average.
                // The max_idle is the cap, but typical is much shorter.
                (*max_idle_ms as f64 / 1000.0).min(300.0)
            }
        }
    }
}

// ─── Consolidation ──────────────────────────────────────────────────────────

/// When and how cold episodic memories get folded into semantic summaries.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ConsolidationConfig {
    /// Trigger consolidation when this many nodes are below the cold threshold.
    pub cold_count_trigger: u32,
    /// Heat threshold below which a node is "cold" for consolidation purposes.
    pub cold_threshold: f32,
    /// Strategy for consolidation.
    pub strategy: ConsolidationStrategy,
}

impl Default for ConsolidationConfig {
    fn default() -> Self {
        Self {
            cold_count_trigger: 20,
            cold_threshold: 0.10,
            strategy: ConsolidationStrategy::FoldToSemantic,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConsolidationStrategy {
    /// Summarize clusters of cold episodics into single semantic nodes.
    FoldToSemantic,
    /// Archive cold nodes to a separate store (remove from active graph).
    Archive,
    /// Prune cold nodes below the floor entirely.
    Prune,
}

// ─── Active Index ───────────────────────────────────────────────────────────

/// Controls the active context window.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ActiveIndexConfig {
    /// Maximum nodes in the active index.
    pub max_nodes: u32,
    /// Minimum heat to enter the active index.
    pub hot_threshold: f32,
    /// Below this heat, node is a prune candidate.
    pub cold_threshold: f32,
    /// Maximum context budget in characters (for token-aware budgeting).
    pub context_budget_chars: u32,
}

impl Default for ActiveIndexConfig {
    fn default() -> Self {
        Self {
            max_nodes: 50,
            hot_threshold: 0.30,
            cold_threshold: 0.05,
            context_budget_chars: 12_000,
        }
    }
}

// ─── Reinforcement ──────────────────────────────────────────────────────────

/// Controls how memory access affects heat and stability.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReinforcementConfig {
    /// Heat boost when a memory is recalled/retrieved.
    pub on_recall: f32,
    /// Heat boost when a memory is updated/edited.
    pub on_update: f32,
    /// Heat boost for neighbors when a memory is accessed.
    pub on_edge_access: f32,
    /// Stability multiplier on recall (spaced repetition). >1.0 = stickier.
    pub stability_gain: f32,
}

impl Default for ReinforcementConfig {
    fn default() -> Self {
        Self {
            on_recall: 0.20,
            on_update: 0.30,
            on_edge_access: 0.10,
            stability_gain: 1.5,
        }
    }
}

// ─── Master Config ──────────────────────────────────────────────────────────

/// Complete thermodynamic configuration for a tenant.
///
/// Stored per-tenant in the database. Defaults are sane for general use.
/// Users can tune via the dashboard or API.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ThermoConfig {
    /// Per-memory-type decay profiles.
    pub decay_profiles: HashMap<String, DecayProfile>,
    /// Resonance (edge diffusion) settings.
    pub resonance: ResonanceConfig,
    /// Tick scheduling mode.
    pub tick: TickMode,
    /// Consolidation settings.
    pub consolidation: ConsolidationConfig,
    /// Active index / context window settings.
    pub active_index: ActiveIndexConfig,
    /// Recall reinforcement settings.
    pub reinforcement: ReinforcementConfig,
}

impl Default for ThermoConfig {
    fn default() -> Self {
        Self {
            decay_profiles: default_decay_profiles(),
            resonance: ResonanceConfig::default(),
            tick: TickMode::default(),
            consolidation: ConsolidationConfig::default(),
            active_index: ActiveIndexConfig::default(),
            reinforcement: ReinforcementConfig::default(),
        }
    }
}

impl ThermoConfig {
    /// Get the decay profile for a memory type, falling back to episodic.
    pub fn profile_for(&self, memory_type: &str) -> &DecayProfile {
        self.decay_profiles
            .get(memory_type)
            .unwrap_or_else(|| self.decay_profiles.get("episodic").unwrap())
    }

    /// Compute the effective decay factor for a given memory type + decay class
    /// at the current tick interval.
    pub fn decay_factor(&self, memory_type: &str, class: DecayClass, stability: f32) -> f64 {
        let profile = self.profile_for(memory_type);
        let tick_secs = self.tick.effective_interval_secs();

        // Apply decay class multiplier to half-life
        let effective_half_life = profile.half_life_secs * class.multiplier();

        // Apply stability: higher stability = longer effective half-life
        let stability_factor = (stability as f64).max(1.0);
        let final_half_life = effective_half_life * stability_factor;

        if final_half_life.is_infinite() || final_half_life <= 0.0 {
            return 1.0; // permanent or invalid — no decay
        }

        2.0_f64.powf(-tick_secs / final_half_life)
    }

    /// Apply one tick of decay to a single node's heat.
    ///
    /// Returns the new heat value, respecting floors and pinning.
    pub fn apply_decay(
        &self,
        current_heat: f32,
        memory_type: &str,
        is_pinned: bool,
        decay_class: DecayClass,
        stability: f32,
        min_heat_override: Option<f32>,
    ) -> f32 {
        if is_pinned || decay_class == DecayClass::Permanent {
            return current_heat;
        }

        let factor = self.decay_factor(memory_type, decay_class, stability) as f32;
        let profile = self.profile_for(memory_type);

        // Floor is the max of (type floor, per-node override)
        let floor = min_heat_override
            .unwrap_or(profile.floor)
            .max(profile.floor);

        (current_heat * factor).max(floor)
    }

    /// Apply recall reinforcement to a node. Returns (new_heat, new_stability).
    pub fn apply_recall(&self, current_heat: f32, stability: f32, memory_type: &str) -> (f32, f32) {
        let profile = self.profile_for(memory_type);
        let r = &self.reinforcement;

        let new_heat = (current_heat + r.on_recall).min(1.0);
        // Stability grows multiplicatively, but use the per-type gain if it's set
        let gain = if profile.stability_gain > 0.0 {
            profile.stability_gain
        } else {
            r.stability_gain
        };
        let new_stability = stability * gain;

        (new_heat, new_stability)
    }

    /// Apply update reinforcement. Returns (new_heat, new_stability).
    pub fn apply_update(&self, current_heat: f32, stability: f32) -> (f32, f32) {
        let r = &self.reinforcement;
        let new_heat = (current_heat + r.on_update).min(1.0);
        let new_stability = stability * r.stability_gain;
        (new_heat, new_stability)
    }

    /// Check if a node's TTL has expired. Returns true if expired.
    pub fn is_ttl_expired(
        &self,
        ttl_hours: Option<f64>,
        created_at_epoch_secs: f64,
        now_secs: f64,
    ) -> bool {
        match ttl_hours {
            Some(hours) if hours > 0.0 => {
                let age_hours = (now_secs - created_at_epoch_secs) / 3600.0;
                age_hours >= hours
            }
            _ => false,
        }
    }

    /// Check if a node's valid_until has passed. Returns true if expired.
    pub fn is_temporally_expired(&self, valid_until_secs: Option<f64>, now_secs: f64) -> bool {
        match valid_until_secs {
            Some(until) => now_secs >= until,
            None => false,
        }
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = ThermoConfig::default();
        assert_eq!(config.decay_profiles.len(), 5);
        assert!(config.decay_profiles.contains_key("episodic"));
        assert!(config.decay_profiles.contains_key("semantic"));
        assert!(config.decay_profiles.contains_key("preference"));
        assert!(config.decay_profiles.contains_key("procedural"));
        assert!(config.decay_profiles.contains_key("synthesis"));
    }

    #[test]
    fn test_decay_factor_episodic() {
        let config = ThermoConfig::default();
        // Episodic half-life = 24h = 86400s
        // At 300s tick interval: 2^(-300/86400) ≈ 0.9976
        let factor = config.decay_factor("episodic", DecayClass::Normal, 1.0);
        assert!(factor > 0.99 && factor < 1.0, "factor was {}", factor);
    }

    #[test]
    fn test_decay_factor_semantic() {
        let config = ThermoConfig::default();
        // Semantic half-life = 30 days = 2592000s
        // Much slower decay per tick
        let factor = config.decay_factor("semantic", DecayClass::Normal, 1.0);
        assert!(factor > 0.999, "factor was {}", factor);
    }

    #[test]
    fn test_decay_class_volatile() {
        let config = ThermoConfig::default();
        let normal = config.decay_factor("episodic", DecayClass::Normal, 1.0);
        let volatile = config.decay_factor("episodic", DecayClass::Volatile, 1.0);
        // Volatile decays faster (lower factor)
        assert!(
            volatile < normal,
            "volatile {} vs normal {}",
            volatile,
            normal
        );
    }

    #[test]
    fn test_decay_class_permanent() {
        let config = ThermoConfig::default();
        let factor = config.decay_factor("episodic", DecayClass::Permanent, 1.0);
        assert_eq!(factor, 1.0); // no decay
    }

    #[test]
    fn test_stability_slows_decay() {
        let config = ThermoConfig::default();
        let low_stability = config.decay_factor("episodic", DecayClass::Normal, 1.0);
        let high_stability = config.decay_factor("episodic", DecayClass::Normal, 5.0);
        // Higher stability = higher factor (slower decay)
        assert!(
            high_stability > low_stability,
            "high {} vs low {}",
            high_stability,
            low_stability
        );
    }

    #[test]
    fn test_apply_decay_respects_floor() {
        let config = ThermoConfig::default();
        let heat = config.apply_decay(0.02, "episodic", false, DecayClass::Normal, 1.0, None);
        // Episodic floor is 0.01
        assert!(heat >= 0.01, "heat was {}", heat);
    }

    #[test]
    fn test_apply_decay_pinned_unchanged() {
        let config = ThermoConfig::default();
        let heat = config.apply_decay(0.8, "episodic", true, DecayClass::Normal, 1.0, None);
        assert_eq!(heat, 0.8);
    }

    #[test]
    fn test_apply_decay_min_heat_override() {
        let config = ThermoConfig::default();
        // Override floor to 0.5 — heat should not go below
        let heat = config.apply_decay(0.51, "episodic", false, DecayClass::Normal, 1.0, Some(0.5));
        assert!(heat >= 0.5, "heat was {}", heat);
    }

    #[test]
    fn test_recall_reinforcement() {
        let config = ThermoConfig::default();
        let (new_heat, new_stability) = config.apply_recall(0.5, 1.0, "episodic");
        assert!((new_heat - 0.7).abs() < 0.01, "heat was {}", new_heat);
        assert!(new_stability > 1.0, "stability was {}", new_stability);
    }

    #[test]
    fn test_recall_caps_at_1() {
        let config = ThermoConfig::default();
        let (new_heat, _) = config.apply_recall(0.95, 1.0, "episodic");
        assert!(new_heat <= 1.0);
    }

    #[test]
    fn test_ttl_expiry() {
        let config = ThermoConfig::default();
        let created = 0.0;
        let now = 7200.0; // 2 hours later
        assert!(!config.is_ttl_expired(Some(3.0), created, now)); // 3h TTL, not expired
        assert!(config.is_ttl_expired(Some(1.0), created, now)); // 1h TTL, expired
        assert!(!config.is_ttl_expired(None, created, now)); // no TTL
    }

    #[test]
    fn test_temporal_expiry() {
        let config = ThermoConfig::default();
        assert!(config.is_temporally_expired(Some(100.0), 200.0));
        assert!(!config.is_temporally_expired(Some(300.0), 200.0));
        assert!(!config.is_temporally_expired(None, 200.0));
    }

    #[test]
    fn test_half_life_math() {
        // After one half-life, heat should be ~50%
        let profile = DecayProfile {
            half_life_secs: 3600.0, // 1 hour
            floor: 0.0,
            reinforce_on_recall: 0.0,
            stability_gain: 1.0,
        };

        let tick_secs = 60.0; // 1 minute ticks
        let factor = profile.decay_factor(tick_secs);
        let ticks_in_half_life = 3600.0 / 60.0; // 60 ticks

        let mut heat = 1.0_f64;
        for _ in 0..ticks_in_half_life as u32 {
            heat *= factor;
        }
        // After 60 ticks of 1 minute each (= 1 hour = 1 half-life), should be ~0.5
        assert!(
            (heat - 0.5).abs() < 0.01,
            "heat after 1 half-life was {} (expected ~0.5)",
            heat
        );
    }

    #[test]
    fn test_decay_profiles_differentiate_types() {
        let config = ThermoConfig::default();
        let ep = config.decay_factor("episodic", DecayClass::Normal, 1.0);
        let sem = config.decay_factor("semantic", DecayClass::Normal, 1.0);
        let pref = config.decay_factor("preference", DecayClass::Normal, 1.0);
        let proc = config.decay_factor("procedural", DecayClass::Normal, 1.0);

        // episodic decays fastest, procedural slowest
        assert!(
            ep < sem,
            "episodic {} should decay faster than semantic {}",
            ep,
            sem
        );
        assert!(
            sem < pref,
            "semantic {} should decay faster than preference {}",
            sem,
            pref
        );
        assert!(
            pref < proc,
            "preference {} should decay faster than procedural {}",
            pref,
            proc
        );
    }
}
