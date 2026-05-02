mod common;

use sulcus_core::StorageBackend;
use sulcus::{initialize, start_background};

// Use multi-threaded runtime so the background worker can tick concurrently.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn start_background_spawns_worker_and_updates_active_index() -> anyhow::Result<()> {
    let db_url = common::test_db_url();

    // Start background runtime with very short interval; prune_threshold=0.0 so all non-zero nodes appear
    // Pass None when no external DB is configured so the embedded Postgres is used.
    let (storage, handle) = start_background(db_url.as_deref(), 0.85, 0.0, 10, 50, None).await?;

    // insert node that should become active after worker tick
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: uuid::Uuid::from_u128(500),
            label: "RT".into(),
            pointer_summary: "RT".into(),
            base_utility: 0.0,
            current_heat: 100.0,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;

    // Wait for the background worker to complete at least one tick.
    // The worker has adaptive backoff and initialization overhead, so poll
    // repeatedly rather than relying on a single sleep (flaky on slow CI/hardware).
    let mut active = vec![];
    for _ in 0..10 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        active = storage.list_active_index(10).await?;
        if !active.is_empty() {
            break;
        }
    }
    assert!(
        !active.is_empty(),
        "active index still empty after 5s of polling"
    );

    // cleanup
    handle.abort();
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn start_background_accepts_database_url_from_env() -> anyhow::Result<()> {
    // Resolve a live DB URL: use the env var if set, otherwise spin up embedded PG first.
    let db_url = match common::test_db_url() {
        Some(url) => url,
        None => initialize(None).await?,
    };
    std::env::set_var("SULCUS_DATABASE_URL", &db_url);

    let (storage, handle) = start_background(None, 0.85, 1.0, 10, 50, None).await?;

    // basic storage ops should work
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: uuid::Uuid::from_u128(600),
            label: "parent-test".into(),
            pointer_summary: "parent-test".into(),
            base_utility: 0.0,
            current_heat: 100.0,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    let fetched = storage.get_node(uuid::Uuid::from_u128(600)).await?;
    assert!(fetched.is_some());

    // cleanup
    handle.abort();
    Ok(())
}
