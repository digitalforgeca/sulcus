# sulcus-wasm — Sulcus Memory in the Browser

Run the full Sulcus reactive, thermodynamic memory engine inside a browser or edge worker — no server required.

`sulcus-wasm` compiles the core memory model (thermodynamics, CRDT, graph diffusion) to WebAssembly and bridges to [PGlite](https://pglite.dev/) for in-browser Postgres and [Transformers.js](https://huggingface.co/docs/transformers.js) for local embeddings.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Browser / Edge Worker                       │
│                                              │
│  ┌────────────┐  ┌────────────┐             │
│  │  PGlite    │  │ Xenova     │             │
│  │  (IDB)     │  │ MiniLM-L6  │             │
│  └─────┬──────┘  └─────┬──────┘             │
│        │ sql bridge     │ embed bridge       │
│  ┌─────▼────────────────▼──────┐             │
│  │     sulcus-wasm (Rust)      │             │
│  │  · thermo decay/spread      │             │
│  │  · CRDT merge               │             │
│  │  · MCP tool surface         │             │
│  └─────────────────────────────┘             │
└──────────────────────────────────────────────┘
```

## Quick Start

```typescript
import init, { SulcusMem } from "@sulcus/mem";
import { pipeline } from "@xenova/transformers";
import { PGlite } from "@electric-sql/pglite";

// 1. Load WASM binary
await init();

// 2. Set up bridges
const pglite = await PGlite.create("idb://sulcus");
const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

// 3. Create Sulcus instance
const mem = SulcusMem.create(
  async (sql, params) => (await pglite.query(sql, params)).rows,
  async (text) => {
    const out = await embedder(text, { pooling: "mean", normalize: true });
    return out.data; // Float32Array (384-d)
  },
);

// 4. Use it
await mem.add_memory("User prefers dark mode", "preference");
const results = await mem.search("what theme does the user like?");
await mem.tick(); // Run one decay/spread cycle
```

## MCP Tool Surface

| Tool | Description |
|------|-------------|
| `add_memory(text, type?, namespace?)` | Store a memory with automatic embedding |
| `search_memory(query, limit?)` | Hybrid FTS + cosine similarity search |
| `list_hot_nodes(limit?)` | Get hottest memories by current_heat |
| `tick()` | Run one thermodynamics cycle (decay + resonance spread) |

## How It Works

- **Database**: PGlite runs a real Postgres instance inside IndexedDB — full SQL, pgvector extensions, persistent across sessions
- **Embeddings**: Transformers.js runs a quantized MiniLM-L6 model entirely in the browser — no API calls, no data leaves the device
- **Thermodynamics**: The same `sulcus-core` decay/spread engine that runs on the server compiles to WASM unchanged — identical heat curves, identical CRDT merge

## Building

Requires [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/):

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Build the WASM package
cd crates/sulcus-wasm
wasm-pack build --target web --out-name sulcus-mem

# The output goes to pkg/ — publishable to npm as @sulcus/mem
```

## Use Cases

- **Offline-first AI apps** — Memory persists in IndexedDB, syncs to cloud when online
- **Privacy-sensitive deployments** — All data stays in the browser, zero network calls
- **Edge workers** — Cloudflare Workers / Deno Deploy with WASM support
- **Browser extensions** — Add persistent memory to any LLM chat interface

## Crate Dependencies

- `sulcus-core` — Pure Rust memory model (thermodynamics, CRDT, graph)
- `wasm-bindgen` — JS ↔ WASM interop
- `js-sys` / `web-sys` — Browser API bindings
- `serde` / `serde_json` — Serialization

## Status

The WASM crate builds and the tool surface is functional. The npm package (`@sulcus/mem`) is planned but not yet published — build from source for now.

## License

Proprietary — © Digital Forge Studios. See LICENSE-COMMERCIAL.
