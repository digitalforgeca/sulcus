use sulcus_core::StorageBackend;
use sulcus_local::start_background;
#[tokio::test]
async fn start_background_spawns_worker_and_updates_active_index() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = path;

    // Start background runtime with very short interval
    let (storage, handle) = start_background(Some(&db_url), 0.85, 1.0, 10, 50).await?;

    // insert node that should become active after worker tick
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: uuid::Uuid::from_u128(500),
            label: "RT".into(),
            pointer_summary: "RT".into(),
            base_utility: 0.0,
            current_heat: 100.0,
            is_pinned: false,
        })
        .await?;

    // wait for a couple intervals
    tokio::time::sleep(std::time::Duration::from_millis(180)).await;

    let active = storage.list_active_index(10).await?;
    assert!(!active.is_empty());

    // cleanup
    handle.abort();
    Ok(())
}

#[tokio::test]
async fn start_background_creates_parent_dirs_and_file_for_custom_db_path() -> anyhow::Result<()> {
    // create a temp dir and point db to a nested (non-existent) path inside it
    let td = tempfile::tempdir()?;
    let nested = td.path().join("nested/level/dbdir");
    let db_path = nested.join("memory.db");
    let db_s = db_path.to_str().unwrap().to_string();

    // parent does not exist yet
    assert!(!nested.exists());

    // start background with custom path (should create parents and file)
    let (storage, handle) = start_background(Some(&db_s), 0.85, 1.0, 10, 50).await?;

    // file and parent must now exist
    assert!(nested.exists());
    assert!(db_path.exists());

    // basic storage ops should work
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: uuid::Uuid::from_u128(600),
            label: "parent-test".into(),
            pointer_summary: "parent-test".into(),
            base_utility: 0.0,
            current_heat: 100.0,
            is_pinned: false,
        })
        .await?;
    let fetched = storage.get_node(uuid::Uuid::from_u128(600)).await?;
    assert!(fetched.is_some());

    // cleanup
    handle.abort();
    Ok(())
}
