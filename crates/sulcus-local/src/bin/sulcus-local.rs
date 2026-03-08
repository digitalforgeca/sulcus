use std::env;
use sulcus_core::StorageBackend;
use uuid::Uuid;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Basic tracing setup
    tracing_subscriber::fmt::fmt()
        .with_writer(std::io::stderr)
        .init();

    let mut args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: sulcus-local [--config <path>] <command> [args]");
        eprintln!("Available commands: serve | stdio | init | reinit [--force-external] | demo | add-memory <summary> [heat] | summarize | describe-tools | list-ops | show-active | sync-now | metrics | list-hot");
        std::process::exit(1);
    }

    // handle --config flag
    if args[1] == "--config" {
        if args.len() < 4 {
            eprintln!("Error: --config requires a path and a command.");
            std::process::exit(1);
        }
        let config_path = args[2].clone();
        env::set_var("SULCUS_CONFIG", config_path);
        // Remove --config and path from args
        args.remove(1);
        args.remove(1);
    }

    let config = sulcus_local::config::Config::load();
    if let Some(url) = config.server_url {
        if env::var("SULCUS_SERVER_URL").is_err() {
            env::set_var("SULCUS_SERVER_URL", url);
        }
    }
    if let Some(key) = config.server_api_key {
        if env::var("SULCUS_API_KEY").is_err() {
            env::set_var("SULCUS_API_KEY", key);
        }
    }
    if let Some(db) = config.database_url {
        if env::var("SULCUS_DATABASE_URL").is_err() {
            env::set_var("SULCUS_DATABASE_URL", db);
        }
    }

    let db = env::var("SULCUS_DATABASE_URL").ok();
    if let Some(ref db_url) = db {
        if db_url.starts_with("sqlite:") {
            anyhow::bail!(
                "SQLite DSNs are not supported in sulcus-local. Unset SULCUS_DATABASE_URL to use encapsulated local PGlite, or set it to a reachable PostgreSQL-compatible URL."
            );
        }
    }

    // Default thermodynamics parameters
    let interval_ms = env::var("SULCUS_TICK_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .or(config.therm_interval_ms)
        .unwrap_or(1000);

    let active_limit = env::var("SULCUS_ACTIVE_LIMIT")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .or(config.active_limit)
        .unwrap_or(20);

    let cmd = args[1].as_str();
    match cmd {
        "serve" => {
            sulcus_local::serve(db.as_deref(), interval_ms, active_limit).await?;
            Ok(())
        }
        "stdio" => {
            sulcus_local::serve_stdio(db.as_deref(), interval_ms, active_limit).await?;
            Ok(())
        }
        "init" => {
            let url = sulcus_local::initialize(db.as_deref()).await?;
            println!("Storage initialized at: {}", url);
            Ok(())
        }
        "reinit" => {
            let force_external = args.get(2).map(|s| s == "--force-external").unwrap_or(false);
            let url = if force_external && db.is_some() {
                let pool = sqlx::PgPool::connect(db.as_deref().unwrap()).await?;
                sqlx::query("DROP SCHEMA IF EXISTS public CASCADE").execute(&pool).await?;
                sqlx::query("CREATE SCHEMA public").execute(&pool).await?;
                sulcus_local::initialize(db.as_deref()).await?
            } else {
                sulcus_local::reinitialize_local().await?
            };
            println!("Storage re-initialized at: {}", url);
            Ok(())
        }
        "demo" => {
            println!("Seeding demo data into SULCUS...");
            let db_url = sulcus_local::initialize(db.as_deref()).await?;
            let storage = sulcus_local::LocalStorage::new(&db_url).await?;
            
            let demo_nodes = vec![
                ("SULCUS Architecture", "The vMMU uses a thermodynamic graph where nodes gain heat on use and decay over time.", "semantic"),
                ("Memory Paging", "Context window overflow is prevented by paging out cold nodes to the embedded Postgres backend.", "semantic"),
                ("Zero-Copy Access", "rkyv and mmap are used to share the hot memory index with the agent runtime without deserialization overhead.", "semantic"),
            ];

            for (label, summary, mtype) in demo_nodes {
                let id = Uuid::now_v7();
                storage.upsert_node(sulcus_core::graph::Node {
                    id,
                    label: label.to_string(),
                    pointer_summary: summary.to_string(),
                    base_utility: 0.5,
                    current_heat: 1.0,
                    is_pinned: false,
                    memory_type: mtype.to_string(),
                    modality: sulcus_core::graph::Node::default_modality(),
                    source_mime: None,
                    namespace: sulcus_core::graph::Node::default_namespace(),
                }).await?;
                storage.record_memory_op("ADD", &serde_json::json!({ "id": id.to_string(), "label": label, "pointer_summary": summary, "current_heat": 1.0 })).await?;
            }
            println!("Demo data seeded successfully.");
            maybe_shutdown_embedded(db.as_deref()).await;
            Ok(())
        }
        "add-memory" => {
            if args.len() < 3 {
                eprintln!("Usage: sulcus-local add-memory <summary> [heat]");
                std::process::exit(1);
            }
            let summary = &args[2];
            let heat = args.get(3).and_then(|s| s.parse::<f32>().ok()).unwrap_or(1.0);
            let db_url = sulcus_local::initialize(db.as_deref()).await?;
            let storage = sulcus_local::LocalStorage::new(&db_url).await?;
            let id = Uuid::now_v7();
            storage
                .upsert_node(sulcus_core::graph::Node {
                    id,
                    label: summary.chars().take(40).collect(),
                    pointer_summary: summary.clone(),
                    base_utility: 0.0,
                    current_heat: heat,
                    is_pinned: false,
                    memory_type: "episodic".to_string(),
                    modality: sulcus_core::graph::Node::default_modality(),
                    source_mime: None,
                    namespace: sulcus_core::graph::Node::default_namespace(),
                })
                .await?;
            storage.record_memory_op("ADD", &serde_json::json!({ "id": id.to_string(), "label": summary.chars().take(40).collect::<String>(), "pointer_summary": summary, "current_heat": heat })).await?;
            println!("Added memory node: {}", id);
            maybe_shutdown_embedded(db.as_deref()).await;
            Ok(())
        }
        "summarize" => {
            let mut input = String::new();
            use std::io::Read;
            std::io::stdin().read_to_string(&mut input)?;
            let db_url = sulcus_local::initialize(db.as_deref()).await?;
            let storage = sulcus_local::LocalStorage::new(&db_url).await?;
            let embedder: Arc<dyn sulcus_local::EmbeddingProvider> = Arc::new(sulcus_local::FastEmbedProvider::try_new()?);
            let handler = sulcus_local::McpHandler::new(storage, embedder, active_limit);
            let summary = handler.summarize(&input, 500).await?;
            println!("{}", summary);
            maybe_shutdown_embedded(db.as_deref()).await;
            Ok(())
        }
        "describe-tools" => {
            let db_url = sulcus_local::initialize(db.as_deref()).await?;
            let storage = sulcus_local::LocalStorage::new(&db_url).await?;
            let embedder: Arc<dyn sulcus_local::EmbeddingProvider> = Arc::new(sulcus_local::FastEmbedProvider::try_new()?);
            let handler = sulcus_local::McpHandler::new(storage, embedder, active_limit);
            let req = serde_json::json!({ "jsonrpc": "2.0", "id": "1", "method": "tools/list" });
            let resp = handler.handle_request(&req.to_string()).await?;
            println!("{}", resp);
            maybe_shutdown_embedded(db.as_deref()).await;
            Ok(())
        }
        "list-ops" | "list-memory-ops" => {
            let db_url = sulcus_local::initialize(db.as_deref()).await?;
            let storage = sulcus_local::LocalStorage::new(&db_url).await?;
            let ops: Vec<(i64, String, serde_json::Value)> = storage.list_memory_ops_internal().await?;
            for (seq, typ, payload) in ops.into_iter() {
                println!("{} {} {}", seq, typ, payload);
            }
            maybe_shutdown_embedded(db.as_deref()).await;
            Ok(())
        }
        "show-active" => {
            let db_url = sulcus_local::initialize(db.as_deref()).await?;
            let storage = sulcus_local::LocalStorage::new(&db_url).await?;
            let active: Vec<(Uuid, f32)> = storage.list_active_index(100).await?;
            for (id, heat) in active.iter() {
                println!("{} -> {}", id, heat);
            }
            maybe_shutdown_embedded(db.as_deref()).await;
            Ok(())
        }
        "sync-now" => {
            let server_url = env::var("SULCUS_SERVER_URL").map_err(|_| anyhow::anyhow!("SULCUS_SERVER_URL not set"))?;
            let api_key = env::var("SULCUS_API_KEY").ok();
            let db_url = sulcus_local::initialize(db.as_deref()).await?;
            let storage = sulcus_local::LocalStorage::new(&db_url).await?;
            let engine = sulcus_local::HttpSyncEngine::new(server_url, api_key);
            let mut client = sulcus_local::LocalSyncClient::new(storage);
            client.load_persisted_state().await?;
            client.pull_from_engine_and_apply(&engine, None).await?;
            client.push_to_engine(&engine).await?;
            println!("Sync complete.");
            maybe_shutdown_embedded(db.as_deref()).await;
            Ok(())
        }
        "metrics" => {
            let db_url = sulcus_local::initialize(db.as_deref()).await?;
            let storage = sulcus_local::LocalStorage::new(&db_url).await?;
            let nodes = storage.count_nodes().await?;
            let ops = storage.memory_ops_count().await?;
            println!("Nodes: {}, Pending Ops: {}", nodes, ops);
            maybe_shutdown_embedded(db.as_deref()).await;
            Ok(())
        }
        "list-hot" => {
            let limit = args.get(2).and_then(|s| s.parse::<usize>().ok()).unwrap_or(20);
            let db_url = sulcus_local::initialize(db.as_deref()).await?;
            let storage = sulcus_local::LocalStorage::new(&db_url).await?;
            let hot = storage.list_hot_nodes(limit).await?;
            for n in hot {
                println!("{}: {} (heat: {:.2})", n.id, n.label, n.current_heat);
            }
            maybe_shutdown_embedded(db.as_deref()).await;
            Ok(())
        }
        other => {
            eprintln!("Unknown command: '{}'. Available: serve | stdio | init | reinit [--force-external] | demo | add-memory <summary> [heat] | summarize | describe-tools | list-ops | show-active | sync-now | metrics | list-hot", other);
            std::process::exit(2);
        }
    }
}

async fn maybe_shutdown_embedded(db_url: Option<&str>) {
    if db_url.is_none() {
        let _ = sulcus_local::shutdown_embedded_postgres().await;
    }
}
