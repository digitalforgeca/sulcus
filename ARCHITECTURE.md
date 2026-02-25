# SULCUS Architecture

## 1. Workspace Structure

The project is a Cargo Workspace containing three crates:

```text
SULCUS/
├── Cargo.toml              # Workspace definition
├── crates/
│   ├── sulcus-core/        # Shared Business Logic (The Brain)
│   │   # Dependencies: sqlx, serde, uuid, chrono, anyhow
│   │   # Responsibility: Defines Node, Edge, thermodynamics(), and Sync traits.
│   │
│   ├── sulcus-local/       # Open Source CLI (The Sidecar)
│   │   # Dependencies: sulcus-core, fastembed, sqlx(postgres), tokio
│   │   # Responsibility: MCP Server (Stdio), Local Embeddings, Offline Sync.
│   │
│   └── sulcus-server/      # Enterprise API (The Platform)
│       # Dependencies: sulcus-core, axum, tower, shuttle-runtime
│       # Responsibility: Multi-tenant Sync, Dashboard API, Auth.
```

## 2. The Core Brain (`crates/sulcus-core`)

This library defines the physics of memory.

### The Data Model

- **Node (`sulcus_nodes`):**
  - `id` (UUIDv7): Time-sortable unique ID.
  - `vector` (Blob): The embedding.
  - `heat` (Float): Current activation level (0.0 - 100.0).
- **Edge (`sulcus_edges`):**
  - `source`, `target`, `weight`.
  - `type`: 'Semantic' (Vector sim) or 'Hebbian' (Usage).

### The Thermodynamics Engine

A background `tokio` task that runs every minute:

1. **Decay:** `UPDATE nodes SET heat = heat * 0.9`.
2. **Prune:** `DELETE FROM active_index WHERE heat < 1.0`.

## 3. The Local Sidecar (`crates/sulcus-local`)

- **Target:** Individual Developers.
- **Storage:** PostgreSQL-compatible local backend (PGlite bridge or Postgres).
- **Interface:** MCP over Stdio.
- **Sync:** Pushes `MemoryOp` deltas to the configured `SULCUS_SERVER_URL`.

## 4. The Cloud Platform (`crates/sulcus-server`)

- **Target:** Teams & Enterprise.
- **Storage:** PostgreSQL (Multi-tenant).
- **Isolation:** All queries MUST filter by `org_id`.
- **Sync Logic:**
  - Accepts `push` batch from agents.
  - Merges vectors into the "Golden Index."
  - Resolves UUID collisions via LWW (Last-Write-Wins).

## 5. The WASM Distribution (`crates/sulcus-wasm`)

The primary zero-friction distribution path. A single WASM module gives any
browser-based LLM (Claude.ai, ChatGPT canvas, Gemini, WebLLM) a full MCP memory
service — **no server, no binary to install, no network required.**

```
Browser / VS Code Web Extension
  └─ Web Worker
       ├─ sulcus-wasm   (Rust→WASM: thermodynamics, CRDT, MCP tool handlers)
       ├─ PGlite        (WASM Postgres + IndexedDB — same schema as native)
       └─ transformers.js (MiniLM-L6-v2 embeddings, 384-d)
```

- **No `sqlx`** — raw SQL dispatched via a JS `DbBridge` callback to PGlite
- **No `fastembed`/ORT** — embeddings via a JS `EmbedBridge` callback to transformers.js
- **No `tokio`** — async via `wasm-bindgen-futures::spawn_local`
- **No `memmap2`** — `active_index` held in WASM linear memory (no filesystem mmap)
- Same SQL schema and `sulcus-core` logic as the native binary

Build: `wasm-pack build crates/sulcus-wasm --target web --out-dir packages/sulcus-mem`
See [WASM.md](WASM.md) for the full design.

## 6. The Dashboard (Web)

- **Stack:** React + Vite.
- **Features:**
  - **The Sulcus Graph:** Force-directed view of the team's memory.
  - **Memory Surgeon:** Table view to edit/delete hallucinations.

## 6. The Data Model (The "Brain")

### The Map (Nodes)

- `id` (UUIDv7): Time-sortable unique identifier.
- `summary` (String): A <200 char semantic summary.
- `vector` (Blob): The embedding (384-d or 1536-d).
- `heat` (Float): 0.0 to 100.0. Decays by 15% every tick.
- `payload_id` (FK): Pointer to the heavy text.

### The Topology (Edges)

- `source` (UUID): Origin node.
- `target` (UUID): Destination node.
- `weight` (Float): 0.0 to 1.0. Determines how much heat flows during "Spreading Activation."
- `type` (Enum):
  - Semantic (Created by Vector similarity).
  - Hebbian (Created by usage: "Fired together").
  - Explicit (Created by human admin).

## 7. The "Thermodynamics" Engine

This runs as a background task.

- **Strike:** User prompt hits Node A (Heat -> 100.0).
- **Spread:** Recursive SQL CTE flows heat from A -> B -> C based on edge weight.
- **Decay:** All nodes cool down (heat \*= 0.85).
- **Index:** The top 20 hottest nodes are rendered into the active_index JSON.

## 8. The Sync Protocol (Hub-and-Spoke)

We do NOT sync the database file. We sync the Write-Ahead Log (WAL).

- **Push (Client -> Server):** Sends a list of MemoryOp (Add/Update/Delete) that occurred since the last sync_cursor.
- **Pull (Server -> Client):** Returns a list of MemoryOp from other agents that occurred after sync_cursor.
- **Merge Strategy:** Last-Write-Wins (LWW) based on UUIDv7 timestamp.

## 9. API Specification (The Interface)

### Model Context Protocol (MCP)

Used by `sulcus-local` to talk to the AI Agent (e.g., OpenClaw, Claude).

- **Transport:** Stdio (Standard Input/Output).

#### Resources

- `memory://active_index`: Returns the JSON list of "Hot" nodes.
  - _Purpose:_ Injected into the System Prompt. Gives the agent "Peripheral Vision."

#### Tools

- `add_memory(content: string, tags: list[string])`:
  - Embeds content.
  - Creates Node + Payload.
  - Triggers "Strike" (heats up the new memory).
- `fetch_payload(id: uuid)`:
  - Returns the full raw text.
  - **Side Effect:** Creates a Hebbian Edge between this node and the previously fetched node.

### HTTP API (The SaaS Layer)

Used by `sulcus-server` for Sync and Dashboard.

#### Agent Endpoints (`/api/v1/agent`)

- `POST /sync`:
  - **Auth:** Bearer Token (Agent Key).
  - **Body:** `{ "ops": [ ... ], "last_cursor": "timestamp" }`
  - **Response:** `{ "new_ops": [ ... ], "new_cursor": "timestamp" }`

#### Admin Endpoints (`/api/v1/admin`)

- `GET /memories`:
  - **Auth:** Cookie (Human Session).
  - **Query:** `?limit=50&sort=heat`
  - **Response:** List of memories for the Dashboard table.
- `PATCH /memories/:id`:
  - **Body:** `{ "content": "Corrected text...", "heat": 100.0 }`
  - **Purpose:** "Brain Surgery" (Human fixing AI memory).
- `GET /graph`:
  - **Response:** Node/Link JSON for the `react-force-graph` visualization.

## 10. SaaS Infrastructure (The "Hard" Requirements)

### Multi-Tenancy (The Golden Rule)

- **Strict Isolation:** Every single table in `sulcus-server` (Postgres) MUST have an `org_id` (UUID) column.
- **Row-Level Security (RLS):** All queries must filter by `org_id`.
  - _Bad:_ `SELECT * FROM memories WHERE heat > 50`
  - _Good:_ `SELECT * FROM memories WHERE org_id = $1 AND heat > 50`

### The Identity Model

1. **Organization (`orgs`):** The billing unit.
   - `id`, `name`, `stripe_customer_id`, `subscription_status`.
2. **Human (`users`):** The dashboard login.
   - `id`, `email`, `org_id` (FK), `role` (Admin/Member).
3. **Machine (`api_keys`):** The agent's credential.
   - `key_hash` (SHA256), `org_id` (FK), `label` (e.g., "Dev Agent 1").

### Billing Integration

- **Provider:** Stripe (or LemonSqueezy).
- **Mechanism:** Webhooks.
- **Logic:**
  - When `checkout.session.completed` -> Create `org`.
  - When `invoice.payment_failed` -> Set `org.status = 'past_due'`.
  - API requests from 'past_due' orgs are rejected with `402 Payment Required`.
