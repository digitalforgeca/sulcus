//! Shared test helpers for sulcus-local integration tests.

use sqlx::postgres::{PgPool, PgPoolOptions};
use sulcus_local::LocalStorage;
use tokio::sync::OnceCell;

static SHARED_POOL: OnceCell<PgPool> = OnceCell::const_new();

pub fn test_db_url() -> String {
    std::env::var("SULCUS_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://sulcus:sulcus@localhost:5432/sulcus_test".to_string())
}

/// Create a fresh storage instance in a shared schema for testing.
pub async fn make_storage() -> anyhow::Result<LocalStorage> {
    let pool = SHARED_POOL.get_or_init(|| async {
        // Ensure embedded PG is started if no SULCUS_DATABASE_URL is set
        let db_url = if let Ok(url) = std::env::var("SULCUS_DATABASE_URL") {
            url
        } else {
            sulcus_local::initialize(None).await.expect("Failed to initialize embedded PG")
        };

        let pool = PgPoolOptions::new()
            .max_connections(50)
            .connect(&db_url)
            .await
            .expect("Failed to connect to test DB");

        // Run migrations once
        for migration_sql in [
            include_str!("../../migrations/0001_create_tables.sql"),
            include_str!("../../migrations/0002_typed_memories.sql"),
            include_str!("../../migrations/0003_crdt_clocks.sql"),
            include_str!("../../migrations/0004_cognitive_thermodynamics.sql"),
            include_str!("../../migrations/0005_hnsw_cross_modal_namespace.sql"),
        ] {
            use sqlx::Executor;
            if let Err(e) = pool.execute(migration_sql).await {
                let msg = e.to_string();
                // Ignore pgvector missing or already exists errors
                if !msg.contains("extension \"vector\" is not available") && !msg.contains("already exists") {
                    eprintln!("Migration failed: {}\nSQL (first 100 chars): {}", e, &migration_sql[..100.min(migration_sql.len())]);
                }
            }
        }
        pool
    }).await;

    Ok(LocalStorage::from_pool(pool.clone()))
}
