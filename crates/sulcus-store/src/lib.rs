//! sulcus-store — shared library for the embedded PostgreSQL storage engine.
//!
//! This cdylib isolates pg-embed + SQLx (the second heaviest dependency chain)
//! so it compiles independently. The main `sulcus-local` binary loads this via
//! `dlopen` through the progressive loader.
//!
//! Exports a C ABI for: database init, pool creation, basic CRUD operations,
//! and shutdown. All async operations are handled internally via a tokio runtime
//! owned by this dylib.

use std::ffi::{c_char, CStr, CString};
use std::sync::OnceLock;

use pg_embed::pg_enums::PgAuthMethod;
use pg_embed::pg_fetch::{PgFetchSettings, PG_V17};
use pg_embed::postgres::{PgEmbed, PgSettings};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use tokio::runtime::Runtime;
use tokio::sync::Mutex;

static RUNTIME: OnceLock<Runtime> = OnceLock::new();
static DB: OnceLock<Mutex<Option<PgEmbed>>> = OnceLock::new();
static POOL: OnceLock<PgPool> = OnceLock::new();

fn get_runtime() -> &'static Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("failed to create tokio runtime for sulcus-store")
    })
}

/// Initialize the embedded PostgreSQL instance and connection pool.
/// `data_dir` is the path to the data directory (null-terminated C string).
/// `port` is the TCP port for the embedded PG instance.
/// Returns 0 on success, non-zero on failure.
///
/// # Safety
/// `data_dir` must be a valid null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn sulcus_store_init(data_dir: *const c_char, port: u16) -> i32 {
    if data_dir.is_null() {
        return -1;
    }
    let dir = match CStr::from_ptr(data_dir).to_str() {
        Ok(s) => s.to_string(),
        Err(_) => return -2,
    };

    let rt = get_runtime();
    match rt.block_on(init_db(dir, port)) {
        Ok(()) => {
            tracing::info!("sulcus-store initialized");
            0
        }
        Err(e) => {
            tracing::error!(error = %e, "sulcus-store init failed");
            -3
        }
    }
}

async fn init_db(data_dir: String, port: u16) -> anyhow::Result<()> {
    let db_dir = std::path::PathBuf::from(&data_dir);
    let pg_dir = db_dir.join("pg");
    std::fs::create_dir_all(&pg_dir)?;

    let settings = PgSettings {
        database_dir: pg_dir.clone(),
        port: port.into(),
        user: "sulcus".to_string(),
        password: "sulcus".to_string(),
        auth_method: PgAuthMethod::Plain,
        persistent: true,
        timeout: Some(std::time::Duration::from_secs(30)),
        migration_dir: None,
    };

    let fetch = PgFetchSettings {
        version: PG_V17,
        ..Default::default()
    };

    let mut pg = PgEmbed::new(settings, fetch).await?;
    pg.setup().await?;
    pg.start_db().await?;

    let conn_str = format!(
        "host=localhost port={} user=sulcus password=sulcus dbname=sulcus",
        port
    );

    // Create the database if it doesn't exist
    let opts: PgConnectOptions = conn_str
        .replace("dbname=sulcus", "dbname=postgres")
        .parse()?;
    let tmp_pool = PgPoolOptions::new().max_connections(1).connect_with(opts).await?;
    sqlx::query("CREATE DATABASE sulcus")
        .execute(&tmp_pool)
        .await
        .ok(); // ignore "already exists"
    tmp_pool.close().await;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect_with(conn_str.parse()?)
        .await?;

    // Migrations are run by sulcus-local after obtaining the pool handle.
    // The store dylib only manages the database lifecycle and connection pool.

    let _ = POOL.set(pool);
    let _ = DB.get_or_init(|| Mutex::new(None));
    *DB.get().unwrap().lock().await = Some(pg);

    Ok(())
}

/// Get a JSON-encoded connection string for the initialized pool.
/// Returns null if not initialized.
#[no_mangle]
pub extern "C" fn sulcus_store_connection_info() -> *mut c_char {
    match POOL.get() {
        Some(_pool) => {
            let info = serde_json::json!({
                "status": "connected",
                "pool_size": 10,
            });
            CString::new(info.to_string())
                .map(|c| c.into_raw())
                .unwrap_or(std::ptr::null_mut())
        }
        None => std::ptr::null_mut(),
    }
}

/// Execute a raw SQL query and return results as JSON.
///
/// # Safety
/// `sql` must be a valid null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn sulcus_store_query(sql: *const c_char) -> *mut c_char {
    if sql.is_null() {
        return std::ptr::null_mut();
    }
    let pool = match POOL.get() {
        Some(p) => p,
        None => return std::ptr::null_mut(),
    };
    let query = match CStr::from_ptr(sql).to_str() {
        Ok(s) => s.to_string(),
        Err(_) => return std::ptr::null_mut(),
    };

    let rt = get_runtime();
    match rt.block_on(async {
        let rows = sqlx::query(&query).fetch_all(pool).await?;
        Ok::<_, anyhow::Error>(format!("{{\"rows\":{}}}", rows.len()))
    }) {
        Ok(json) => CString::new(json).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Err(e) => {
            let err = format!("{{\"error\":\"{}\"}}", e);
            CString::new(err).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut())
        }
    }
}

/// Shutdown the embedded PostgreSQL instance and close the pool.
/// Returns 0 on success.
#[no_mangle]
pub extern "C" fn sulcus_store_shutdown() -> i32 {
    let rt = get_runtime();
    rt.block_on(async {
        if let Some(pool) = POOL.get() {
            pool.close().await;
        }
        if let Some(db_lock) = DB.get() {
            let mut db = db_lock.lock().await;
            if let Some(mut pg) = db.take() {
                pg.stop_db().await.ok();
            }
        }
    });
    tracing::info!("sulcus-store shutdown complete");
    0
}

/// Free a string returned by any `sulcus_store_*` function.
///
/// # Safety
/// Must be a valid pointer returned by this library.
#[no_mangle]
pub unsafe extern "C" fn sulcus_store_free_string(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

/// Return the version of this dylib.
#[no_mangle]
pub extern "C" fn sulcus_store_version() -> *const c_char {
    static VERSION: &[u8] = b"0.1.0\0";
    VERSION.as_ptr() as *const c_char
}
