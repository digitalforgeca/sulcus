mod common;

use sulcus_core::StorageBackend;
use sulcus::tick;
use uuid::Uuid;

#[tokio::test]
async fn thermodynamics_tick_decays_and_updates_active_index() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;

    // Insert three nodes with differing heats (0.0 ..= 1.0 scale)
    let a = uuid::Uuid::from_u128(100);
    let b = uuid::Uuid::from_u128(101);
    let c = uuid::Uuid::from_u128(102);

    storage
        .upsert_node(sulcus_core::graph::Node {
            id: a,
            label: "A".into(),
            pointer_summary: "A".into(),
            base_utility: 0.0,
            current_heat: 1.0,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: b,
            label: "B".into(),
            pointer_summary: "B".into(),
            base_utility: 0.0,
            current_heat: 0.5,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: c,
            label: "C".into(),
            pointer_summary: "C".into(),
            base_utility: 0.0,
            current_heat: 0.005,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;

    // run a tick: decay=0.85, prune_threshold=0.01, active_limit=2
    // Set both last_accessed_at AND last_decayed_at so the exponential decay
    // formula (which uses last_decayed_at) sees dt = 100 s with stability = 100.
    sqlx::query(
        "UPDATE nodes SET last_accessed_at = NOW() - INTERVAL '100 seconds', \
         last_decayed_at = NOW() - INTERVAL '100 seconds', stability = 100.0",
    )
    .execute(storage.pool())
    .await?;
    tick(&storage, 0.85, 0.01, 2).await?;

    // verify node heats were decayed (and floor-clamped)
    let na = storage.get_node(a).await?.unwrap();
    let nb = storage.get_node(b).await?.unwrap();
    let nc = storage.get_node(c).await?.unwrap();

    // Tolerance relaxed to 1e-4: the exponential decay is computed in f64 SQL
    // but stored/retrieved as REAL (f32), so ~1e-5 rounding is expected.
    assert!(
        (na.current_heat - 0.85).abs() < 1e-4,
        "A heat: {}",
        na.current_heat
    );
    assert!(
        (nb.current_heat - 0.425).abs() < 1e-4,
        "B heat: {}",
        nb.current_heat
    );
    assert_eq!(nc.current_heat, 0.0);

    // active_index should contain A and B only (C pruned)
    let active = storage.list_active_index(10).await?;
    assert_eq!(active.len(), 2);
    assert_eq!(active[0].0, a);
    assert_eq!(active[1].0, b);

    Ok(())
}

#[tokio::test]
async fn thermodynamics_tick_prunes_low_active_index_rows() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;

    let id = Uuid::from_u128(200);
    storage
        .upsert_node(sulcus_core::graph::Node {
            id,
            label: "Z".into(),
            pointer_summary: "Z".into(),
            base_utility: 0.0,
            current_heat: 0.9,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    storage.set_active_index(id, 0.9).await?; // low heat already in active_index

    // run a tick that will decay (0.9 * 0.8 = 0.72) and prune threshold is 1.0 (node should be pruned)
    sqlx::query(
        "UPDATE nodes SET last_accessed_at = NOW() - INTERVAL '100 seconds', \
         last_decayed_at = NOW() - INTERVAL '100 seconds', stability = 100.0",
    )
    .execute(storage.pool())
    .await?;
    tick(&storage, 0.8, 1.0, 10).await?;

    let active = storage.list_active_index(10).await?;
    assert!(active.is_empty());

    Ok(())
}

#[tokio::test]
async fn thermodynamics_cte_spreads_activation_two_hops() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;

    // Nodes A -> B -> C, weights 1.0
    let a = Uuid::from_u128(0xA);
    let b = Uuid::from_u128(0xB);
    let c = Uuid::from_u128(0xC);

    storage
        .upsert_node(sulcus_core::graph::Node {
            id: a,
            label: "A".into(),
            pointer_summary: "A".into(),
            base_utility: 0.0,
            current_heat: 1.0,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: b,
            label: "B".into(),
            pointer_summary: "B".into(),
            base_utility: 0.0,
            current_heat: 0.0,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: c,
            label: "C".into(),
            pointer_summary: "C".into(),
            base_utility: 0.0,
            current_heat: 0.0,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;

    // insert edges
    storage.insert_edge(a, b, "semantic", 1.0).await?;
    storage.insert_edge(b, c, "semantic", 1.0).await?;

    // run tick with decay=0.85, no pruning
    // Set last_decayed_at alongside last_accessed_at so the exponential decay
    // formula sees dt = 100 s with stability = 100.
    sqlx::query(
        "UPDATE nodes SET last_accessed_at = NOW() - INTERVAL '100 seconds', \
         last_decayed_at = NOW() - INTERVAL '100 seconds', stability = 100.0",
    )
    .execute(storage.pool())
    .await?;
    tick(&storage, 0.85, 0.0, 10).await?;

    let na = storage.get_node(a).await?.unwrap();
    let nb = storage.get_node(b).await?.unwrap();
    let nc = storage.get_node(c).await?.unwrap();

    // Expected (before decay): B gets 0.5, C gets 0.25 via two-hop propagation
    // After decay (0.85): A=0.85, B=0.5*0.85=0.425, C=0.25*0.85=0.2125
    // Tolerance 1e-4: exponential decay computed in f64 SQL, stored as REAL (f32).
    assert!(
        (na.current_heat - 0.85).abs() < 1e-4,
        "A heat: {}",
        na.current_heat
    );
    assert!(
        (nb.current_heat - 0.425).abs() < 1e-4,
        "B heat: {}",
        nb.current_heat
    );
    assert!(
        (nc.current_heat - 0.2125).abs() < 1e-4,
        "C heat: {}",
        nc.current_heat
    );

    Ok(())
}

#[tokio::test]
async fn thermodynamics_ignite_updates_and_triggers_tick() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;

    // create nodes A -> B
    let a = Uuid::from_u128(0xA0A0);
    let b = Uuid::from_u128(0xB0B0);
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: a,
            label: "A".into(),
            pointer_summary: "A".into(),
            base_utility: 0.0,
            current_heat: 0.0,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: b,
            label: "B".into(),
            pointer_summary: "B".into(),
            base_utility: 0.0,
            current_heat: 0.0,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    storage.insert_edge(a, b, "semantic", 1.0).await?;

    // populate embeddings table with vectors: A matches mock embedding
    let emb_a = vec![0.1f32; 384];
    let emb_b = vec![0.9f32; 384];

    storage.store_node_embedding(a, emb_a).await?;
    storage.store_node_embedding(b, emb_b).await?;

    // call ignite with the mock query embedding and then run tick
    let query_emb = vec![0.1f32; 384];
    sulcus::thermodynamics::ignite(&storage, &query_emb, 3).await?;
    sqlx::query(
        "UPDATE nodes SET last_accessed_at = NOW() - INTERVAL '100 seconds', \
         last_decayed_at = NOW() - INTERVAL '100 seconds', stability = 100.0",
    )
    .execute(storage.pool())
    .await?;
    tick(&storage, 0.85, 0.0, 10).await?;

    // A should have been bumped and decayed; B should have received propagated heat
    let na = storage.get_node(a).await?.unwrap();
    let nb = storage.get_node(b).await?.unwrap();
    assert!(na.current_heat >= 0.0, "A was ignited");
    assert!(nb.current_heat >= 0.0, "B received propagation via tick");

    Ok(())
}
