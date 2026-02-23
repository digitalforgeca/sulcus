//! Shared test helpers for sulcus-local integration tests.
//!
//! Each call to `make_storage()` creates a fresh PostgreSQL schema with a UUID
//! suffix, runs all migrations inside it, and returns a `LocalStorage` whose
//! every connection has `search_path` set to that schema.  This gives full
//! test isolation even when tests run in parallel.
//!
//! Required env var (or falls back to the Docker Compose default):
//!   SULCUS_DATABASE_URL=postgres://sulcus:sulcus@localhost/sulcus_test

use sqlx::postgres::PgPoolOptions;
use sulcus_local::storage::LocalStorage;

/// Resolve the PostgreSQL test URL from the environment.
pub fn test_db_url() -> String {
    std::env::var("SULCUS_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://sulcus:sulcus@localhost/sulcus_test".to_string())
}

/// Create a fresh, isolated `LocalStorage` backed by a unique PostgreSQL schema.
///
/// The schema is prefixed with `t` followed by a UUID (without dashes) to
/// guarantee it starts with a letter and is valid as an unquoted identifier.
pub async fn make_storage() -> anyhow::Result<LocalStorage> {
    let db_url = test_db_url();
    let schema = format!("t{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
    make_storage_in_schema(&db_url, &schema).await
}

/// Create a `LocalStorage` in the given schema (schema is created if necessary).
pub async fn make_storage_in_schema(db_url: &str, schema: &str) -> anyhow::Result<LocalStorage> {
    // Use a single-connection admin pool to create the schema and run migrations.
    let admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(db_url)
        .await?;

    // Create schema (idempotent).
    sqlx::query(&format!("CREATE SCHEMA IF NOT EXISTS \"{}\"", schema))
        .execute(&admin_pool)
        .await?;

    // Set search_path for the admin connection and run migrations.
    sqlx::query(&format!("SET search_path TO \"{}\"", schema))
        .execute(&admin_pool)
        .await?;

    for migration_sql in [
        include_str!("../../migrations/0001_create_tables.sql"),
        include_str!("../../migrations/0002_typed_memories.sql"),
    ] {
        for stmt in migration_sql.split(';') {
            let s = stmt.trim();
            if s.is_empty() {
                continue;
            }
            // Ignore errors: migrations are idempotent.
            let _ = sqlx::query(s).execute(&admin_pool).await;
        }
    }

    admin_pool.close().await;

    // Build a pool that sets search_path on every new connection.
    let schema_owned = schema.to_string();
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .after_connect(move |conn, _meta| {
            let schema = schema_owned.clone();
            Box::pin(async move {
                sqlx::Executor::execute(
                    conn,
                    sqlx::query(&format!("SET search_path TO \"{}\"", schema)),
                )
                .await?;
                Ok(())
            })
        })
        .connect(db_url)
        .await?;

    Ok(LocalStorage::from_pool(pool))
}
