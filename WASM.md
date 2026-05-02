# SULCUS WASM Distribution

## The Core Concept

The primary zero-friction distribution of SULCUS is a **single WASM module** that gives any
browser-based LLM (Claude.ai, ChatGPT canvas, Gemini, local models running via WebLLM, etc.) a
full MCP memory service — **no server, no process to install, no API key revocation risk.**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Browser Tab / VS Code Web Extension / Claude.ai                           │
│                                                                             │
│  ┌──────────────────────┐        ┌──────────────────────────────────────┐  │
│  │ LLM / Agent (JS)     │ MCP    │ sulcus-wasm (Web Worker)             │  │
│  │                      │◄──────►│                                      │  │
│  │  add_memory(text)    │        │  ┌────────────────────────────────┐  │  │
│  │  search_memory(q)    │        │  │ sulcus-core (Rust→WASM)        │  │  │
│  │  build_context(p)    │        │  │ • Thermodynamics engine         │  │  │
│  │  tick()              │        │  │ • Graph / CRDT                  │  │  │
│  │  list_hot_nodes()    │        │  │ • Spreading Activation          │  │  │
│  └──────────────────────┘        │  └────────────────────────────────┘  │  │
│                                  │                                        │  │
│                                  │  ┌──────────────┐  ┌───────────────┐  │  │
│                                  │  │ PGlite       │  │ transformers.js│  │  │
│                                  │  │ (WASM Postgres│  │ (MiniLM-L6)   │  │  │
│                                  │  │  + IndexedDB) │  │  embeddings   │  │  │
│                                  │  └──────────────┘  └───────────────┘  │  │
│                                  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Why WASM (not native binary)?

| Distribution    | Install friction  | Works in Claude.ai | Works offline | Persistent memory              |
| --------------- | ----------------- | ------------------ | ------------- | ------------------------------ |
| Native binary   | High (cargo/brew) | ✗                  | ✓             | ✓ (PGlite/Postgres-compatible) |
| WASM in browser | **Zero**          | ✓                  | ✓             | ✓ (IndexedDB)                  |
| Remote API      | Low (API key)     | ✓                  | ✗ (needs net) | ✓ (Postgres)                   |

Browser-based LLMs run entirely in the user's browser and cannot spawn native processes. A WASM
module loaded into a Web Worker _is_ a native process from the browser's perspective — it gets its
own thread, persistent storage (IndexedDB), and can run indefinitely.

## Stack

| Layer            | Technology                         | Notes                                 |
| ---------------- | ---------------------------------- | ------------------------------------- |
| Core logic       | `sulcus-core` compiled to WASM     | Pure Rust, no `std::fs`, no TCP       |
| MCP surface      | `sulcus-wasm` (`wasm-bindgen`)     | Thin bindings over `sulcus-core`      |
| Database         | PGlite (`@electric-sql/pglite`)    | Full Postgres SQL in WASM + IndexedDB |
| SQL bridge       | JS callback → `sulcus-wasm`        | WASM calls JS for raw SQL; no `sqlx`  |
| Embeddings       | `transformers.js` (MiniLM-L6-v2)   | 384-d, same dim as native `fastembed` |
| Embedding bridge | JS callback → `sulcus-wasm`        | WASM calls JS for embedding inference |
| MCP transport    | `postMessage` / Web Worker API     | Zero-latency; same origin             |
| Persistence      | IndexedDB (browser) / FS (Node.js) | Controlled by PGlite storage adapter  |
| Packaging        | `wasm-pack` → NPM package          | Drop-in `import`                      |

## Crate: `sulcus-wasm`

Location: `crates/sulcus-wasm/`

### Design constraints

- **No `tokio`** — use `wasm-bindgen-futures::spawn_local` for async.
- **No `fastembed` / ORT** — embeddings come in via a `js_sys::Function` callback supplied at init.
- **No `sqlx`** — raw SQL is dispatched to PGlite via a `DbBridge` JS callback.
- **No `std::fs` / `memmap2`** — `active_index` is kept in a `Vec<NodePointer>` in WASM memory
  (no mmap; mmap is Linux/macOS only).
- **`sulcus-core`** is already compatible: it has no OS file I/O in the hot path; only
  `SharedIndexBuffer::write_nodes` uses `memmap2` which we bypass in the WASM path.

### Public API (via `wasm-bindgen`)

```typescript
// Initialised once per Worker
const mem = await SulcusMem.init({
  db: pglite,       // PGlite instance (already migrated)
  embed: async (text: string) => Float32Array   // transformers.js call
});

// MCP tool shims
await mem.addMemory({ text, memory_type? });
await mem.searchMemory({ query, limit? });
await mem.buildContext({ prompt, token_budget? });
await mem.tick({ decay?, spread?, limit? });
await mem.listHotNodes({ limit? });
```

### File layout

```
crates/sulcus-wasm/
├── Cargo.toml           # crate-type = ["cdylib"]
└── src/
    ├── lib.rs           # wasm_bindgen entry, SulcusMem struct
    ├── bridge.rs        # DbBridge + EmbedBridge (JS callback wrappers)
    ├── mcp.rs           # MCP tool handlers (add_memory, search_memory, …)
    └── thermo.rs        # tick() and ignite() reimplemented without sqlx
```

## NPM Package: `@sulcus/mem`

`wasm-pack build crates/sulcus-wasm --target web --out-dir packages/sulcus-mem`

Published as `@sulcus/mem`. Consumers:

```ts
import { SulcusMem } from "@sulcus/mem";
import { pipeline } from "@xenova/transformers";
import { PGlite } from "@electric-sql/pglite";

const embedder = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2",
);
const pglite = await PGlite.create("idb://sulcus");

const mem = await SulcusMem.init({
  db: pglite,
  embed: async (text) => {
    const out = await embedder(text, { pooling: "mean", normalize: true });
    return out.data; // Float32Array
  },
});
```

## Integration with existing native stack

The WASM and native distributions are **not in conflict** — they share the same SQL schema
(`0001_create_tables.sql`, `0002_typed_memories.sql`, `0003_crdt_clocks.sql`) and the same
`sulcus-core` business logic.

- The native binary connects to PGlite via the Postgres wire protocol (port 5433).
- The WASM module calls PGlite in-process via the JS bridge.
- Both read/write the same IndexedDB database.

This means a VS Code extension can run `sulcus-wasm` (WASM) while simultaneously an
OpenClaw plugin uses the native binary — both talking to the **same PGlite IndexedDB** store,
synchronized automatically via the CRDT layer.

## Milestones

1. `sulcus-wasm` crate scaffold + `wasm-pack` build pipeline **← current**
2. `DbBridge`: raw SQL dispatch from WASM → PGlite JS
3. `EmbedBridge`: embedding callback WASM ↔ transformers.js
4. MCP tool handlers (add_memory, search_memory, build_context, tick)
5. NPM package `@sulcus/mem` published
6. Claude.ai browser extension proof-of-concept
7. VS Code web extension using `@sulcus/mem` (replaces stdio MCP)
