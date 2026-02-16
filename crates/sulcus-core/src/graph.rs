use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// A lightweight pointer in the `Map` (summary + activation heat).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Node {
    pub id: Uuid,
    pub summary: String,
    /// Heat range: 0.0 ..= 100.0 (not strictly enforced by the type)
    pub heat: f32,
}

/// Edge between nodes with a weight that governs heat flow.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Edge {
    pub source: Uuid,
    pub target: Uuid,
    /// 0.0 ..= 1.0
    pub weight: f32,
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
        n.heat *= decay;
        if n.heat < 0.0 {
            n.heat = 0.0;
        }
    }
}

/// Spread activation from `start` to its immediate neighbors using `edges`.
///
/// Algorithm (minimal, deterministic MVP):
/// - For every edge where `edge.source == start`, transfer `source_heat * edge.weight` to target.
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

    let source_heat = nodes[source_idx].heat;
    if source_heat <= 0.0 {
        return;
    }

    for e in edges.iter().filter(|e| e.source == start) {
        if let Some(&tidx) = index.get(&e.target) {
            let transfer = source_heat * e.weight;
            nodes[tidx].heat += transfer;
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
                summary: "A".into(),
                heat: 100.0,
            },
            Node {
                id: b_id,
                summary: "B".into(),
                heat: 0.0,
            },
        ];

        let edges = vec![Edge {
            source: a_id,
            target: b_id,
            weight: 0.1,
            edge_type: EdgeType::Hebbian,
        }];

        // Spread: B receives 100 * 0.1 = 10.0
        spread_activation(a_id, &mut nodes, &edges);
        assert!((nodes[1].heat - 10.0).abs() < f32::EPSILON);

        // Decay: multiply by 0.85
        apply_decay(&mut nodes, 0.85);
        assert!((nodes[0].heat - 85.0).abs() < 1e-6);
        assert!((nodes[1].heat - 8.5).abs() < 1e-6);
    }

    #[test]
    fn test_apply_decay_edge_cases() {
        let mut nodes = vec![
            Node {
                id: Uuid::from_u128(3),
                summary: "X".into(),
                heat: 10.0,
            },
            Node {
                id: Uuid::from_u128(4),
                summary: "Y".into(),
                heat: -5.0,
            },
        ];

        // decay to zero
        apply_decay(&mut nodes, 0.0);
        assert_eq!(nodes[0].heat, 0.0);
        assert_eq!(nodes[1].heat, 0.0);

        // growth-like decay (>1.0) scales values (0 remains 0)
        nodes[0].heat = 5.0;
        apply_decay(&mut nodes, 1.5);
        assert!((nodes[0].heat - 7.5).abs() < 1e-6);
    }

    #[test]
    fn test_spread_activation_multiple_edges() {
        let a = Uuid::from_u128(10);
        let b = Uuid::from_u128(11);
        let c = Uuid::from_u128(12);

        let mut nodes = vec![
            Node {
                id: a,
                summary: "A".into(),
                heat: 100.0,
            },
            Node {
                id: b,
                summary: "B".into(),
                heat: 0.0,
            },
            Node {
                id: c,
                summary: "C".into(),
                heat: 0.0,
            },
        ];

        let edges = vec![
            Edge {
                source: a,
                target: b,
                weight: 0.2,
                edge_type: EdgeType::Hebbian,
            },
            Edge {
                source: a,
                target: c,
                weight: 0.1,
                edge_type: EdgeType::Semantic,
            },
            Edge {
                source: b,
                target: c,
                weight: 0.5,
                edge_type: EdgeType::Hebbian,
            },
        ];

        spread_activation(a, &mut nodes, &edges);
        assert!((nodes[1].heat - 20.0).abs() < 1e-6);
        assert!((nodes[2].heat - 10.0).abs() < 1e-6);

        // propagate from B -> C
        spread_activation(b, &mut nodes, &edges);
        assert!((nodes[2].heat - 20.0).abs() < 1e-6);
    }

    #[test]
    fn test_spread_activation_missing_source_noop() {
        let a = Uuid::from_u128(20);
        let b = Uuid::from_u128(21);
        let mut nodes = vec![Node {
            id: b,
            summary: "B".into(),
            heat: 0.0,
        }];
        let edges = vec![Edge {
            source: a,
            target: b,
            weight: 0.5,
            edge_type: EdgeType::Hebbian,
        }];

        // should be a no-op and not panic
        spread_activation(a, &mut nodes, &edges);
        assert_eq!(nodes[0].heat, 0.0);
    }
}
