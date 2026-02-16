use std::env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let args: Vec<String> = env::args().collect();
    let db = env::var("SULCUS_DB_PATH").ok();
    let interval_ms = env::var("SULCUS_THERM_INTERVAL_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(60_000u64);

    // default / legacy behaviour: run the long-lived sidecar
    if args.len() == 1 || args.get(1).map(|s| s.as_str()) == Some("serve") {
        return sulcus_local::serve(db.as_deref(), interval_ms).await;
    }

    match args.get(1).map(|s| s.as_str()).unwrap_or("") {
        "demo" => {
            // start background runtime, create some memory ops, run one tick and show active_index
            let (storage, handle) =
                sulcus_local::start_background(db.as_deref(), 0.85, 1.0, 20, interval_ms).await?;
            let id = uuid::Uuid::from_u128(rand::random::<u128>());
            let payload =
                serde_json::json!({ "id": id.to_string(), "summary": "demo-item", "heat": 42.0 });
            storage.record_memory_op("ADD", &payload).await?;

            // force a tick to rebuild active index immediately
            sulcus_local::tick(&storage, 0.85, 1.0, 20).await?;
            let active = storage.list_active_index(10).await?;
            println!("active_index: {:?}", active);

            // cleanup
            handle.abort();
            Ok(())
        }
        "add-memory" => {
            let summary = args.get(2).map(|s| s.as_str()).unwrap_or("demo");
            let heat: f32 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(10.0);
            let (storage, handle) =
                sulcus_local::start_background(db.as_deref(), 0.85, 1.0, 20, interval_ms).await?;
            let id = uuid::Uuid::from_u128(rand::random::<u128>());
            let payload =
                serde_json::json!({ "id": id.to_string(), "summary": summary, "heat": heat });
            storage.record_memory_op("ADD", &payload).await?;
            println!(
                "recorded memory op for id={} summary=\"{}\" heat={}",
                id, summary, heat
            );
            handle.abort();
            Ok(())
        }
        "list-ops" => {
            let (storage, handle) =
                sulcus_local::start_background(db.as_deref(), 0.85, 1.0, 20, interval_ms).await?;
            let ops = storage.list_memory_ops().await?;
            for (seq, typ, payload) in ops.into_iter() {
                println!("{} {} {}", seq, typ, payload);
            }
            handle.abort();
            Ok(())
        }
        "show-active" => {
            let (storage, handle) =
                sulcus_local::start_background(db.as_deref(), 0.85, 1.0, 20, interval_ms).await?;
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
            let (storage, handle) =
                sulcus_local::start_background(db.as_deref(), 0.85, 1.0, 20, interval_ms).await?;
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
            eprintln!("unknown command: {}\navailable: serve | demo | add-memory <summary> [heat] | list-ops | show-active | sync-now", other);
            std::process::exit(2);
        }
    }
}
