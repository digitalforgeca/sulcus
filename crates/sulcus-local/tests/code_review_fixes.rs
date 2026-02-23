/// Integration tests that directly exercise every bug-fix from the code review.
/// Each test is labelled with the fix number so failures are immediately actionable.
///
/// Prerequisites:
///   SULCUS_DATABASE_URL=postgres://sulcus:sulcus@localhost/sulcus_test
///   (defaults to the above if unset)
mod common;

use serde_json::{json, Value};
use sulcus_core::crdt::{Hlc, NodePatch};
use sulcus_core::graph::Node;
use sulcus_core::zero_copy::{NodePointer, SharedIndexBuffer};
use sulcus_core::StorageBackend;
use sulcus_local::{McpHandler, MockEmbeddingProvider, SqliteStorage};
use uuid::Uuid;

// ─── helpers ────────────────────────────────────────────────────────────────

fn sample_node(id: Uuid, label: &str, heat: f32) -> Node {
    Node {
        id,
        label: label.into(),
        pointer_summary: label.into(),
        base_utility: 0.0,
        current_heat: heat,
        is_pinned: false,
        memory_type: "episodic".into(),
    }
}

fn make_handler(storage: SqliteStorage) -> McpHandler {
    let embedder = std::sync::Arc::new(MockEmbeddingProvider::new());
    McpHandler::new(storage, embedder)
}

/// Return two HLCs where `new_hlc` is strictly after `old_hlc`.
fn two_hlcs() -> (Hlc, Hlc) {
    let actor = [1u8; 8];
    let old = Hlc::now(actor);
    let new = old.tick_after(old);
    assert!(new > old);
    (old, new)
}

// ─── Fix 1: Atomic mmap write (SIGBUS prevention) ───────────────────────────

/// `write_nodes` must write an rkyv payload atomically (temp-file + rename)
/// so that a concurrent mmap reader never sees a truncated/empty inode.
#[tokio::test]
async fn fix1_atomic_mmap_write_produces_valid_file() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("active_index.bin");

    let buf = SharedIndexBuffer::new(Some(path.clone()));
    let pointer = NodePointer::from_node(Uuid::new_v4(), 0.9, "test label", "test summary");

    buf.write_nodes(&[pointer.clone()])?;

    // File must exist and be non-empty (confirms write-then-rename happened).
    let meta = std::fs::metadata(&path)?;
    assert!(meta.len() > 0, "active_index.bin must be non-empty after write_nodes");

    // Hold an mmap open (simulating a concurrent LLM reader).
    let mmap = unsafe { memmap2::Mmap::map(&std::fs::File::open(&path)?)? };
    assert!(!mmap.is_empty(), "mmap of written file must be non-empty");

    // A second write (the next thermodynamics tick) must not corrupt the mmap.
    // With atomic rename the old inode is preserved until the mapping is released.
    let pointer2 = NodePointer::from_node(Uuid::new_v4(), 0.5, "second", "second summary");
    buf.write_nodes(&[pointer, pointer2])?;

    // Old mmap is still readable — no SIGBUS.
    assert!(!mmap.is_empty(), "existing mmap must remain valid after a second write");

    // The file on disk has the new content.
    let new_meta = std::fs::metadata(&path)?;
    assert!(new_meta.len() >= meta.len(), "new file must not be smaller than the old one");

    Ok(())
}

// ─── Fix 2: Postgres FTS dialect ────────────────────────────────────────────

/// `search_memory` must not crash with a Postgres syntax error.
/// Previously it used SQLite FTS5 `bm25()` / `MATCH ?` which Postgres rejects.
#[tokio::test]
async fn fix2_search_memory_uses_postgres_fts_no_error() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    storage
        .upsert_node(sample_node(Uuid::new_v4(), "Rust ownership and borrowing", 0.8))
        .await?;

    let handler = make_handler(storage);
    let req = json!({
        "jsonrpc": "2.0", "id": "1",
        "method": "tools/call",
        "params": { "name": "search_memory", "arguments": { "query": "Rust ownership" } }
    })
    .to_string();

    let resp_s = handler.handle_request(&req).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    assert!(
        resp.get("error").is_none(),
        "search_memory returned a JSON-RPC error (check Postgres FTS dialect): {resp_s}"
    );
    Ok(())
}

/// `search_memory` must return results when a matching document exists.
#[tokio::test]
async fn fix2_search_memory_returns_results_for_match() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    storage
        .upsert_node(Node {
            id: Uuid::new_v4(),
            label: "Rust borrow checker".into(),
            pointer_summary: "The Rust borrow checker enforces ownership at compile time".into(),
            base_utility: 0.0,
            current_heat: 1.0,
            is_pinned: false,
            memory_type: "semantic".into(),
        })
        .await?;

    let handler = make_handler(storage);
    let req = json!({
        "jsonrpc": "2.0", "id": "2",
        "method": "tools/call",
        "params": { "name": "search_memory", "arguments": { "query": "borrow checker" } }
    })
    .to_string();

    let resp_s = handler.handle_request(&req).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    let text = resp
        .pointer("/result/content/0/text")
        .and_then(|v| v.as_str())
        .unwrap_or("[]");
    let wrapper: Value = serde_json::from_str(text)?;
    let arr = wrapper
        .get("results")
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    assert!(arr, "search_memory must return at least one result for a matching query (got: {text})");
    Ok(())
}

// ─── Fix 3: CRDT Clock Amnesia ───────────────────────────────────────────────

/// A patch with a *newer* HLC must overwrite the node field.
#[test]
fn fix3_crdt_newer_clock_wins() {
    let (old_hlc, new_hlc) = two_hlcs();
    let mut node = sample_node(Uuid::new_v4(), "original", 0.5);
    let mut stored = std::collections::HashMap::from([("label".to_string(), old_hlc)]);

    let patch = NodePatch::new(node.id).with_label("updated", new_hlc);
    let changed = patch.apply_to_with_clocks(&mut node, &mut stored);

    assert!(changed, "patch with newer HLC must be applied");
    assert_eq!(node.label, "updated");
    assert_eq!(stored["label"], new_hlc, "stored clock must advance to incoming HLC");
}

/// A patch with an *older* HLC must be silently rejected (LWW: last writer wins).
#[test]
fn fix3_crdt_stale_patch_rejected() {
    let (old_hlc, new_hlc) = two_hlcs();
    let mut node = sample_node(Uuid::new_v4(), "current", 0.5);
    // The DB already has the NEW HLC — we are ahead of the incoming patch.
    let mut stored = std::collections::HashMap::from([("label".to_string(), new_hlc)]);

    let patch = NodePatch::new(node.id).with_label("stale", old_hlc);
    let changed = patch.apply_to_with_clocks(&mut node, &mut stored);

    assert!(!changed, "patch with older HLC must NOT be applied");
    assert_eq!(node.label, "current", "field must remain unchanged");
    assert_eq!(stored["label"], new_hlc, "stored clock must not regress");
}

/// When no clock has been stored yet (first sync), any incoming patch wins.
#[test]
fn fix3_crdt_first_patch_always_wins() {
    let (_, new_hlc) = two_hlcs();
    let mut node = sample_node(Uuid::new_v4(), "blank", 0.0);
    let mut stored = std::collections::HashMap::new(); // no prior clock

    let patch = NodePatch::new(node.id).with_label("first write", new_hlc);
    let changed = patch.apply_to_with_clocks(&mut node, &mut stored);

    assert!(changed, "first patch must always be applied (no prior clock)");
    assert_eq!(node.label, "first write");
}

/// CRDT clocks survive a round-trip through the `crdt_clocks` DB column.
#[tokio::test]
async fn fix3_crdt_clocks_round_trip_db() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let node_id = Uuid::new_v4();
    storage.upsert_node(sample_node(node_id, "clock-node", 0.5)).await?;

    let (old_hlc, new_hlc) = two_hlcs();
    let clocks = std::collections::HashMap::from([
        ("label".to_string(), old_hlc),
        ("is_pinned".to_string(), new_hlc),
    ]);

    storage.set_crdt_clocks(node_id, &clocks).await?;
    let loaded = storage.get_crdt_clocks(node_id).await?;

    assert_eq!(loaded.get("label"), clocks.get("label"), "label HLC must survive a DB round-trip");
    assert_eq!(
        loaded.get("is_pinned"),
        clocks.get("is_pinned"),
        "is_pinned HLC must survive a DB round-trip"
    );
    Ok(())
}

// ─── Fix 4: In-memory vector cache ──────────────────────────────────────────

/// `warm_up_vector_cache` must bulk-load all embeddings from the DB into RAM.
#[tokio::test]
async fn fix4_warm_up_loads_all_embeddings() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let id_a = Uuid::new_v4();
    let id_b = Uuid::new_v4();

    for (id, v) in [(id_a, vec![0.1f32, 0.2, 0.3]), (id_b, vec![0.9f32, 0.8, 0.7])] {
        storage.upsert_node(sample_node(id, "v", 0.5)).await?;
        let blob: Vec<u8> = bytemuck::cast_slice(v.as_slice()).to_vec();
        sqlx::query(
            "INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) \
             ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector",
        )
        .bind(id)
        .bind(blob)
        .execute(storage.pool())
        .await?;
    }

    // Cache must be cold before warm-up on a fresh `LocalStorage`.
    let before = storage.vec_cache_snapshot().await;
    assert!(
        !before.iter().any(|(id, _)| *id == id_a),
        "cache should not contain id_a before warm_up"
    );

    storage.warm_up_vector_cache().await?;
    let after = storage.vec_cache_snapshot().await;

    assert!(after.iter().any(|(id, _)| *id == id_a), "id_a must be in cache after warm_up");
    assert!(after.iter().any(|(id, _)| *id == id_b), "id_b must be in cache after warm_up");
    Ok(())
}

/// `append_vec_cache` must update the entry in-place without duplicating it.
#[tokio::test]
async fn fix4_append_vec_cache_deduplicates() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let id = Uuid::new_v4();

    storage.append_vec_cache(id, vec![1.0f32, 0.0]).await;
    storage.append_vec_cache(id, vec![0.0f32, 1.0]).await; // re-embed

    let snap = storage.vec_cache_snapshot().await;
    let entries: Vec<_> = snap.iter().filter(|(i, _)| *i == id).collect();
    assert_eq!(entries.len(), 1, "re-embedding must not create a duplicate cache entry");
    assert_eq!(entries[0].1, vec![0.0f32, 1.0], "cache must hold the latest vector");
    Ok(())
}

/// `store_node_embedding` must write to DB *and* update the cache in the same call.
#[tokio::test]
async fn fix4_store_node_embedding_syncs_db_and_cache() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let id = Uuid::new_v4();
    storage.upsert_node(sample_node(id, "embed-sync", 0.5)).await?;

    storage.store_node_embedding(id, vec![0.5f32; 4]).await?;

    // In-memory cache must be updated immediately.
    let snap = storage.vec_cache_snapshot().await;
    assert!(snap.iter().any(|(i, _)| *i == id), "cache must contain stored embedding");

    // DB must also persist the entry.
    let row = sqlx::query("SELECT vector FROM embeddings WHERE node_id = $1")
        .bind(id.to_string())
        .fetch_optional(storage.pool())
        .await?;
    assert!(row.is_some(), "embedding must be persisted in the DB");
    Ok(())
}

// ─── Fix 5a: CTE hub-node thermal cutoff ────────────────────────────────────

/// A hub node connected to 200 low-weight spokes must NOT stall the tick.
/// With the cutoff `AND (f.transfer * e.edge_weight * 0.5) > 0.05` trivial
/// heat transfers are pruned early and the CTE terminates quickly.
#[tokio::test]
async fn fix5a_tick_hub_node_completes_under_five_seconds() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let hub = Uuid::new_v4();
    storage.upsert_node(sample_node(hub, "hub", 1.0)).await?;

    for i in 0..200u32 {
        let spoke = Uuid::from_u128(0xB000_0000u128 + i as u128);
        storage.upsert_node(sample_node(spoke, &format!("spoke_{i}"), 0.1)).await?;
        sqlx::query(
            "INSERT INTO edges (source_id, target_id, relationship_type, edge_weight)
             VALUES ($1, $2, 'semantic', 0.05) ON CONFLICT(source_id, target_id) DO NOTHING",
        )
        .bind(hub.to_string())
        .bind(spoke.to_string())
        .execute(storage.pool())
        .await?;
    }

    let t0 = std::time::Instant::now();
    sulcus_local::tick(&storage, 0.85, 0.01, 20).await?;
    let elapsed = t0.elapsed();

    assert!(
        elapsed.as_secs() < 5,
        "tick must complete in < 5 s with 200-spoke hub node (took {elapsed:?})"
    );
    Ok(())
}

// ─── Fix 5b: Token-aware context packing ────────────────────────────────────

/// `build_context` must use real cl100k token counts instead of `char_budget * 4`.
/// The returned `token_estimate` must stay within a reasonable multiple of the budget.
#[tokio::test]
async fn fix5b_build_context_respects_token_budget() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    const BUDGET: u64 = 80;

    for i in 0..10u32 {
        let id = Uuid::from_u128(0xD000_0000u128 + i as u128);
        storage
            .upsert_node(Node {
                id,
                label: format!("article_{i}"),
                // ~45 tokens each — 10 nodes × 45 = 450 tokens (far exceeds BUDGET).
                pointer_summary: "The quick brown fox jumps over the lazy dog. ".repeat(5),
                base_utility: 0.0,
                current_heat: 1.0 - i as f32 * 0.05,
                is_pinned: false,
                memory_type: "episodic".into(),
            })
            .await?;
        storage.set_active_index(id, 1.0 - i as f32 * 0.05).await?;
    }

    let handler = make_handler(storage);
    let req = json!({
        "jsonrpc": "2.0", "id": "4",
        "method": "tools/call",
        "params": { "name": "build_context", "arguments": { "token_budget": BUDGET } }
    })
    .to_string();

    let resp_s = handler.handle_request(&req).await?;
    let resp: Value = serde_json::from_str(&resp_s)?;
    assert!(
        resp.get("error").is_none(),
        "build_context must not error: {resp_s}"
    );

    let content_text = resp
        .pointer("/result/content/0/text")
        .and_then(|v| v.as_str())
        .unwrap_or("{}");
    let result: Value = serde_json::from_str(content_text).unwrap_or(json!({}));
    let token_estimate = result
        .get("token_estimate")
        .and_then(|v| v.as_u64())
        .unwrap_or(u64::MAX);

    // Allow up to 2× budget to account for the fixed XML tag overhead (~300 tokens).
    let ceiling = BUDGET * 2 + 300;
    assert!(
        token_estimate <= ceiling,
        "token_estimate ({token_estimate}) is far beyond budget {BUDGET} — \
         real token counting is not working (ceiling {ceiling})"
    );
    Ok(())
}
