mod common;

use sulcus_core::StorageBackend;
use sulcus_core::graph::Node;
use uuid::Uuid;

#[tokio::test]
async fn local_storage_crud_and_list_hot() -> anyhow::Result<()> {
    let s = common::make_storage().await?;

    // Create two nodes (0..1 heat scale)
    let a = Node { id: Uuid::from_u128(10), label: "Node A".into(), pointer_summary: "Node A".into(), base_utility: 0.0, current_heat: 1.0, is_pinned: false, memory_type: "episodic".into(), modality: Node::default_modality(), source_mime: None, namespace: Node::default_namespace() };
    let b = Node { id: Uuid::from_u128(11), label: "Node B".into(), pointer_summary: "Node B".into(), base_utility: 0.0, current_heat: 0.05, is_pinned: false, memory_type: "episodic".into(), modality: Node::default_modality(), source_mime: None, namespace: Node::default_namespace() };

    s.upsert_node(a.clone()).await?;
    s.upsert_node(b.clone()).await?;

    // get_node
    let fetched = s.get_node(a.id).await?;
    assert!(fetched.is_some());
    let fetched = fetched.unwrap();
    assert_eq!(fetched.pointer_summary, "Node A");

    // list_hot_nodes (limit 1) should return A first
    let hot = s.list_hot_nodes(1).await?;
    assert_eq!(hot.len(), 1);
    assert_eq!(hot[0].id, a.id);

    Ok(())
}

#[tokio::test]
async fn local_upsert_updates_existing() -> anyhow::Result<()> {
    let s = common::make_storage().await?;

    let id = Uuid::from_u128(20);
    let n1 = Node { id, label: "original".into(), pointer_summary: "original".into(), base_utility: 0.0, current_heat: 0.10, is_pinned: false, memory_type: "episodic".into(), modality: Node::default_modality(), source_mime: None, namespace: Node::default_namespace() };
    s.upsert_node(n1.clone()).await?;

    let fetched = s.get_node(id).await?;
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().pointer_summary, "original");

    // update
    let n2 = Node { id, label: "updated".into(), pointer_summary: "updated".into(), base_utility: 0.0, current_heat: 0.90, is_pinned: false, memory_type: "episodic".into(), modality: Node::default_modality(), source_mime: None, namespace: Node::default_namespace() };
    s.upsert_node(n2.clone()).await?;

    let fetched = s.get_node(id).await?;
    let fetched = fetched.unwrap();
    assert_eq!(fetched.pointer_summary, "updated");
    assert!((fetched.current_heat - 0.90).abs() < f32::EPSILON);

    Ok(())
}

#[tokio::test]
async fn local_get_node_none() -> anyhow::Result<()> {
    let s = common::make_storage().await?;
    let missing = Uuid::from_u128(9999);
    let fetched = s.get_node(missing).await?;
    assert!(fetched.is_none());
    Ok(())
}

#[tokio::test]
async fn list_hot_nodes_ordering_multiple() -> anyhow::Result<()> {
    let s = common::make_storage().await?;

    let a = Node { id: Uuid::from_u128(30), label: "A".into(), pointer_summary: "A".into(), base_utility: 0.0, current_heat: 0.01, is_pinned: false, memory_type: "episodic".into(), modality: Node::default_modality(), source_mime: None, namespace: Node::default_namespace() };
    let b = Node { id: Uuid::from_u128(31), label: "B".into(), pointer_summary: "B".into(), base_utility: 0.0, current_heat: 0.50, is_pinned: false, memory_type: "episodic".into(), modality: Node::default_modality(), source_mime: None, namespace: Node::default_namespace() };
    let c = Node { id: Uuid::from_u128(32), label: "C".into(), pointer_summary: "C".into(), base_utility: 0.0, current_heat: 0.10, is_pinned: false, memory_type: "episodic".into(), modality: Node::default_modality(), source_mime: None, namespace: Node::default_namespace() };

    s.upsert_node(a).await?;
    s.upsert_node(b).await?;
    s.upsert_node(c).await?;

    let hot = s.list_hot_nodes(3).await?;
    assert_eq!(hot.len(), 3);
    assert_eq!(hot[0].pointer_summary, "B");
    assert_eq!(hot[1].pointer_summary, "C");
    assert_eq!(hot[2].pointer_summary, "A");

    Ok(())
}


    // Create two nodes (0..1 heat scale)
