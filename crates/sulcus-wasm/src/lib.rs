use js_sys::{Function, Promise};
/// sulcus-wasm — WASM entry point
///
/// Exposes the SULCUS MCP memory service to browser-based LLMs via
/// `wasm-bindgen`.  The host (JS) supplies:
///
///   - A PGlite query bridge: `async (sql: string, params: any[]) => any[]`
///   - An embedding bridge:   `async (text: string) => Float32Array`
///
/// Everything else (thermodynamics, CRDT, graph spreading) runs in pure Rust
/// inside the WASM module.
///
/// # Quick start
///
/// ```typescript
/// import init, { SulcusMem } from "@sulcus/mem";
/// import { pipeline } from "@xenova/transformers";
/// import { PGlite } from "@electric-sql/pglite";
///
/// await init(); // load WASM binary
///
/// const pglite   = await PGlite.create("idb://sulcus");
/// const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
///
/// const mem = SulcusMem.create(
///   async (sql, params) => (await pglite.query(sql, params)).rows,
///   async (text) => {
///     const out = await embedder(text, { pooling: "mean", normalize: true });
///     return out.data; // Float32Array (384-d)
///   },
/// );
///
/// // MCP tools
/// const result = await mem.add_memory("Rust ownership is managed at compile time", null);
/// const hits   = await mem.search_memory("borrow checker", 5);
/// const hot    = await mem.list_hot_nodes(10);
/// await mem.tick(0.85, 0.5, 20);
/// ```
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

mod bridge;
mod mcp;

use bridge::{DbBridge, EmbedBridge};
use std::rc::Rc;

// Expose a nice panic hook to JS console.
#[wasm_bindgen(start)]
pub fn on_init() {
    console_error_panic_hook::set_once();
}

/// The main SULCUS memory handle.  Create once; keep alive for the session.
#[wasm_bindgen]
pub struct SulcusMem {
    db: Rc<DbBridge>,
    embed: Rc<EmbedBridge>,
}

#[wasm_bindgen]
impl SulcusMem {
    /// Create a new `SulcusMem` instance.
    ///
    /// @param query_fn       `async (sql: string, params: any[]) => any[]`
    /// @param embed_fn       `async (text: string) => Float32Array`
    /// @param embed_image_fn  Optional: `async (bitmap: Uint8Array) => Float32Array`
    #[wasm_bindgen]
    pub fn create(
        query_fn: Function,
        embed_fn: Function,
        embed_image_fn: Option<Function>,
    ) -> SulcusMem {
        SulcusMem {
            db: Rc::new(DbBridge::new(query_fn)),
            embed: Rc::new(EmbedBridge::new(embed_fn, embed_image_fn)),
        }
    }

    // ── add_memory ─────────────────────────────────────────────────────────

    /// Record a new memory.
    ///
    /// @param text         The raw text to remember.
    /// @param memory_type  Optional: "episodic" | "semantic" | "preference" | "procedural".
    /// @returns            `{ id: string, status: "added" }`
    #[wasm_bindgen]
    pub fn add_memory(&self, text: String, memory_type: Option<String>) -> Promise {
        let db = Rc::clone(&self.db);
        let embed = Rc::clone(&self.embed);
        future_to_promise(async move {
            let result = mcp::add_memory(&db, &embed, text, memory_type, None, None, None)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }

    /// Record a new image memory.
    ///
    /// @param label        Human-readable label for the image (optional).
    /// @param bitmap       The raw image bytes (Uint8Array).
    /// @param mime         MIME type (e.g., "image/png").
    /// @param namespace    Optional: partition memory by namespace.
    /// @returns            `{ id: string, status: "added" }`
    #[wasm_bindgen]
    pub fn add_image_memory(
        &self,
        label: Option<String>,
        bitmap: Vec<u8>,
        mime: String,
        namespace: Option<String>,
    ) -> Promise {
        let db = Rc::clone(&self.db);
        let embed = Rc::clone(&self.embed);
        future_to_promise(async move {
            let result = mcp::add_image_memory(&db, &embed, label, bitmap, mime, namespace)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }

    // ── search_memory ───────────────────────────────────────────────────────

    /// Hybrid FTS + cosine similarity search using native pgvector operators.
    ///
    /// @param query   Natural language query.
    /// @param limit   Max results (default 10).
    /// @returns       `{ results: Array<{ id, label, pointer_summary, score }> }`
    #[wasm_bindgen]
    pub fn search_memory(&self, query: String, limit: Option<usize>) -> Promise {
        let db = Rc::clone(&self.db);
        let embed = Rc::clone(&self.embed);
        future_to_promise(async move {
            let result = mcp::search_memory(&db, &embed, query, limit, None, None, None)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }

    /// Search for similar memories using an image as query (CLIP).
    ///
    /// @param bitmap  The raw image bytes (Uint8Array).
    /// @param limit   Max results (default 10).
    /// @returns       `{ results: Array<{ id, label, pointer_summary, score }> }`
    #[wasm_bindgen]
    pub fn search_by_image(&self, bitmap: Vec<u8>, limit: Option<usize>) -> Promise {
        let db = Rc::clone(&self.db);
        let embed = Rc::clone(&self.embed);
        future_to_promise(async move {
            let result = mcp::search_by_image(&db, &embed, bitmap, limit, None, None)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }

    // ── list_hot_nodes ──────────────────────────────────────────────────────

    /// List nodes ordered by current_heat DESC.
    ///
    /// @param limit  Max nodes to return (default 20).
    /// @returns      `{ nodes: Array<{ id, label, pointer_summary, current_heat, memory_type }> }`
    #[wasm_bindgen]
    pub fn list_hot_nodes(&self, limit: Option<usize>) -> Promise {
        let db = Rc::clone(&self.db);
        future_to_promise(async move {
            let result = mcp::list_hot_nodes(&db, limit)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }

    // ── tick ────────────────────────────────────────────────────────────────

    /// Run one thermodynamics cycle: decay all nodes, spread heat along edges,
    /// rebuild `active_index`.
    ///
    /// @param decay   Heat decay factor per tick (default 0.85).
    /// @param spread  Spreading activation weight (default 0.5).
    /// @param limit   Max nodes kept in `active_index` (default 20).
    /// @returns       `{ status: "tick_complete" }`
    #[wasm_bindgen]
    pub fn tick(&self, decay: f64, spread: f64, limit: i32) -> Promise {
        let db = Rc::clone(&self.db);
        future_to_promise(async move {
            let result = mcp::tick(&db, decay, spread, limit as i64)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }

    /// Run one thermodynamics cycle using the configurable ThermoConfig engine.
    ///
    /// @param config_json  JSON string of ThermoConfig (or `null` for defaults).
    /// @returns            `{ status: "tick_complete", engine: "thermo_v2", ... }`
    #[wasm_bindgen]
    pub fn tick_v2(&self, config_json: Option<String>) -> Promise {
        let db = Rc::clone(&self.db);
        future_to_promise(async move {
            let config: sulcus_core::thermo::ThermoConfig = match config_json {
                Some(s) => serde_json::from_str(&s).unwrap_or_default(),
                None => sulcus_core::thermo::ThermoConfig::default(),
            };
            let result = mcp::tick_with_config(&db, &config)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }

    // ── consolidate ─────────────────────────────────────────────────────────

    /// Run semantic consolidation on hot memories.
    ///
    /// Fetches nodes with heat > `min_heat`, clusters them using sulcus-core's
    /// pure greedy algorithm, and returns cluster information.  Does NOT write
    /// synthesis nodes — the caller decides whether to persist results.
    ///
    /// @param min_heat  Heat floor for candidate nodes (e.g. 0.4).
    /// @returns         `{ clusters: Array<{ synthesis_id, namespace, summary, member_count, member_ids }> }`
    #[wasm_bindgen]
    pub fn consolidate(&self, min_heat: f64) -> Promise {
        let db = Rc::clone(&self.db);
        let embed = Rc::clone(&self.embed);
        future_to_promise(async move {
            let result = mcp::consolidate(&db, &embed, min_heat as f32)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }

    // ── export_markdown ──────────────────────────────────────────────────────

    /// Export all memories as SULCUS Markdown.
    ///
    /// Queries all nodes and active edges from the DB, then calls the pure
    /// `sulcus_core::folds::render_nodes_to_markdown` renderer.
    ///
    /// @returns  `{ markdown: string, node_count: number, edge_count: number }`
    #[wasm_bindgen]
    pub fn export_markdown(&self) -> Promise {
        let db = Rc::clone(&self.db);
        future_to_promise(async move {
            let result = mcp::export_markdown(&db)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }

    // ── import_markdown ──────────────────────────────────────────────────────

    /// Import memories from a SULCUS Markdown export.
    ///
    /// Parses the markdown using `sulcus_core::folds::parse_markdown_export`,
    /// then inserts each node into the DB (skipping conflicts) and re-embeds.
    ///
    /// @param text  A SULCUS Markdown string (as produced by `export_markdown`).
    /// @returns     `{ status: "import_complete", inserted: number, skipped: number, total_parsed: number }`
    #[wasm_bindgen]
    pub fn import_markdown(&self, text: String) -> Promise {
        let db = Rc::clone(&self.db);
        let embed = Rc::clone(&self.embed);
        future_to_promise(async move {
            let result = mcp::import_markdown(&db, &embed, text)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }

    // ── evaluate_triggers ────────────────────────────────────────────────────

    /// Evaluate triggers for an event.
    ///
    /// Fetches trigger rows from the DB, runs pure `sulcus_core::triggers::filter_trigger_rows`,
    /// fires Notify actions (pure string interpolation via `fire_notify`), and executes
    /// DB-backed actions (boost/pin/tag/deprecate) directly via DbBridge.
    ///
    /// @param event         Event name: "on_recall" | "on_decay" | "on_store" | "on_boost" | "on_relate" | "on_threshold"
    /// @param context_json  JSON object with optional fields: node_id, node_label, node_namespace, node_memory_type, node_heat, old_heat
    /// @returns             `{ event, matched, results: [...], notifications: [...] }`
    #[wasm_bindgen]
    pub fn evaluate_triggers(&self, event: String, context_json: String) -> Promise {
        let db = Rc::clone(&self.db);
        future_to_promise(async move {
            let result = mcp::evaluate_triggers(&db, event, context_json)
                .await
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(serde_wasm_bindgen_value(result))
        })
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/// Convert a `serde_json::Value` to a `JsValue` via JSON text round-trip.
/// This avoids a dep on `serde-wasm-bindgen` while keeping Things Simple.
fn serde_wasm_bindgen_value(v: serde_json::Value) -> JsValue {
    let json_str = v.to_string();
    js_sys::JSON::parse(&json_str).unwrap_or(JsValue::NULL)
}
