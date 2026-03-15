//! Shared test helpers for sulcus-local integration tests.

/// Returns the database URL for integration tests, if one is explicitly configured.
///
/// Returns `Some(url)` when `SULCUS_DATABASE_URL` is set in the environment.
/// Returns `None` when no external database is configured — callers should pass
/// `None` directly to `start_background` / `initialize` so that the embedded
/// Postgres instance is started automatically.
#[allow(dead_code)]
pub fn test_db_url() -> Option<String> {
    std::env::var("SULCUS_DATABASE_URL").ok()
}

use sqlx::postgres::PgPoolOptions;
use sulcus_local::LocalStorage;
use tokio::sync::OnceCell;

#[allow(dead_code)]
static PG_URL: OnceCell<String> = OnceCell::const_new();

/// Create a fresh storage instance in a unique schema for testing.
#[allow(dead_code)]
pub async fn make_storage() -> anyhow::Result<LocalStorage> {
    // Ensure database URL is initialized exactly once
    let db_url = PG_URL
        .get_or_init(|| async {
            if let Ok(url) = std::env::var("SULCUS_DATABASE_URL") {
                tracing::info!("Using external database for tests: {}", url);
                url
            } else {
                // Always use the integral embedded Postgres — no fallback to external default ports
                tracing::info!("Initializing embedded Postgres for tests");
                sulcus_local::initialize(None)
                    .await
                    .expect("Failed to initialize embedded PG")
            }
        })
        .await
        .clone();

    let connect_options: sqlx::postgres::PgConnectOptions =
        db_url.parse().expect("Failed to parse test DB URL");
    let connect_options = connect_options.statement_cache_capacity(0);

    let pool = PgPoolOptions::new()
        .max_connections(5) // smaller pool per test
        .connect_with(connect_options.clone())
        .await
        .expect("Failed to connect to test DB");

    // Create a unique schema for this test to allow concurrent execution
    let schema_name = format!("test_{}", uuid::Uuid::new_v4().simple());
    sqlx::raw_sql(&format!("CREATE SCHEMA {}", schema_name))
        .execute(&pool)
        .await
        .unwrap();

    // Set the search path for this connection pool
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .after_connect(move |conn, _meta| {
            let schema_name = schema_name.clone();
            Box::pin(async move {
                // Use the simple query protocol for SET search_path to avoid PGlite prepared statement bug.
                // We use raw sqlx::Executor::execute for this low-level hook.
                use sqlx::Executor;
                conn.execute(format!("SET search_path TO {}", schema_name).as_str())
                    .await?;
                Ok(())
            })
        })
        .connect_with(connect_options)
        .await
        .expect("Failed to connect to test DB with schema");

    // Run migrations once in the new schema
    for migration_sql in [
        include_str!("../../migrations/0001_create_tables.sql"),
        include_str!("../../migrations/0004_cognitive_thermodynamics.sql"),
        include_str!("../../migrations/0005_hnsw_cross_modal_namespace.sql"),
        include_str!("../../migrations/0006_p2p_peers.sql"),
        include_str!("../../migrations/0007_localized_diff_sync.sql"),
        include_str!("../../migrations/0007_edges_target_idx.sql"),
        include_str!("../../migrations/0008_fix_decay_math.sql"),
        include_str!("../../migrations/0009_thermo_node_fields.sql"),
    ] {
        let sql = migration_sql.replace("CREATE EXTENSION IF NOT EXISTS vector;", "");
        // Bypass prepared statement cache for migrations via raw_sql (simple protocol)
        if let Err(e) = sqlx::raw_sql(&sql).execute(&pool).await {
            let msg = e.to_string();
            // Ignore pgvector missing or already exists errors
            if !msg.contains("extension \"vector\" is not available")
                && !msg.contains("already exists")
            {
                eprintln!(
                    "Migration failed: {}\nSQL (first 100 chars): {}",
                    e,
                    &sql[..100.min(sql.len())]
                );
            }
        }
    }

    Ok(LocalStorage::from_pool(pool))
}
