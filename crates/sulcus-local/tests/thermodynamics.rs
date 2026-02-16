use sulcus_local::{SqliteStorage, tick};
use sulcus_core::StorageBackend;
use uuid::Uuid;

#[tokio::test]
async fn thermodynamics_tick_decays_and_updates_active_index() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() { continue; }
        sqlx::query(s).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;

    // Insert three nodes with differing heats
    let a = uuid::Uuid::from_u128(100);
    let b = uuid::Uuid::from_u128(101);
    let c = uuid::Uuid::from_u128(102);

    storage.upsert_node(sulcus_core::graph::Node { id: a, summary: "A".into(), heat: 100.0 }).await?;
    storage.upsert_node(sulcus_core::graph::Node { id: b, summary: "B".into(), heat: 50.0 }).await?;
    storage.upsert_node(sulcus_core::graph::Node { id: c, summary: "C".into(), heat: 0.5 }).await?;

    // run a tick: decay=0.85, prune_threshold=1.0, active_limit=2
    tick(&storage, 0.85, 1.0, 2).await?;

    // verify node heats were decayed
    let na = storage.get_node(a).await?.unwrap();
    let nb = storage.get_node(b).await?.unwrap();
    let nc = storage.get_node(c).await?.unwrap();

    assert!((na.heat - 85.0).abs() < 1e-6);
    assert!((nb.heat - 42.5).abs() < 1e-6);
    assert!((nc.heat - 0.425).abs() < 1e-6);

    // active_index should contain A and B only (C pruned)
    let active = storage.list_active_index(10).await?;
    assert_eq!(active.len(), 2);
    assert_eq!(active[0].0, a);
    assert_eq!(active[1].0, b);

    Ok(())
}

#[tokio::test]
async fn thermodynamics_tick_prunes_low_active_index_rows() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() { continue; }
        sqlx::query(s).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;

    let id = Uuid::from_u128(200);
    storage.upsert_node(sulcus_core::graph::Node { id, summary: "Z".into(), heat: 0.9 }).await?;
    storage.set_active_index(id, 0.9).await?; // low heat already in active_index

    // run a tick that will decay (0.9 * 0.8 = 0.72) and prune threshold is 1.0
    tick(&storage, 0.8, 1.0, 10).await?;

    let active = storage.list_active_index(10).await?;
    assert!(active.is_empty());

    Ok(())
}
