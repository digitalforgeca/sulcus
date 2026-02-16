use sulcus_local::HttpSyncEngine;

#[tokio::test]
async fn http_sync_engine_basic() -> anyhow::Result<()> {
    // covered by unit tests inside the module; just ensure it compiles and can be constructed
    let _ = HttpSyncEngine::new("http://localhost:12345", None);
    Ok(())
}
