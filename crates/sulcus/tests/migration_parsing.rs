mod common;

/// Verify that both migration SQL files execute without error against a real PostgreSQL schema.
/// `common::make_storage()` creates a fresh schema, runs both migrations, and returns storage.
/// If we reach `Ok(())`, migrations parsed and executed successfully.
#[tokio::test]
async fn migration_statements_execute_without_semicolon_comment_split() -> anyhow::Result<()> {
    let _storage = common::make_storage().await?;
    Ok(())
}
