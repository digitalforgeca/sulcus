//! Integration tests for the Sulcus Trigger Engine.
//!
//! These tests validate the full trigger lifecycle: CRUD via MCP tools,
//! automatic evaluation on memory events, filter matching, cooldowns,
//! max_fires, and all action types.

mod common;

use serde_json::{json, Value};
use sulcus_local::{LocalStorage, McpHandler};
use sulcus_local::embeddings::MockEmbeddingProvider;
use std::sync::Arc;

/// Build a handler backed by the shared test storage.
fn make_handler(storage: LocalStorage) -> McpHandler {
    let embedder = Arc::new(MockEmbeddingProvider::new());
    McpHandler::new(storage, embedder, 20)
}

/// Parse JSON-RPC response body and return the `result` field.
fn parse_result(resp: &str) -> Value {
    let v: Value = serde_json::from_str(resp).expect("parse JSON-RPC response");
    if let Some(err) = v.get("error") {
        panic!("MCP error: {}", err);
    }
    v["result"].clone()
}

/// Send an MCP tool call and return the parsed result.
async fn call_tool(handler: &McpHandler, tool: &str, params: Value) -> Value {
    let req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool,
            "arguments": params
        }
    });
    let resp = handler
        .handle_request(&req.to_string())
        .await
        .expect("handler error");
    let result = parse_result(&resp);
    // MCP tool results are wrapped in content[0].text as JSON
    let content = result["content"][0]["text"]
        .as_str()
        .unwrap_or_else(|| panic!("missing content[0].text in: {}", result));
    serde_json::from_str(content).unwrap_or_else(|_| json!({"_raw": content}))
}

/// Helper: store a memory via MCP and return the result
async fn store_memory(handler: &McpHandler, content: &str, memory_type: &str) -> Value {
    call_tool(
        handler,
        "record_memory",
        json!({
            "content": content,
            "memory_type": memory_type,
            "namespace": "default"
        }),
    )
    .await
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_create_and_list_trigger() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    // Create a notify trigger on on_store
    let created = call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "Test Notify",
            "event": "on_store",
            "action": "notify",
            "action_config": {"message": "Stored: {label}"},
            "description": "fires on every store"
        }),
    )
    .await;
    assert_eq!(created["ok"], true, "create should succeed: {}", created);
    let trigger_id = created["trigger_id"].as_str().expect("trigger_id").to_string();
    assert!(!trigger_id.is_empty());

    // List triggers — should contain the one we just created
    let listed = call_tool(&handler, "list_triggers", json!({})).await;
    let triggers = listed["triggers"].as_array().expect("triggers array");
    let found = triggers.iter().any(|t| t["id"] == trigger_id);
    assert!(found, "created trigger should appear in list");

    Ok(())
}

#[tokio::test]
async fn test_delete_trigger() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    let created = call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "To Delete",
            "event": "on_recall",
            "action": "notify",
            "action_config": {"message": "recalled"}
        }),
    )
    .await;
    let trigger_id = created["trigger_id"].as_str().unwrap().to_string();

    let deleted = call_tool(&handler, "delete_trigger", json!({"trigger_id": trigger_id})).await;
    assert_eq!(deleted["ok"], true);

    let listed = call_tool(&handler, "list_triggers", json!({})).await;
    let triggers = listed["triggers"].as_array().unwrap();
    assert!(!triggers.iter().any(|t| t["id"] == trigger_id));

    Ok(())
}

#[tokio::test]
async fn test_update_trigger_enable_disable() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    let created = call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "Disable Me",
            "event": "on_boost",
            "action": "notify",
            "action_config": {"message": "boosted"}
        }),
    )
    .await;
    let trigger_id = created["trigger_id"].as_str().unwrap().to_string();

    // Disable it
    let updated = call_tool(
        &handler,
        "update_trigger",
        json!({"trigger_id": trigger_id, "enabled": false}),
    )
    .await;
    assert_eq!(updated["ok"], true);

    // Verify disabled in list (must include disabled triggers)
    let listed = call_tool(&handler, "list_triggers", json!({"include_disabled": true})).await;
    let triggers = listed["triggers"].as_array().unwrap();
    let t = triggers.iter().find(|t| t["id"].as_str() == Some(trigger_id.as_str()));
    assert!(t.is_some(), "trigger should exist in list with include_disabled=true");
    assert_eq!(t.unwrap()["enabled"], false);

    Ok(())
}

// ─── EVALUATION — on_store fires notify ──────────────────────────────────────

#[tokio::test]
async fn test_on_store_fires_notify() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    // Create a notify trigger for on_store
    call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "Store Alert",
            "event": "on_store",
            "action": "notify",
            "action_config": {"message": "New memory: {label}"},
        }),
    )
    .await;

    // Store a memory — trigger should fire
    let stored = store_memory(&handler, "Daedalus prefers Rust for systems code", "preference").await;

    // Check that trigger fired (notifications or triggers_fired count)
    let notifs = stored["trigger_notifications"].as_array();
    let fired = stored.get("triggers_fired").and_then(|v| v.as_u64()).unwrap_or(0);
    assert!(
        notifs.map(|n| !n.is_empty()).unwrap_or(false) || fired > 0,
        "on_store trigger should have fired: {}",
        stored
    );

    Ok(())
}

// ─── EVALUATION — on_recall fires boost ──────────────────────────────────────

#[tokio::test]
async fn test_on_recall_fires_boost() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    // Store a procedural memory first
    store_memory(
        &handler,
        "Deploy sulcus: az acr build then az containerapp update",
        "procedural",
    )
    .await;

    // Create a boost trigger on recall for procedural type
    call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "Recall Boost",
            "event": "on_recall",
            "action": "boost",
            "action_config": {"strength": 0.2, "target": "self"},
            "filter_memory_type": "procedural",
        }),
    )
    .await;

    // Search — should trigger the boost
    call_tool(
        &handler,
        "search_memory",
        json!({"query": "deploy sulcus azure", "limit": 5}),
    )
    .await;

    // Verify via trigger history
    let history = call_tool(&handler, "trigger_history", json!({"limit": 10})).await;
    let entries = history["history"].as_array().expect("history array");
    let boost_fired = entries
        .iter()
        .any(|e| e["event"] == "on_recall" && e["action"] == "boost");
    assert!(
        boost_fired,
        "on_recall boost trigger should have fired; history: {}",
        history
    );

    Ok(())
}

// ─── FILTER — memory type filter ─────────────────────────────────────────────

#[tokio::test]
async fn test_filter_memory_type_excludes_non_matching() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    // Trigger only fires for "preference" type
    call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "Pref Only",
            "event": "on_store",
            "action": "notify",
            "action_config": {"message": "preference stored: {label}"},
            "filter_memory_type": "preference"
        }),
    )
    .await;

    // Store an episodic memory — should NOT fire
    let stored1 = store_memory(&handler, "Had a meeting about Sulcus triggers", "episodic").await;
    let fired1 = stored1.get("triggers_fired").and_then(|v| v.as_u64()).unwrap_or(0);
    assert_eq!(fired1, 0, "preference-only trigger should NOT fire for episodic memory: {}", stored1);

    // Store a preference — SHOULD fire
    let stored2 = store_memory(&handler, "Dooley prefers async Rust over Go", "preference").await;
    let fired2 = stored2.get("triggers_fired").and_then(|v| v.as_u64()).unwrap_or(0);
    let notifs2 = stored2["trigger_notifications"].as_array().map(|n| n.len()).unwrap_or(0);
    assert!(
        fired2 > 0 || notifs2 > 0,
        "preference trigger should fire for preference memory: {}",
        stored2
    );

    Ok(())
}

// ─── MAX FIRES ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_max_fires_respected() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    // Create a trigger that fires at most 1 time
    call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "One-Shot",
            "event": "on_store",
            "action": "notify",
            "action_config": {"message": "fired once: {label}"},
            "max_fires": 1
        }),
    )
    .await;

    // First store — should fire
    let s1 = store_memory(&handler, "first memory", "fact").await;
    let fired1 = s1.get("triggers_fired").and_then(|v| v.as_u64()).unwrap_or(0);
    let notifs1 = s1["trigger_notifications"].as_array().map(|n| n.len()).unwrap_or(0);
    assert!(fired1 > 0 || notifs1 > 0, "one-shot trigger should fire on first store: {}", s1);

    // Second store — should NOT fire (max_fires=1 exhausted)
    let s2 = store_memory(&handler, "second memory", "fact").await;
    let fired2 = s2.get("triggers_fired").and_then(|v| v.as_u64()).unwrap_or(0);
    let notifs2 = s2["trigger_notifications"].as_array().map(|n| n.len()).unwrap_or(0);
    assert_eq!(fired2, 0, "one-shot trigger should NOT fire on second store: {}", s2);
    assert_eq!(notifs2, 0, "no notifications on second store");

    Ok(())
}

// ─── TRIGGER HISTORY ─────────────────────────────────────────────────────────

#[tokio::test]
async fn test_trigger_history_records_fires() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "History Test",
            "event": "on_store",
            "action": "notify",
            "action_config": {"message": "tracked: {label}"}
        }),
    )
    .await;

    store_memory(&handler, "history test memory", "fact").await;

    let history = call_tool(&handler, "trigger_history", json!({"limit": 10})).await;
    let entries = history["history"].as_array().expect("history array");
    assert!(
        !entries.is_empty(),
        "trigger history should have at least one entry after firing: {}",
        history
    );
    let first = &entries[0];
    assert_eq!(first["event"], "on_store");
    assert_eq!(first["action"], "notify");

    Ok(())
}

// ─── ACTION — pin ────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_pin_action_pins_memory() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "Auto Pin Facts",
            "event": "on_store",
            "action": "pin",
            "action_config": {},
            "filter_memory_type": "fact"
        }),
    )
    .await;

    let stored = store_memory(&handler, "Sulcus triggers are the differentiator", "fact").await;

    let history = call_tool(&handler, "trigger_history", json!({"limit": 5})).await;
    let entries = history["history"].as_array().unwrap();
    let pinned = entries.iter().any(|e| e["action"] == "pin");
    let fired = stored.get("triggers_fired").and_then(|v| v.as_u64()).unwrap_or(0);
    assert!(
        pinned || fired > 0,
        "pin trigger should have fired for fact memory; history: {}",
        history
    );

    Ok(())
}

// ─── ACTION — webhook (graceful failure) ─────────────────────────────────────

#[tokio::test]
async fn test_webhook_action_fails_gracefully_on_bad_url() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "Webhook Test",
            "event": "on_store",
            "action": "webhook",
            "action_config": {"url": "http://127.0.0.1:19999/nonexistent"}
        }),
    )
    .await;

    // Store a memory — should NOT panic, just fail gracefully
    let stored = store_memory(&handler, "webhook test memory", "fact").await;

    // Memory should still be stored even when webhook fails
    assert!(
        stored.get("id").is_some() || stored.get("node_id").is_some() || stored.get("ok").is_some(),
        "memory should be stored even when webhook fails: {}",
        stored
    );

    Ok(())
}

// ─── DISABLED TRIGGER — should not fire ──────────────────────────────────────

#[tokio::test]
async fn test_disabled_trigger_does_not_fire() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let handler = make_handler(storage);

    let created = call_tool(
        &handler,
        "create_trigger",
        json!({
            "name": "Disabled",
            "event": "on_store",
            "action": "notify",
            "action_config": {"message": "should not appear"}
        }),
    )
    .await;
    let trigger_id = created["trigger_id"].as_str().unwrap().to_string();

    // Disable it
    call_tool(
        &handler,
        "update_trigger",
        json!({"trigger_id": trigger_id, "enabled": false}),
    )
    .await;

    // Store a memory — disabled trigger should not fire
    let stored = store_memory(&handler, "won't trigger disabled rule", "fact").await;
    let notifs = stored["trigger_notifications"].as_array().map(|n| n.len()).unwrap_or(0);
    let fired = stored.get("triggers_fired").and_then(|v| v.as_u64()).unwrap_or(0);
    assert_eq!(notifs, 0, "disabled trigger should not produce notifications");
    assert_eq!(fired, 0, "disabled trigger should not fire: {}", stored);

    Ok(())
}
