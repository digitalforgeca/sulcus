/// sulcus-wasm — Database bridge
///
/// Wraps a JS-supplied `PGlite` query function so the core WASM logic can
/// execute raw SQL without depending on `sqlx` (which requires the Postgres
/// wire protocol and is not WASM-compatible in the browser).
///
/// # Protocol (JS side)
///
/// The host page/worker must supply an `async (sql: string, params: any[]) => any[]`
/// function.  Each returned element is a plain JS object whose keys match the
/// SQL column names.
///
/// ```typescript
/// const bridge = async (sql: string, params: unknown[]) => {
///     const result = await pglite.query(sql, params);
///     return result.rows;
/// };
/// ```
use js_sys::{Array, Function, Promise};
use serde_json::Value;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

/// Thin wrapper around the JS PGlite query callback.
pub struct DbBridge {
    /// `async (sql: string, params: any[]) => any[]`
    query_fn: Function,
}

impl DbBridge {
    pub fn new(query_fn: Function) -> Self {
        Self { query_fn }
    }

    /// Execute `sql` with positional `params`, returning rows as `Vec<Value>`.
    pub async fn query(&self, sql: &str, params: &[Value]) -> anyhow::Result<Vec<Value>> {
        // Build the JS params array.
        let js_params = Array::new();
        for p in params {
            let js_val = match p {
                Value::String(s) => JsValue::from_str(s),
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        JsValue::from_f64(i as f64)
                    } else {
                        JsValue::from_f64(n.as_f64().unwrap_or(0.0))
                    }
                }
                Value::Bool(b) => JsValue::from_bool(*b),
                Value::Null => JsValue::NULL,
                other => JsValue::from_str(&other.to_string()),
            };
            js_params.push(&js_val);
        }

        // Call the JS function: queryFn(sql, params) → Promise<any[]>
        let promise: Promise = self
            .query_fn
            .call2(&JsValue::NULL, &JsValue::from_str(sql), &js_params)
            .map_err(|e| anyhow::anyhow!("DbBridge call error: {:?}", e))?
            .dyn_into()
            .map_err(|_| anyhow::anyhow!("DbBridge: JS function did not return a Promise"))?;

        let result = JsFuture::from(promise)
            .await
            .map_err(|e| anyhow::anyhow!("DbBridge query rejected: {:?}", e))?;

        // The result is a JS Array of plain objects; serialise via JSON.
        let json_str = js_sys::JSON::stringify(&result)
            .map(|s| s.as_string().unwrap_or_default())
            .unwrap_or_default();

        let rows: Vec<Value> = serde_json::from_str(&json_str).unwrap_or_default();
        Ok(rows)
    }

    /// Execute a statement that returns no rows (INSERT / UPDATE / DELETE).
    pub async fn execute(&self, sql: &str, params: &[Value]) -> anyhow::Result<()> {
        self.query(sql, params).await?;
        Ok(())
    }
}

// ── EmbedBridge ──────────────────────────────────────────────────────────────

/// Wraps a JS-supplied `async (text: string) => Float32Array` embedding function.
pub struct EmbedBridge {
    /// `async (text: string) => Float32Array`
    embed_fn: Function,
}

impl EmbedBridge {
    pub fn new(embed_fn: Function) -> Self {
        Self { embed_fn }
    }

    /// Compute the embedding vector for `text` by calling the JS function.
    pub async fn embed(&self, text: &str) -> anyhow::Result<Vec<f32>> {
        let promise: Promise = self
            .embed_fn
            .call1(&JsValue::NULL, &JsValue::from_str(text))
            .map_err(|e| anyhow::anyhow!("EmbedBridge call error: {:?}", e))?
            .dyn_into()
            .map_err(|_| anyhow::anyhow!("EmbedBridge: JS function did not return a Promise"))?;

        let result = JsFuture::from(promise)
            .await
            .map_err(|e| anyhow::anyhow!("EmbedBridge embed rejected: {:?}", e))?;

        // Expect a Float32Array from transformers.js.
        let typed: js_sys::Float32Array = result
            .dyn_into()
            .map_err(|_| anyhow::anyhow!("EmbedBridge: result is not a Float32Array"))?;

        Ok(typed.to_vec())
    }
}
