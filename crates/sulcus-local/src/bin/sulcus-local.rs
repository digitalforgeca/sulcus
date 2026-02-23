use std::env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Always direct tracing/log output to stderr so it does not pollute stdout,
    // which is used by the `stdio` MCP subcommand for JSON-RPC messages.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();

    let args: Vec<String> = env::args().collect();

    // load optional INI config then let environment variables override values
    let cfg = sulcus_local::Config::load();

    let db = std::env::var("SULCUS_DATABASE_URL").ok().or(cfg.database_url.clone());
    let interval_ms = std::env::var("SULCUS_THERM_INTERVAL_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .or(cfg.therm_interval_ms)
        .unwrap_or(60_000u64);

    // thermodynamics tuning (configurable via INI)
    let decay = cfg.decay.unwrap_or(0.85);
    let prune_threshold = cfg.prune_threshold.unwrap_or(1.0);
    let active_limit = cfg.active_limit.unwrap_or(20usize);

    // default / legacy behaviour: run the long-lived sidecar
    if args.len() == 1 || args.get(1).map(|s| s.as_str()) == Some("serve") {
        return sulcus_local::serve(db.as_deref(), interval_ms).await;
    }

    // stdio: newline-delimited JSON-RPC over stdin/stdout (no port binding; multi-client safe)
    if args.get(1).map(|s| s.as_str()) == Some("stdio") {
        return sulcus_local::serve_stdio(db.as_deref(), interval_ms).await;
    }

    match args.get(1).map(|s| s.as_str()).unwrap_or("") {
        "demo" => {
            // start background runtime, create some memory ops, run one tick and show active_index
            let (storage, handle) = sulcus_local::start_background(
                db.as_deref(),
                decay,
                prune_threshold,
                active_limit,
                interval_ms,
            )
            .await?;
            let id = uuid::Uuid::from_u128(rand::random::<u128>());
            let payload =
                serde_json::json!({ "id": id.to_string(), "pointer_summary": "demo-item", "current_heat": 0.42, "base_utility": 0.0, "is_pinned": false });
            storage.record_memory_op("ADD", &payload).await?;

            // force a tick to rebuild active index immediately
            sulcus_local::tick(&storage, decay, prune_threshold, active_limit).await?;
            let active = storage.list_active_index(10).await?;
            println!("active_index: {:?}", active);

            // cleanup
            handle.abort();
            Ok(())
        }
        "add-memory" => {
            let summary = args.get(2).map(|s| s.as_str()).unwrap_or("demo");
            let heat: f32 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(10.0);
            let (storage, handle) = sulcus_local::start_background(
                db.as_deref(),
                decay,
                prune_threshold,
                active_limit,
                interval_ms,
            )
            .await?;
            let id = uuid::Uuid::from_u128(rand::random::<u128>());
            let payload = serde_json::json!({ "id": id.to_string(), "pointer_summary": summary, "current_heat": heat, "base_utility": 0.0, "is_pinned": false });
            storage.record_memory_op("ADD", &payload).await?;
            println!(
                "recorded memory op for id={} pointer_summary=\"{}\" current_heat={}",
                id, summary, heat
            );
            handle.abort();
            Ok(())
        }
        "summarize" => {
            // usage: sulcus-local summarize "text to summarize" [max_chars]
            let text = if let Some(t) = args.get(2) {
                t.to_string()
            } else {
                // read from stdin when no arg provided
                use std::io::Read;
                let mut buf = String::new();
                std::io::stdin().read_to_string(&mut buf)?;
                buf
            };
            let max_chars: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(500);
            let (storage, handle) = sulcus_local::start_background(
                db.as_deref(),
                decay,
                prune_threshold,
                active_limit,
                interval_ms,
            )
            .await?;
            let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> = match sulcus_local::FastEmbedProvider::try_new() {
                Ok(e) => std::sync::Arc::new(e),
                Err(_) => std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new()),
            };
            let handler = sulcus_local::McpHandler::new(storage.clone(), embedder);
            let summary = handler.summarize(&text, max_chars).await?;
            println!("{}", summary);
            handle.abort();
            Ok(())
        }
        "describe-tools" => {
            // prints a JSON manifest describing available CLI/MCP tools
            let (storage, handle) = sulcus_local::start_background(
                db.as_deref(),
                decay,
                prune_threshold,
                active_limit,
                interval_ms,
            )
            .await?;
            let embedder: std::sync::Arc<dyn sulcus_local::embeddings::EmbeddingProvider> = match sulcus_local::FastEmbedProvider::try_new() {
                Ok(e) => std::sync::Arc::new(e),
                Err(_) => std::sync::Arc::new(sulcus_local::MockEmbeddingProvider::new()),
            };
            let handler = sulcus_local::McpHandler::new(storage.clone(), embedder);
            let manifest = handler.describe_tools().await?;
            println!("{}", serde_json::to_string_pretty(&manifest)?);
            handle.abort();
            Ok(())
        }
        "list-ops" => {
            let (storage, handle) = sulcus_local::start_background(
                db.as_deref(),
                decay,
                prune_threshold,
                active_limit,
                interval_ms,
            )
            .await?;
            let ops = storage.list_memory_ops().await?;
            for (seq, typ, payload) in ops.into_iter() {
                println!("{} {} {}", seq, typ, payload);
            }
            handle.abort();
            Ok(())
        }
        "show-active" => {
            let (storage, handle) = sulcus_local::start_background(
                db.as_deref(),
                decay,
                prune_threshold,
                active_limit,
                interval_ms,
            )
            .await?;
            let active = storage.list_active_index(20).await?;
            for (id, heat) in active.iter() {
                println!("{} -> {}", id, heat);
            }
            handle.abort();
            Ok(())
        }
        "sync-now" => {
            let server = std::env::var("SULCUS_SERVER_URL")
                .expect("SULCUS_SERVER_URL required for sync-now");
            let api_key = std::env::var("SULCUS_API_KEY").ok();
            let (storage, handle) = sulcus_local::start_background(
                db.as_deref(),
                decay,
                prune_threshold,
                active_limit,
                interval_ms,
            )
            .await?;
            let engine = sulcus_local::HttpSyncEngine::new(server, api_key);
            let mut client = sulcus_local::LocalSyncClient::new(storage.clone());
            client.push_to_engine(&engine).await?;
            client.pull_from_engine_and_apply(&engine, None).await?;

            // surface persisted sync state for diagnostics
            if let Some(cursor) = storage.get_server_cursor().await? {
                println!("server_cursor: {}", cursor);
            }
            if let Some(seq) = storage.get_server_cursor_seq().await? {
                println!("server_cursor_seq: {}", seq);
            }
            if let Some(last) = storage.get_last_seq().await? {
                println!("local_last_seq: {}", last);
            }

            println!("sync-now complete");
            handle.abort();
            Ok(())
        }
        other => {
            eprintln!("unknown command: {}\navailable: serve | demo | add-memory <summary> [heat] | summarize | describe-tools | list-ops | show-active | sync-now", other);
            std::process::exit(2);
        }
    }
}
