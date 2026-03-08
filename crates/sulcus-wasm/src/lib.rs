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
    /// @param query_fn  `async (sql: string, params: any[]) => any[]`
    /// @param embed_fn  `async (text: string) => Float32Array`
    #[wasm_bindgen]
    pub fn create(query_fn: Function, embed_fn: Function) -> SulcusMem {
        SulcusMem {
            db: Rc::new(DbBridge::new(query_fn)),
            embed: Rc::new(EmbedBridge::new(embed_fn)),
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
}

// ── helpers ─────────────────────────────────────────────────────────────────

/// Convert a `serde_json::Value` to a `JsValue` via JSON text round-trip.
/// This avoids a dep on `serde-wasm-bindgen` while keeping Things Simple.
fn serde_wasm_bindgen_value(v: serde_json::Value) -> JsValue {
    let json_str = v.to_string();
    js_sys::JSON::parse(&json_str).unwrap_or(JsValue::NULL)
}
