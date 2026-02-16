use sulcus_local::start_background;
use sulcus_core::StorageBackend;
#[tokio::test]
async fn start_background_spawns_worker_and_updates_active_index() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = path;

    // Start background runtime with very short interval
    let (storage, handle) = start_background(Some(&db_url), 0.85, 1.0, 10, 50).await?;

    // insert node that should become active after worker tick
    storage.upsert_node(sulcus_core::graph::Node { id: uuid::Uuid::from_u128(500), summary: "RT".into(), heat: 100.0 }).await?;

    // wait for a couple intervals
    tokio::time::sleep(std::time::Duration::from_millis(180)).await;

    let active = storage.list_active_index(10).await?;
    assert!(!active.is_empty());

    // cleanup
    handle.abort();
    Ok(())
}
