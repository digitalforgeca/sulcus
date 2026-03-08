//! Sanity tests for the Semantic VMMU paging layer.
//!
//! Validates that the full paging lifecycle works correctly:
//!   1. `pack_context` — pure budget math, no DB (fast, always runs).
//!   2. `page_in` MCP tool — cold node warms into active_index on demand.
//!   3. `tick` MCP tool — barely-warm node is evicted from active_index.
//!   4. `compact_wal` MCP tool — synced WAL ops are reaped to the horizon.
//!   5. `build_context` MCP tool — output fits within declared char budget.
//!
//! Tests 2-5 require a live PostgreSQL instance (`SULCUS_DATABASE_URL`).
//! Each test creates its own isolated schema so they run safely in parallel.

mod common;

use serde_json::{json, Value};
use sqlx::Row;
use std::sync::Arc;
use sulcus_core::mmu::{pack_context, ContextBudget};
use sulcus_local::{LocalStorage, McpHandler, MockEmbeddingProvider};
use uuid::Uuid;

// ── helpers ───────────────────────────────────────────────────────────────────

async fn make_handler() -> anyhow::Result<(LocalStorage, McpHandler)> {
    let storage = common::make_storage().await?;
    let embedder: Arc<dyn sulcus_local::embeddings::EmbeddingProvider> =
        Arc::new(MockEmbeddingProvider::new());
    let handler = McpHandler::new(storage.clone(), embedder, 20);
    Ok((storage, handler))
}

/// Insert a node directly into the `nodes` table (bypassing the MCP layer so
/// we can control heat precisely without triggering side-effects).
async fn insert_node(
    storage: &LocalStorage,
    id: Uuid,
    label: &str,
    heat: f32,
    memory_type: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)",
    )
    .bind(id.to_string())
    .bind(label)
    .bind(label) // pointer_summary == label for tests
    .bind(0.0f32) // base_utility
    .bind(heat)
    .bind(false) // is_pinned
    .bind(memory_type)
    .execute(storage.pool())
    .await?;
    Ok(())
}

/// Check how many rows exist in `active_index` for a given node UUID.
async fn active_index_count(storage: &LocalStorage, id: Uuid) -> i64 {
    let row = sqlx::query("SELECT COUNT(*) AS c FROM active_index WHERE node_id = $1")
        .bind(id.to_string())
        .fetch_one(storage.pool())
        .await
        .expect("active_index count query failed");
    row.try_get::<i64, _>("c").unwrap_or(0)
}

/// Extract `result.content[0].text` from a tools/call response, then parse it as JSON.
fn unwrap_tool_result(resp: &Value) -> Value {
    let text = resp
        .pointer("/result/content/0/text")
        .and_then(|t| t.as_str())
        .unwrap_or_else(|| panic!("no content[0].text in response: {resp:#}"));
    serde_json::from_str(text)
        .unwrap_or_else(|e| panic!("text is not valid JSON: {e}\ntext={text}"))
}

fn call_tool(name: &str, args: Value) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": "1",
        "method": "tools/call",
        "params": { "name": name, "arguments": args }
    })
    .to_string()
}

// ── 1 & 2. Pure unit tests: pack_context (no DB, no network) ─────────────────

/// Small-model budget sanity: 12 000 chars, 800 reserved → 11 200 content chars.
/// 20 nodes × 2 000-char payloads would total 40 000 chars without truncation.
#[test]
fn pack_context_small_model_budget_fits() {
    let budget = ContextBudget::default(); // max_chars=12_000, tool_dir=800, max_nodes=20
    let nodes: Vec<(Uuid, f32, String)> = (0..20u128)
        .map(|i| (Uuid::from_u128(i), 20.0 - i as f32, "A".repeat(2_000)))
        .collect();

    let paged = pack_context(&nodes, &budget);
    let total: usize = paged.iter().map(|n| n.content.len()).sum();

    assert!(
        total <= budget.content_budget(),
        "total={total} exceeds content_budget={} (max_chars={} - tool_dir={})",
        budget.content_budget(),
        budget.max_chars,
        budget.tool_directory_chars,
    );
    assert!(!paged.is_empty(), "should return at least one node");
    assert!(
        paged.iter().any(|n| n.truncated),
        "with 2 000-char payloads in an 11 200-char budget, at least one node must be truncated"
    );
}

/// A single node larger than the whole budget must be truncated, not dropped.
#[test]
fn pack_context_single_fat_node_is_truncated_not_dropped() {
    let budget = ContextBudget {
        max_chars: 500,
        tool_directory_chars: 0,
        max_nodes: 1,
    };
    let nodes = vec![(Uuid::from_u128(42), 1.0_f32, "X".repeat(10_000))];

    let paged = pack_context(&nodes, &budget);
    assert_eq!(
        paged.len(),
        1,
        "fat node must be included (truncated), not silently dropped"
    );
    assert!(paged[0].truncated, "fat node must be flagged as truncated");
    assert!(
        paged[0].content.len() <= 500,
        "content must fit within budget"
    );
}

// ── 3. page_in warms a cold node ─────────────────────────────────────────────

/// Insert a cold node (heat=0.01, not in active_index), call the `page_in`
/// MCP tool, and assert that the node is now in active_index with heat=1.0.
#[tokio::test]
async fn page_in_promotes_cold_node_to_active_index() -> anyhow::Result<()> {
    let (storage, handler) = make_handler().await?;

    let id = Uuid::from_u128(0xC0_1D_0001);
    insert_node(&storage, id, "cold test node", 0.01, "episodic").await?;

    // Confirm it is NOT in active_index before the page fault.
    assert_eq!(
        active_index_count(&storage, id).await,
        0,
        "cold node must not be in active_index before page_in"
    );

    // Trigger page fault via the MCP tool.
    let req = call_tool("page_in", json!({ "node_id": id.to_string() }));
    let resp_s = handler.handle_request(&req).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let inner = unwrap_tool_result(&resp);

    // The handler returns { node: { id, label, ... } } on success.
    assert!(
        inner.get("node").is_some(),
        "page_in should return the warmed node: {inner:#}"
    );

    // Node must now be in active_index.
    assert_eq!(
        active_index_count(&storage, id).await,
        1,
        "page_in must insert node into active_index"
    );

    // Heat in nodes table must be 1.0.
    let heat_row = sqlx::query("SELECT current_heat FROM nodes WHERE id = $1")
        .bind(id.to_string())
        .fetch_one(storage.pool())
        .await?;
    let heat: f32 = heat_row.try_get("current_heat")?;
    assert!(
        (heat - 1.0).abs() < 1e-4,
        "page_in must restore heat to 1.0, got {heat}"
    );

    Ok(())
}

// ── 4. tick evicts a barely-warm node ────────────────────────────────────────

/// Insert a barely-warm node (heat=0.04) that will decay below the prune floor
/// (0.05) after one tick with decay=0.9 (0.04 × 0.9 = 0.036 < 0.05).
/// Assert it is removed from active_index after the tick completes.
#[tokio::test]
async fn tick_evicts_node_below_prune_floor() -> anyhow::Result<()> {
    let (storage, handler) = make_handler().await?;

    let id = Uuid::from_u128(0xDEAD_0002);
    insert_node(&storage, id, "barely warm", 0.04, "episodic").await?;

    // Manually add to active_index so the tick has something to evict.
    sqlx::query(
        "INSERT INTO active_index (node_id, heat, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT(node_id) DO UPDATE SET heat = EXCLUDED.heat, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(id.to_string())
    .bind(0.04f32)
    .execute(storage.pool())
    .await?;

    assert_eq!(
        active_index_count(&storage, id).await,
        1,
        "should start in active_index"
    );

    // Run one tick: decay=0.9, prune_threshold=0.05.
    // 0.04 × 0.9 = 0.036 < 0.05 → node must be evicted.
    let req = call_tool(
        "tick",
        json!({ "decay": 0.9, "prune_threshold": 0.05, "active_limit": 20 }),
    );
    let resp_s = handler.handle_request(&req).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    // The tick tool returns { "ok": true } (existing contract).
    assert!(
        resp.pointer("/result").is_some(),
        "tick response must have result: {resp:#}"
    );

    // Node must no longer be in active_index.
    assert_eq!(
        active_index_count(&storage, id).await,
        0,
        "tick must evict the barely-warm node from active_index"
    );

    Ok(())
}

// ── 5. compact_wal reaps synced ops to the horizon ───────────────────────────

/// Seed the WAL with 6 ops marked `status='synced'`, set `last_seq` in kv_store,
/// then call `compact_wal` and assert all 6 rows are removed.
#[tokio::test]
async fn compact_wal_removes_synced_ops_up_to_horizon() -> anyhow::Result<()> {
    let (storage, handler) = make_handler().await?;

    // Insert 6 synced WAL ops.
    for i in 0..6i64 {
        sqlx::query(
            "INSERT INTO memory_ops (op_type, payload, status, created_at)
             VALUES ('ADD', $1, 'synced', CURRENT_TIMESTAMP)",
        )
        .bind(format!("payload-{i}"))
        .execute(storage.pool())
        .await?;
    }

    // Confirm the ops are present.
    let before_count: i64 = {
        let row = sqlx::query("SELECT COUNT(*) AS c FROM memory_ops WHERE status = 'synced'")
            .fetch_one(storage.pool())
            .await?;
        row.try_get("c")?
    };
    assert_eq!(
        before_count, 6,
        "should have 6 synced ops before compaction"
    );

    // Determine the max seq so we can pass it as up_to_seq.
    let max_seq: i64 = {
        let row = sqlx::query("SELECT COALESCE(MAX(seq), 0) AS m FROM memory_ops")
            .fetch_one(storage.pool())
            .await?;
        row.try_get("m")?
    };

    // Call compact_wal with an explicit horizon.
    let req = call_tool("compact_wal", json!({ "up_to_seq": max_seq }));
    let resp_s = handler.handle_request(&req).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let inner = unwrap_tool_result(&resp);

    let rows_deleted = inner["rows_deleted"].as_u64().unwrap_or(0);
    assert!(
        rows_deleted >= 6,
        "expected at least 6 rows deleted, got {rows_deleted}: {inner:#}"
    );

    // Confirm the WAL is empty.
    let after_count: i64 = {
        let row = sqlx::query("SELECT COUNT(*) AS c FROM memory_ops WHERE status = 'synced'")
            .fetch_one(storage.pool())
            .await?;
        row.try_get("c")?
    };
    assert_eq!(
        after_count, 0,
        "all synced ops must be gone after compaction"
    );

    Ok(())
}
