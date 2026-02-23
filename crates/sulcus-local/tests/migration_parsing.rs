use sqlx::sqlite::SqlitePoolOptions;

#[tokio::test]
async fn migration_statements_execute_without_semicolon_comment_split() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_url)
        .await?;
    let sql = include_str!("../migrations/0001_create_tables.sql");

    // split on ';' the same way runtime does and ensure every trimmed statement runs
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() { continue; }
        sqlx::query(s).execute(&pool).await?;
    }

    Ok(())
}
