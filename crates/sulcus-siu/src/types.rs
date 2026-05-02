//! Core types for the Semantic Intelligence Unit.

use serde::{Deserialize, Serialize};

/// The five memory classification types recognized by SULCUS.
/// Provided as a typed enum for host-side use; sulcus-siu itself uses string labels internally.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
    Episodic,
    Preference,
    Procedural,
    Semantic,
    Synthesis,
}

#[allow(dead_code)]
impl MemoryType {
    /// Parse from label_map string value.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "episodic" => Some(Self::Episodic),
            "preference" => Some(Self::Preference),
            "procedural" => Some(Self::Procedural),
            "semantic" => Some(Self::Semantic),
            "synthesis" => Some(Self::Synthesis),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Episodic => "episodic",
            Self::Preference => "preference",
            Self::Procedural => "procedural",
            Self::Semantic => "semantic",
            Self::Synthesis => "synthesis",
        }
    }
}

/// A single label with its confidence score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelScore {
    /// Memory type name.
    #[serde(rename = "type")]
    pub memory_type: String,
    /// Per-class confidence (0.0–1.0). For multi-label models this is the
    /// independent sigmoid probability; for single-label models this is the
    /// softmax probability.
    pub confidence: f32,
}

/// Result of classifying a 384-dim embedding (single-label, backward compat).
#[derive(Debug, Serialize, Deserialize)]
pub struct ClassificationResult {
    /// Predicted memory type (highest confidence).
    #[serde(rename = "type")]
    pub memory_type: String,
    /// Confidence for the predicted class (0.0–1.0).
    pub confidence: f32,
}

/// Result of multi-label classification.
///
/// Returned by `siu_classify_multi`. Each text can have zero or more labels,
/// each with an independent confidence score.
#[derive(Debug, Serialize, Deserialize)]
pub struct MultiLabelResult {
    /// All labels that meet the confidence threshold, sorted by confidence descending.
    pub labels: Vec<LabelScore>,
    /// The highest-confidence label (convenience field, always present if labels is non-empty).
    pub primary: Option<String>,
}

/// A single decomposed text fragment.
/// `memory_type` and `confidence` are `null` until the host process embeds
/// the fragment and calls `siu_classify` on it.
#[derive(Debug, Serialize, Deserialize)]
pub struct DecompositionFragment {
    pub fragment: String,
    #[serde(rename = "type")]
    pub memory_type: Option<String>,
    pub confidence: Option<f32>,
    /// Additional labels for multi-label classification.
    /// Only populated when the host uses `siu_classify_multi`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<LabelScore>>,
}
