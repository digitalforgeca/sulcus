use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// Events that can fire triggers
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TriggerEvent {
    OnRecall,
    OnDecay,
    OnStore,
    OnBoost,
    OnRelate,
    OnThreshold,
    /// Fired when a new memory conflicts with an existing one (high similarity, low text overlap).
    OnConflict,
}

impl TriggerEvent {
    pub fn as_str(&self) -> &str {
        match self {
            Self::OnRecall => "on_recall",
            Self::OnDecay => "on_decay",
            Self::OnStore => "on_store",
            Self::OnBoost => "on_boost",
            Self::OnRelate => "on_relate",
            Self::OnThreshold => "on_threshold",
            Self::OnConflict => "on_conflict",
        }
    }
}

impl FromStr for TriggerEvent {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "on_recall" => Ok(Self::OnRecall),
            "on_decay" => Ok(Self::OnDecay),
            "on_store" => Ok(Self::OnStore),
            "on_boost" => Ok(Self::OnBoost),
            "on_relate" => Ok(Self::OnRelate),
            "on_threshold" => Ok(Self::OnThreshold),
            "on_conflict" => Ok(Self::OnConflict),
            _ => Err(format!("unknown trigger event: {s}")),
        }
    }
}

/// Actions triggers can perform
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerAction {
    Notify,
    Boost,
    Pin,
    Tag,
    Deprecate,
    Webhook,
    Chain,
}

impl TriggerAction {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Notify => "notify",
            Self::Boost => "boost",
            Self::Pin => "pin",
            Self::Tag => "tag",
            Self::Deprecate => "deprecate",
            Self::Webhook => "webhook",
            Self::Chain => "chain",
        }
    }
}

impl FromStr for TriggerAction {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "notify" => Ok(Self::Notify),
            "boost" => Ok(Self::Boost),
            "pin" => Ok(Self::Pin),
            "tag" => Ok(Self::Tag),
            "deprecate" => Ok(Self::Deprecate),
            "webhook" => Ok(Self::Webhook),
            "chain" => Ok(Self::Chain),
            _ => Err(format!("unknown trigger action: {s}")),
        }
    }
}

/// Context passed when evaluating triggers
#[derive(Debug, Clone)]
pub struct TriggerContext {
    pub node_id: Option<String>,
    pub node_label: Option<String>,
    pub node_namespace: Option<String>,
    pub node_memory_type: Option<String>,
    pub node_heat: Option<f32>,
    pub old_heat: Option<f32>,
}

/// A matched trigger ready to fire
#[derive(Debug, Clone)]
pub struct MatchedTrigger {
    pub id: String,
    pub name: String,
    pub action: String,
    pub action_config: serde_json::Value,
    pub fire_count: i32,
    pub max_fires: Option<i32>,
}

/// Result of firing a trigger
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerResult {
    pub trigger_id: String,
    pub trigger_name: String,
    pub action: String,
    pub success: bool,
    pub message: Option<String>,
    pub data: serde_json::Value,
}
