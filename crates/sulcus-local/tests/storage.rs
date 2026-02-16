use sulcus_core::StorageBackend;
use sulcus_local::SqliteStorage;
use sulcus_core::graph::Node;
use uuid::Uuid;

#[tokio::test]
async fn sqlite_storage_crud_and_list_hot() -> anyhow::Result<()> {
    // Use a temporary file for sqlite
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    // Connect pool and run migrations using the SQL migration file (test runtime)
    let pool = sqlx::SqlitePool::connect(&db_url).await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() { continue; }
        sqlx::query(s).execute(&pool).await?;
    }

    let s = SqliteStorage::new(&db_url).await?;

    // Create two nodes
    let a = Node { id: Uuid::from_u128(10), summary: "Node A".into(), heat: 100.0 };
    let b = Node { id: Uuid::from_u128(11), summary: "Node B".into(), heat: 5.0 };

    s.upsert_node(a.clone()).await?;
    s.upsert_node(b.clone()).await?;

    // get_node
    let fetched = s.get_node(a.id).await?;
    assert!(fetched.is_some());
    let fetched = fetched.unwrap();
    assert_eq!(fetched.summary, "Node A");

    // list_hot_nodes (limit 1) should return A first
    let hot = s.list_hot_nodes(1).await?;
    assert_eq!(hot.len(), 1);
    assert_eq!(hot[0].id, a.id);

    Ok(())
}

#[tokio::test]
async fn sqlite_upsert_updates_existing() -> anyhow::Result<()> {
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

    let s = SqliteStorage::new(&db_url).await?;

    let id = Uuid::from_u128(20);
    let n1 = Node { id, summary: "original".into(), heat: 10.0 };
    s.upsert_node(n1.clone()).await?;

    let fetched = s.get_node(id).await?;
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().summary, "original");

    // update
    let n2 = Node { id, summary: "updated".into(), heat: 90.0 };
    s.upsert_node(n2.clone()).await?;

    let fetched = s.get_node(id).await?;
    let fetched = fetched.unwrap();
    assert_eq!(fetched.summary, "updated");
    assert!((fetched.heat - 90.0).abs() < f32::EPSILON);

    Ok(())
}

#[tokio::test]
async fn sqlite_get_node_none() -> anyhow::Result<()> {
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

    let s = SqliteStorage::new(&db_url).await?;

    let missing = Uuid::from_u128(9999);
    let fetched = s.get_node(missing).await?;
    assert!(fetched.is_none());

    Ok(())
}

#[tokio::test]
async fn list_hot_nodes_ordering_multiple() -> anyhow::Result<()> {
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

    let s = SqliteStorage::new(&db_url).await?;

    let a = Node { id: Uuid::from_u128(30), summary: "A".into(), heat: 1.0 };
    let b = Node { id: Uuid::from_u128(31), summary: "B".into(), heat: 50.0 };
    let c = Node { id: Uuid::from_u128(32), summary: "C".into(), heat: 10.0 };

    s.upsert_node(a).await?;
    s.upsert_node(b).await?;
    s.upsert_node(c).await?;

    let hot = s.list_hot_nodes(3).await?;
    assert_eq!(hot.len(), 3);
    assert_eq!(hot[0].summary, "B");
    assert_eq!(hot[1].summary, "C");
    assert_eq!(hot[2].summary, "A");

    Ok(())
}
