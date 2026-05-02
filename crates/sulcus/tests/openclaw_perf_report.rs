mod common;

use std::time::Instant;

use sulcus_core::StorageBackend;
use sulcus::McpHandler;

// Simple performance / cost-benefit report for OpenClaw configurations.
// Prints a small table comparing `active_limit` values (recall vs tick latency vs DB size).
#[tokio::test]
async fn openclaw_perf_report() -> anyhow::Result<()> {
    // helper that prepares storage, inserts nodes with increasing heat, runs tick and measures metrics
    async fn measure_for_active_limit(
        active_limit: usize,
    ) -> anyhow::Result<(usize, f64, f64, u64)> {
        // Provision isolated PostgreSQL storage (shared PGlite/PG backend).
        let storage = common::make_storage().await?;
        let embedder: std::sync::Arc<dyn sulcus::embeddings::EmbeddingProvider> =
            std::sync::Arc::new(sulcus::MockEmbeddingProvider::new());
        let handler = McpHandler::new(storage.clone(), embedder.clone(), 20);

        // upsert 100 nodes with increasing heat
        for i in 1..=100 {
            let id = uuid::Uuid::from_u128(i as u128);
            let label = format!("mem-{}", i);
            let pointer_summary = label.clone();
            let current_heat = i as f32;
            storage
                .upsert_node(sulcus_core::graph::Node {
                    id,
                    label,
                    pointer_summary,
                    base_utility: 0.0,
                    current_heat,
                    is_pinned: false,
                    memory_type: "episodic".to_string(),
                    modality: sulcus_core::graph::Node::default_modality(),
                    source_mime: None,
                    namespace: sulcus_core::graph::Node::default_namespace(),
                })
                .await?;
        }

        // measure tick latency
        let start = Instant::now();
        sulcus::tick(&storage, 0.85, 1.0, active_limit).await?;
        let tick_ms = start.elapsed().as_secs_f64() * 1000.0;

        // measure resource latency (active_index fetch)
        let rstart = Instant::now();
        let list = handler.active_index(active_limit).await?;
        let resource_ms = rstart.elapsed().as_secs_f64() * 1000.0;
        // active_index returns Value::String(json) — parse it
        let list_json = list.as_str().unwrap_or("[]");
        let arr: Vec<serde_json::Value> = serde_json::from_str(list_json)?;
        let size = arr.len();

        // recall fraction for top-10 most recent nodes
        let mut hits = 0;
        for i in 91..=100 {
            let name = format!("mem-{}", i);
            if arr
                .iter()
                .any(|v| v.get("pointer_summary").and_then(|s| s.as_str()) == Some(name.as_str()))
            {
                hits += 1;
            }
        }
        let recall = hits as f64 / 10.0;

        // db size
        let db_bytes = storage.db_file_size().await.ok().flatten().unwrap_or(0);

        Ok((size, recall, tick_ms + resource_ms, db_bytes))
    }

    let configs = vec![5usize, 15usize];
    println!("OpenClaw perf report (small experiment)");
    println!("active_limit | active_index_size | recall(0..1) | op_latency_ms | db_bytes");

    for cfg in configs.into_iter() {
        let (size, recall, latency_ms, db_bytes) = measure_for_active_limit(cfg).await?;
        println!(
            "{:>12} | {:>17} | {:>11.2} | {:>13.2} | {:>8}",
            cfg, size, recall, latency_ms, db_bytes
        );
    }

    Ok(())
}
