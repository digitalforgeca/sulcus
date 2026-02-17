use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// A lightweight pointer in the `Map` (summary + activation heat).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Node {
    pub id: Uuid,
    /// Short human-facing label (indexable)
    pub label: String,
    /// Dense, machine-readable pointer summary (< 500 chars)
    pub pointer_summary: String,
    /// Long-term functional weight (0.0 ..= 1.0)
    #[serde(default)]
    pub base_utility: f32,
    /// Ephemeral thermodynamic state (0.0 ..= 1.0)
    #[serde(default)]
    pub current_heat: f32,
    /// If true, immune to temporal decay
    #[serde(default)]
    pub is_pinned: bool,
}

/// Edge between nodes with a weight that governs heat flow.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Edge {
    pub source: Uuid,
    pub target: Uuid,
    /// 0.0 ..= 1.0
    pub edge_weight: f32,
    pub edge_type: EdgeType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EdgeType {
    Semantic,
    Hebbian,
    Explicit,
}

/// Apply decay to every node in-place.
///
/// This is deterministic and pure so it can be tested independently from storage.
pub fn apply_decay(nodes: &mut [Node], decay: f32) {
    for n in nodes.iter_mut() {
        if n.is_pinned {
            continue;
        }
        n.current_heat *= decay;
        if n.current_heat < 0.0 {
            n.current_heat = 0.0;
        }
        // floor clamp optimization
        if n.current_heat < 0.05 {
            n.current_heat = 0.0;
        }
        if n.current_heat > 1.0 {
            n.current_heat = 1.0;
        }
    }
}

/// Spread activation from `start` to its immediate neighbors using `edges`.
///
/// Algorithm (minimal, deterministic MVP):
/// - For every edge where `edge.source == start`, transfer `source_heat * edge.edge_weight * 0.5` to target.
/// - This function mutates `nodes` in-place.
pub fn spread_activation(start: Uuid, nodes: &mut [Node], edges: &[Edge]) {
    let mut index: HashMap<Uuid, usize> = HashMap::with_capacity(nodes.len());
    for (i, n) in nodes.iter().enumerate() {
        index.insert(n.id, i);
    }

    let source_idx = match index.get(&start) {
        Some(&i) => i,
        None => return,
    };

    let source_heat = nodes[source_idx].current_heat;
    if source_heat <= 0.0 {
        return;
    }

    for e in edges.iter().filter(|e| e.source == start) {
        if let Some(&tidx) = index.get(&e.target) {
            let transfer = source_heat * e.edge_weight * 0.5;
            nodes[tidx].current_heat += transfer;
            if nodes[tidx].current_heat > 1.0 {
                nodes[tidx].current_heat = 1.0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn test_spread_and_decay() {
        let a_id = Uuid::from_u128(1);
        let b_id = Uuid::from_u128(2);

        let mut nodes = vec![
            Node {
                id: a_id,
                label: "A".into(),
                pointer_summary: "A pointer".into(),
                base_utility: 0.0,
                current_heat: 1.0,
                is_pinned: false,
            },
            Node {
                id: b_id,
                label: "B".into(),
                pointer_summary: "B pointer".into(),
                base_utility: 0.0,
                current_heat: 0.0,
                is_pinned: false,
            },
        ];

        let edges = vec![Edge {
            source: a_id,
            target: b_id,
            edge_weight: 0.1,
            edge_type: EdgeType::Hebbian,
        }];

        // Spread: B receives 1.0 * 0.1 * 0.5 = 0.05
        spread_activation(a_id, &mut nodes, &edges);
        assert!((nodes[1].current_heat - 0.05).abs() < f32::EPSILON);

        // Decay: multiply by 0.85
        apply_decay(&mut nodes, 0.85);
        assert!((nodes[0].current_heat - 0.85).abs() < 1e-6);
        // B was 0.05 -> after decay becomes < 0.05 -> floor-clamped to 0.0
        assert_eq!(nodes[1].current_heat, 0.0);
    }

    #[test]
    fn test_apply_decay_edge_cases() {
        let mut nodes = vec![
            Node {
                id: Uuid::from_u128(3),
                label: "X".into(),
                pointer_summary: "x".into(),
                base_utility: 0.0,
                current_heat: 0.1,
                is_pinned: false,
            },
            Node {
                id: Uuid::from_u128(4),
                label: "Y".into(),
                pointer_summary: "y".into(),
                base_utility: 0.0,
                current_heat: -0.05,
                is_pinned: false,
            },
        ];

        // decay to zero
        apply_decay(&mut nodes, 0.0);
        assert_eq!(nodes[0].current_heat, 0.0);
        assert_eq!(nodes[1].current_heat, 0.0);

        // growth-like decay (>1.0) scales values (0 remains 0)
        nodes[0].current_heat = 0.4;
        apply_decay(&mut nodes, 1.5);
        assert!((nodes[0].current_heat - 0.6).abs() < 1e-6);
    }

    #[test]
    fn test_spread_activation_multiple_edges() {
        let a = Uuid::from_u128(10);
        let b = Uuid::from_u128(11);
        let c = Uuid::from_u128(12);

        let mut nodes = vec![
            Node {
                id: a,
                label: "A".into(),
                pointer_summary: "A".into(),
                base_utility: 0.0,
                current_heat: 1.0,
                is_pinned: false,
            },
            Node {
                id: b,
                label: "B".into(),
                pointer_summary: "B".into(),
                base_utility: 0.0,
                current_heat: 0.0,
                is_pinned: false,
            },
            Node {
                id: c,
                label: "C".into(),
                pointer_summary: "C".into(),
                base_utility: 0.0,
                current_heat: 0.0,
                is_pinned: false,
            },
        ];

        let edges = vec![
            Edge {
                source: a,
                target: b,
                edge_weight: 0.2,
                edge_type: EdgeType::Hebbian,
            },
            Edge {
                source: a,
                target: c,
                edge_weight: 0.1,
                edge_type: EdgeType::Semantic,
            },
            Edge {
                source: b,
                target: c,
                edge_weight: 0.5,
                edge_type: EdgeType::Hebbian,
            },
        ];

        spread_activation(a, &mut nodes, &edges);
        assert!((nodes[1].current_heat - 0.1).abs() < 1e-6); // 1.0 * 0.2 * 0.5 = 0.1
        assert!((nodes[2].current_heat - 0.05).abs() < 1e-6); // 1.0 * 0.1 * 0.5 = 0.05

        // propagate from B -> C (B has 0.1, transfers 0.1 * 0.5 * 0.5 = 0.025)
        spread_activation(b, &mut nodes, &edges);
        assert!((nodes[2].current_heat - 0.075).abs() < 1e-6);
    }

    #[test]
    fn test_spread_activation_missing_source_noop() {
        let a = Uuid::from_u128(20);
        let b = Uuid::from_u128(21);
        let mut nodes = vec![Node {
            id: b,
            label: "B".into(),
            pointer_summary: "B".into(),
            base_utility: 0.0,
            current_heat: 0.0,
            is_pinned: false,
        }];
        let edges = vec![Edge {
            source: a,
            target: b,
            edge_weight: 0.5,
            edge_type: EdgeType::Hebbian,
        }];

        // should be a no-op and not panic
        spread_activation(a, &mut nodes, &edges);
        assert_eq!(nodes[0].current_heat, 0.0);
    }
}
