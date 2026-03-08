#[tokio::test]
async fn test_search_vectors() -> anyhow::Result<()> {
    let db_url = std::env::var("SULCUS_DATABASE_URL").unwrap_or_else(|_| "postgres://sulcus:sulcus@localhost:5432/sulcus_test".to_string());
    let pool = sqlx::postgres::PgPoolOptions::new().max_connections(5).connect(&db_url).await.unwrap();
    let storage = sulcus_local::LocalStorage::from_pool(pool);
    
    let emb = vec![0.1f32; 384];
    let topk = storage.search_vectors(&emb, 3).await;
    println!("TOPK: {:?}", topk);
    Ok(())
}
