use sulcus_core::StorageBackend;
use sqlx::Row;
use sulcus_local::{export_fold, import_fold, SqliteStorage};
use uuid::Uuid;

#[tokio::test]
async fn export_and_import_fold_roundtrip() -> anyhow::Result<()> {
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

    // create nodes and payloads
    let a = Uuid::from_u128(0xAAA1);
    let b = Uuid::from_u128(0xBBB2);
    storage.upsert_node(sulcus_core::graph::Node { id: a, label: "A".into(), pointer_summary: "A sum".into(), base_utility: 0.1, current_heat: 0.5, is_pinned: false }).await?;
    storage.upsert_node(sulcus_core::graph::Node { id: b, label: "B".into(), pointer_summary: "B sum".into(), base_utility: 0.2, current_heat: 0.2, is_pinned: false }).await?;
    storage.insert_payload(a, "content-a").await?;
    storage.insert_payload(b, "content-b").await?;

    // embeddings
    let emb_a = vec![0.1f32; 384];
    let emb_b = vec![0.9f32; 384];
    let blob_a: Vec<u8> = bytemuck::cast_slice(&emb_a).to_vec();
    let blob_b: Vec<u8> = bytemuck::cast_slice(&emb_b).to_vec();
    sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET vector = excluded.vector")
        .bind(a.to_string()).bind(blob_a).execute(storage.pool()).await?;
    sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET vector = excluded.vector")
        .bind(b.to_string()).bind(blob_b).execute(storage.pool()).await?;

    // edges
    storage.insert_edge(a, b, "semantic", 0.5).await?;

    // create fold and assign
    let fold_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO folds (id, name) VALUES (?, ?)").bind(&fold_id).bind("test-fold").execute(storage.pool()).await?;
    sqlx::query("INSERT INTO node_folds (node_id, fold_id) VALUES (?, ?)").bind(a.to_string()).bind(&fold_id).execute(storage.pool()).await?;
    sqlx::query("INSERT INTO node_folds (node_id, fold_id) VALUES (?, ?)").bind(b.to_string()).bind(&fold_id).execute(storage.pool()).await?;

    // export fold
    let out = tempfile::NamedTempFile::new()?;
    let out_path = out.path().to_str().unwrap().to_string();
    export_fold(&storage, "test-fold", &out_path).await?;

    // remove nodes + edges to ensure import restores them
    sqlx::query("DELETE FROM node_folds WHERE fold_id = ?").bind(&fold_id).execute(storage.pool()).await?;
    sqlx::query("DELETE FROM edges WHERE source_id = ? OR target_id = ?").bind(a.to_string()).bind(a.to_string()).execute(storage.pool()).await?;
    sqlx::query("DELETE FROM nodes WHERE id IN (?, ?)").bind(a.to_string()).bind(b.to_string()).execute(storage.pool()).await?;
    sqlx::query("DELETE FROM embeddings WHERE node_id IN (?, ?)").bind(a.to_string()).bind(b.to_string()).execute(storage.pool()).await?;
    sqlx::query("DELETE FROM payloads WHERE node_id IN (?, ?)").bind(a.to_string()).bind(b.to_string()).execute(storage.pool()).await?;

    // import
    import_fold(&storage, &out_path).await?;

    // verify nodes restored and assigned to fold
    let na = storage.get_node(a).await?.unwrap();
    let nb = storage.get_node(b).await?.unwrap();
    assert_eq!(na.pointer_summary, "A sum");
    assert_eq!(nb.pointer_summary, "B sum");

    let payload_a = storage.get_payload(a).await?;
    assert_eq!(payload_a.unwrap(), "content-a");

    let emb_row = sqlx::query("SELECT vector FROM embeddings WHERE node_id = ?").bind(a.to_string()).fetch_one(storage.pool()).await?;
    let vec_bytes: Vec<u8> = emb_row.try_get("vector")?;
    let vec_f: &[f32] = bytemuck::cast_slice(&vec_bytes);
    assert!((vec_f[0] - 0.1).abs() < 1e-6);

    // edges restored
    let edges = sqlx::query("SELECT source_id, target_id FROM edges WHERE source_id = ?").bind(a.to_string()).fetch_all(storage.pool()).await?;
    assert!(!edges.is_empty());

    // node_folds entries
    let nf = sqlx::query("SELECT node_id FROM node_folds WHERE fold_id = ?").bind(&fold_id).fetch_all(storage.pool()).await?;
    assert_eq!(nf.len(), 2);

    Ok(())
}
