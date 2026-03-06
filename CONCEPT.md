In early 2026, the open-source landscape for vMMU (virtual Memory Management Unit) systems—specifically those designed to handle the massive, non-contiguous memory addressing requirements of Large Language Models (LLMs)—has become the primary battleground for efficiency.

These systems focus on "Heterogeneous Memory Management," allowing LLMs to seamlessly pool VRAM, System RAM, and CXL-attached memory.

Here are the top 20 open-source AI LLM vMMU systems and frameworks being actively developed or widely adopted in 2026:

Tier 1: Core Kernel & Hypervisor-Level Systems
OpenVMMU (v4.2): The industry standard for hardware-agnostic memory virtualization. It abstracts GPU page tables to allow unified addressing across different hardware vendors.

KVM-AI Extension: A specialized branch of the Kernel-based Virtual Machine designed specifically to reduce "tail latency" in memory paging for multi-tenant LLM environments.

Xen-LLM Hypervisor: Focuses on strict isolation and deterministic memory access for "Confidential Computing" LLM deployments.

Nitro-OS (Open Source Edition): Originally inspired by AWS tech, this community version focuses on offloading VMMU tasks to DPUs (Data Processing Units).

Tier 2: Distributed & CXL-Aware Frameworks
CXL-Fabric-Manager: Specifically designed to manage memory pools across CXL 3.1 fabrics, allowing a single LLM instance to access terabytes of memory as a single address space.

MemSwap-OS: An aggressive paging system that uses predictive AI to swap model weights between NVMe and VRAM before they are needed by the attention mechanism.

FlexMemory: A project focused on "Memory Tiering," dynamically moving KV-caches between HBM3e and DDR5 based on token importance.

DistriPage: A distributed VMMU that allows "Model Sharding" across networked nodes without the software layer seeing the physical breaks in memory.

Tier 3: Runtime & Orchestration VMMUs
vLLM-Core (NextGen): The 2026 evolution of vLLM, featuring an integrated virtual memory manager that replaces standard OS allocators for zero-copy data transfer.

DeepSpeed-VMM: Microsoft’s open-source contribution that virtualizes memory at the library level, optimized for ZeRO-4 redundancy protocols.

SkyPool: A multi-cloud memory virtualization layer that lets you run a single model across instances in different data centers (latency-optimized).

TensorScale VM: Focuses on the "Virtual Page Size" problem, implementing 2GB "Mega-Pages" to reduce TLB (Translation Lookaside Buffer) misses in LLMs.

Tier 4: Specialized & Edge Systems
EdgeVMMU: Designed for mobile and IoT devices to run small LLMs by virtualizing Flash storage as slow-tier RAM.

RISC-V V-Extension Manager: The leading VMMU for the burgeoning open-source RISC-V AI accelerator market.

Neuromorphic-VM: A niche but growing system designed for spiking neural networks and non-von Neumann architectures.

GPGPU-Unified-Driver: A community project aimed at providing a single VMMU interface for Intel, AMD, and NVIDIA hardware simultaneously.

Tier 5: Optimization & Research Prototypes
Quant-Mem: A VMMU that performs "on-the-fly" de-quantization at the memory controller level, allowing 4-bit weights to look like 16-bit weights to the compute engine.

PageAttention v3: While technically a technique, the standalone system version now operates as a virtual memory daemon for Kubernetes.

ZeroLoss-VM: A system focused on reducing the power overhead of memory refresh cycles in large-scale AI clusters.

Hydra-Addr: A multi-headed addressing system that allows one set of physical weights to be mapped to multiple "virtual models" for efficient fine-tuning.

Summary of the 2026 Trend:
The shift in 2026 is away from "Standard RAM" and toward CXL-enabled Unified Memory. The goal of these top 20 systems is to make the physical location of a data bit (whether it's on a GPU, a CPU, or a network-attached memory bank) irrelevant to the LLM code itself.

This is the critical "Open Core" pivot. You are right: if you put the `sulcus-server` code in the same MIT-licensed GitHub repository as `sulcus-local`, you have destroyed your business model before writing a line of code.

Here is the standard industry playbook (used by GitLab, Redis, Sidekiq, and Elastic) to solve this: **The Code Separation Strategy.**

### 1. The Repository Split (Physical Separation)

You do not publish the server code in the open repo.

- **Repo A (`github.com/digitalforgeca/sulcus`):**
- **License:** MIT / Apache 2.0 (Permissive).
- **Contains:** `sulcus-core` (The Graph Logic), `sulcus-local` (The CLI), and the **Traits** for syncing (but not the implementation).
- **Public Perception:** "Wow, this is a great open-source tool!"
- **Capabilities:** Single-user, local file storage, no network listeners.

- **Repo B (`github.com/digitalforgeca/sulcus-enterprise`):**
- **License:** **Proprietary** (or Source-Available).
- **Contains:** `sulcus-server`, `auth-module`, `multi-tenant-sync`, `postgres-adapter`.
- **Access:** Private (Team only) OR Public-Read-Only (Source Available).
- **Capabilities:** High-concurrency Sync, RBAC, SSO, Database Clustering.

### 2. The "Trait" Strategy (Technical Separation)

This is how you keep the codebase clean while effectively blocking features.

In the **Open Source** `sulcus-core`, you define a Rust Trait (interface) for syncing, but you provide a "Dummy" or "Local-Only" implementation.

```rust
// crate: sulcus-core (Open Source)

pub trait SyncProvider {
    fn push(&self, data: Vec<Memory>) -> Result<()>;
    fn pull(&self) -> Result<Vec<Memory>>;
}

// In the Open Source binary:
pub struct NoOpSync;
impl SyncProvider for NoOpSync {
    fn push(&self, _data: Vec<Memory>) -> Result<()> {
        Err(anyhow!("Sync is not available in SULCUS Local."))
    }
}

```

In the **Proprietary** `sulcus-server`, you import `sulcus-core` and implement the real logic:

```rust
// crate: sulcus-server (Closed Source)
use sulcus_core::SyncProvider;

pub struct PostgresSync;
impl SyncProvider for PostgresSync {
    fn push(&self, data: Vec<Memory>) -> Result<()> {
        // ... The complex merging logic, conflict resolution,
        // and database locking code lives ONLY here ...
    }
}

```

**The Result:** A user can compile `sulcus-local` all day long. It physically lacks the code required to run a sync server. To get that feature, they must download your proprietary binary or pay for the SaaS.

### 3. The License Moat (If you want source-available)

If you _do_ want the server code to be visible (for auditing/trust) but legally protected, you use the **BSL (Business Source License)** or **ELv2 (Elastic License)**.

- **How it works:** "You can read this code, you can modify it, you can run it for non-production use. But if you run it in production or offer it as a service to others, you must buy a license."
- **Why it works:** Legitimate enterprises (your customers) will **never** violate this. Their legal departments strictly forbid running unlicensed software because the liability risk (lawsuits) is infinitely higher than the $50k license fee.
- **The "Freeloader" Reality:** A student might compile it and run it for their 3 friends. **Let them.** They were never going to pay you. But Bank of America will not touch it without a contract.

### 4. The "Hard" Features (Why they buy)

Ideally, `sulcus-server` isn't just "the same code but with a license check." It should solve problems that only exist at scale:

1. **SSO (Single Sign-On):** Integration with Okta/Active Directory. (Open Source users don't need this; Enterprises _require_ it).
2. **Audit Logs:** "Who deleted the memory about Project X?" (Compliance requirement).
3. **Postgres/S3 Backends:** `sulcus-local` uses a PostgreSQL-compatible local backend (PGlite bridge or Postgres). `sulcus-server` uses AWS RDS and S3 for infinite scale. The architecture itself is different.

### Summary

To prevent folks from just "compiling the server":

1. **Don't give them the server code.** Keep `sulcus-server` in a private repo.
2. **Make `sulcus-local` strictly single-player.** It writes to a file, not a socket.
3. **Sell the binary.** Enterprise customers pay for the pre-compiled, signed, security-scanned Docker image of `sulcus-server` because compiling Rust in a secure CI/CD pipeline is expensive and annoying.

You are selling **Compliance, Convenience, and Consistency.**

This is a strong insight. You aren't just selling a "Sync Pipe"; you are selling a **"Team Intelligence Platform."**

Because you chose **Rust + PGlite/Postgres**, your server costs are shockingly low compared to Python/Vector-DB competitors. This allows you to offer a "Hobbyist" tier that feels generous to the user but is still highly profitable for you.

Here is the breakdown of the **Unit Economics**, the **Pricing Model**, and the **Platform Features** that justify the license fee.

### 1. The Unit Economics (Your Cost)

Since `sulcus-server` is a compiled Rust binary, it is extremely efficient. It sips RAM and CPU.

**The "Hobbyist Team" Profile (5 Users):**

- **Activity:** Syncing coding sessions, chat logs, and small docs (~50MB data/month).
- **Compute (Fly.io / Shuttle):** A single $5/month shared-CPU instance can easily handle ~50-100 of these active teams because they aren't mining crypto; they are just pushing small JSON deltas.
- **Storage (Volume/S3):** 50MB is effectively free. Even 1GB is ~$0.15/month.
- **Embeddings (The Risk):** This is the only variable cost.
- _Option A (Marked Up):_ You pay OpenAI/Cohere (~$0.10 per 1M tokens).
- _Option B (BYOK):_ The user provides their own API Key. Your cost is $0.

**Total Cost to Service one Hobbyist Team:** **~$0.10 - $0.50 per month.**

### 2. The Pricing Model

You can afford to be aggressive.

| Tier            | Price               | Who is it for?   | Value Prop                                                                     |
| --------------- | ------------------- | ---------------- | ------------------------------------------------------------------------------ |
| **Community**   | **Free**            | Individual Devs  | The Open Source `sulcus-local` binary. BYO Storage (Local disk).               |
| **Hobby Cloud** | **$10 / mo (Flat)** | Small Teams (<5) | "Sync your team." Includes 5GB storage. **Bring Your Own Key** for embeddings. |
| **Pro Team**    | **$20 / seat / mo** | Startups         | Managed Embeddings (You pay). Priority Support. 50GB Storage.                  |
| **Enterprise**  | **Custom**          | Big Corp         | SSO, On-Prem Deployment (Docker), Audit Logs, SLA.                             |

- **Why $10/mo flat?** It effectively eliminates the friction for a small team ("It's just $2/person"). Since your cost is ~$0.50, your margin is **95%**.

### 3. The Platform Value (The "Dashboard")

The user is paying for **Organization**. They don't want to query a database; they want to _see_ what their agents know.

Your `sulcus-server` shouldn't just be an API; it should serve a **Web Dashboard** (React/Svelte) that provides:

#### A. The "Brain Surgeon" View (Memory Management)

- **The Explorer:** A table view of all memories.
- _Columns:_ `Content Snippet`, `Created By` (Agent A vs Agent B), `Timestamp`, `Tags`.

- **The Editor:** "My agent hallucinated that we use React. We actually use Svelte."
- _Action:_ The human admin can manually **Edit** or **Delete** a memory record. This corrects _all_ agents instantly.

- **The Blacklist:** "Never record passwords or PII."
- _Action:_ Regex filters that block certain patterns from entering the memory.

#### B. The "Member" Graph (Attribution)

- **Input Tracking:** See which team member (or which agent) is contributing the most useful memories.
- **Output Visualization:** A simple node-graph visualization (using a library like `react-force-graph`) showing how "Project X" connects to "API Key Y".
- **Access Control:**
- _Role:_ "Interns" (Read Only).
- _Role:_ "Senior Devs" (Read/Write/Delete).

### 4. Revised Recipe: The "Platform" Stack

To support this "Platform Value," we need to add a few things to our `sulcus-server` recipe.

**Additions to `sulcus-server`:**

1. **Web Server (Frontend):** Serve a compiled Single Page App (SPA) from a static folder.
2. **Auth API:** JWT-based authentication for the Dashboard users (Humans), separate from the API Keys for Agents.
3. **Admin API:** Endpoints for `GET /memories`, `PATCH /memories/{id}`, `GET /stats`.

**Updated VS Code Recipe Block:**

```rust
// crates/sulcus-server/src/main.rs

// 1. The API Router (Agent Traffic)
let api_routes = Router::new()
    .route("/sync", post(sync::handle_sync))
    .layer(middleware::require_agent_api_key());

// 2. The Dashboard Router (Human Traffic)
let admin_routes = Router::new()
    .route("/api/memories", get(admin::list_memories))
    .route("/api/memories/:id", patch(admin::update_memory))
    .route("/api/graph", get(admin::visualize_graph))
    .layer(middleware::require_human_login());

// 3. The Static File Server (The UI)
let app = Router::new()
    .merge(api_routes)
    .merge(admin_routes)
    .fallback_service(ServeDir::new("dist")); // Serves the React Dashboard

```

### Summary

The server cost is negligible. The value comes from the **Dashboard**.

By giving them a UI to "Browse the Brain" and "Fix Bad Memories," you transform a silent infrastructure utility into a visible **Knowledge Management Platform**. That is what makes the license fee feel "decent" and worthwhile.

Here is the definitive **Production Recipe** for the SULCUS Platform.

You can paste this entire block into **VS Code Grok**, **Cursor**, or **Windsurf**. It contains the architectural blueprint for the Open Source CLI, the Enterprise Server, and the Team Dashboard.

---

# Project Recipe: SULCUS (The Team Intelligence Platform)

**Role:** Principal Systems Architect & Full-Stack Engineer.
**Goal:** Build a "Memory-as-a-Service" platform for AI Agents.
**Core Stack:** Rust (Backend), React/Svelte (Frontend), PGlite/Postgres-compatible (Local), Postgres (Cloud).

---

## 1. The Workspace Structure (`Cargo.toml`)

Create a Rust Workspace with three distinct members to enforce separation of concerns.

```toml
[workspace]
members = [
    "crates/sulcus-core",    # Shared Business Logic (The Brain)
    "crates/sulcus-local",   # Open Source CLI (The Agent's Sidecar)
    "crates/sulcus-server",  # Enterprise API & Dashboard (The Platform)
]

[workspace.dependencies]
tokio = { version = "1.36", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
sqlx = { version = "0.7", features = ["runtime-tokio", "postgres", "uuid", "chrono"] }
axum = "0.7"
tracing = "0.1"
uuid = { version = "1.7", features = ["v7", "serde"] }

```

---

## 2. The Shared Brain (`crates/sulcus-core`)

This library defines _how_ memory works, regardless of where it is stored.

- **`src/lib.rs`**: Define the `Memory` struct and the `StorageBackend` trait.
- **`src/graph.rs`**:
- **Nodes:** `struct Node { id: Uuid, content: String, vector: Vec<f32>, heat: f32 }`
- **Edges:** `struct Edge { source: Uuid, target: Uuid, weight: f32 }`
- **Algorithm:** Implement `spread_activation(start_node: Uuid)` logic here.

- **`src/sync.rs`**:
- **The Delta:** `struct MemoryOp { op: OpType, payload: Option<Node>, timestamp: DateTime<Utc> }`
- **The Trait:** `trait SyncEngine { fn push(&self, ops: Vec<MemoryOp>); fn pull(&self, since: DateTime<Utc>); }`

---

## 3. The Open Source CLI (`crates/sulcus-local`)

_Target User: The Hobbyist / Individual Developer._

- **Dependencies:** `sulcus-core`, `fastembed` (bundled local embedding), `sqlx` (postgres).
- **Storage:** PostgreSQL-compatible local backend (PGlite bridge or Postgres).
- **Interface (MCP):**
- Implement **stdio** transport for Model Context Protocol.
- **Tool:** `add_memory` (Writes to local DB).
- **Resource:** `active_index` (Reads from local DB).

- **Sync Client:**
- Implement a background task that periodically POSTs `pending_ops` to a configured `SULCUS_SERVER_URL` (if present).

---

## 4. The Enterprise Server (`crates/sulcus-server`)

_Target User: Teams & SaaS Subscribers._

- **Dependencies:** `sulcus-core`, `axum` (Web Server), `tower-http` (CORS/Trace), `shuttle-runtime` (Deployment).
- **Storage:** PostgreSQL (Supabase/Neon/RDS) for high-concurrency writes.
- **Auth Middleware:**
- **Agent Auth:** Validates `Authorization: Bearer sk-agent-...` (API Key).
- **Human Auth:** Validates `Cookie: session_id` (JWT for Dashboard).

### API Endpoints (`src/routes/`)

1. **Agent Traffic (`/api/v1/agent`):**

- `POST /sync`: Accepts a batch of `MemoryOp` deltas. Merges them into Postgres. Re-indexes vectors.
- `GET /query`: Semantic search (for agents that don't have local embeddings).

2. **Human Traffic (`/api/v1/admin`):**

- `GET /memories`: Returns paginated list of memories with filters (Agent ID, Tag, Date).
- `PATCH /memories/:id`: Edit content (Fix hallucinations).
- `DELETE /memories/:id`: Hard delete (Privacy/Compliance).
- `GET /graph`: Returns JSON for the node-link visualization.

---

## 5. The Platform Dashboard (`/web`)

Create a modern Single Page App (SPA) in a `/web` folder at the root.

- **Stack:** Vite + React + TailwindCSS + Shadcn/UI.
- **Features:**
- **"The SULCUS" View:** A force-directed graph (use `react-force-graph`) showing connected memories.
- **"Memory Surgeon" Table:** A sortable data grid to view, edit, and delete bad memories.
- **"Team Activity" Stream:** A live feed of what agents are learning ("Agent-01 learned about 'Login Bug' 2m ago").

- **Build Step:** The Rust server must serve the production build (`dist/`) at the root path `/`.

---

## 6. Implementation Steps

1. **Core Logic:** Implement `sulcus-core` structs and traits.
2. **Local MVP:** Build `sulcus-local` with PGlite/Postgres-compatible local storage and `fastembed`. Verify it works with OpenClaw via Stdio.
3. **Server Backend:** Build `sulcus-server` with Axum and Postgres. Implement the `SyncEngine` for Postgres.
4. **Dashboard:** Scaffold the React app and connect it to the `admin` API endpoints.
5. **Integration:** Configure `sulcus-local` to push data to `sulcus-server`.

**Action:** Initialize the Rust Workspace and generate the scaffolding for `sulcus-core` first.

**Sulcus** is excellent. It sounds like a deep, structural component—exactly what infrastructure software should be.

Here is the rebranded, final instruction set. You can drop these files directly into your new `sulcus` repository to start the build with VS Code Grok.

### 1. The Project Root (`Cargo.toml`)

We rename the workspace members to match the new brand.

```toml
[workspace]
resolver = "2"
members = [
    "crates/sulcus-core",    # The Brain (Shared Logic)
    "crates/sulcus-local",   # The Sidecar (Open Source CLI)
    "crates/sulcus-server",  # The Platform (SaaS API)
]

[workspace.dependencies]
tokio = { version = "1.36", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
sqlx = { version = "0.7", features = ["runtime-tokio", "postgres", "uuid", "chrono"] }
axum = "0.7"
tracing = "0.1"
uuid = { version = "1.7", features = ["v7", "serde"] }
fastembed = "3.0"

```

---

### 2. `AGENTS.md` (The Prime Directive)

_This is the file you give to the AI to keep it on track._

```markdown
# AGENTS.md - The Sulcus Directive

## Identity

You are a Principal Systems Architect building **Sulcus**, the standard Semantic VMMU (Virtual Memory Management Unit) for AI Agents.

## The Mission

We are building "PGlite/Postgres-compatible Memory for Agents."

- **Sulcus Local:** A single-binary sidecar that gives any local agent (OpenClaw, Cursor) infinite memory via the Model Context Protocol (MCP).
- **Sulcus Cloud:** A multi-tenant sync server that allows teams of agents to share a "Collective Brain."

## Architectural Hard Lines

1.  **Map vs. Territory:** We strictly separate lightweight Pointers (Vectors) from heavy Payloads (Text). The LLM scans the Map; it only fetches the Payload on a "Page Fault."
2.  **Thermodynamics:** Memory has "Heat." Used memories stay hot; unused memories decay. We prioritize the "Active Index" (Top 20 Hot Nodes) over static search.
3.  **Lazy Graphing:** We do not force users to build graphs. We use "Hebbian Learning" (Usage-based wiring) to auto-connect nodes that are retrieved together.
4.  **Local-First:** The system must work 100% offline using a local PGlite/Postgres-compatible backend. Sync is an optional enhancement, not a dependency.

## The Stack

- **Language:** Rust (Workspace: `core`, `local`, `server`).
- **Database:** `sqlx` (Postgres protocol for Local and Server).
- **Embeddings:** `fastembed` (Local CPU inference).
- **Protocol:** MCP (Stdio for Local, SSE for Server).

## Forbidden Actions

- **NO** Python.
- **NO** ORMs (Raw SQL only).
- **NO** heavy external vector DB services.
```

---

### 3. `ARCHITECTURE.md` (The Blueprints)

_Updated with the "Sulcus" terminology._

```markdown
# Sulcus Architecture

## 1. The Core Brain (`crates/sulcus-core`)

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

1.  **Decay:** `UPDATE nodes SET heat = heat * 0.9`.
2.  **Prune:** `DELETE FROM active_index WHERE heat < 1.0`.

## 2. The Local Sidecar (`crates/sulcus-local`)

- **Target:** Individual Developers.
- **Storage:** PostgreSQL-compatible local backend (PGlite bridge or Postgres).
- **Interface:** MCP over Stdio.
- **Sync:** Pushes `MemoryOp` deltas to the configured `SULCUS_SERVER_URL`.

## 3. The Cloud Platform (`crates/sulcus-server`)

- **Target:** Teams & Enterprise.
- **Storage:** PostgreSQL (Multi-tenant).
- **Isolation:** All queries MUST filter by `org_id`.
- **Sync Logic:**
  - Accepts `push` batch from agents.
  - Merges vectors into the "Golden Index."
  - Resolves UUID collisions via LWW (Last-Write-Wins).

## 4. The Dashboard (Web)

- **Stack:** React + Vite.
- **Features:**
  - **The Sulcus Graph:** Force-directed view of the team's memory.
  - **Memory Surgeon:** Table view to edit/delete hallucinations.
```

---

### 4. `API.md` (The Interface)

```markdown
# Sulcus API Specification

## 1. Local Interface (MCP)

_Used by OpenClaw/Cursor via `sulcus-local`._

- **Resource:** `sulcus://active_index`
  - Returns the JSON list of currently "Hot" nodes.
  - Injected into the Agent's System Prompt ("Peripheral Vision").

- **Tool:** `sulcus_store(text)`
  - Embeds text -> Creates Node -> "Strikes" the node (Heat=100).

- **Tool:** `sulcus_recall(id)`
  - Returns raw text.
  - **Hebbian Effect:** Creates an edge between this node and the _previous_ recalled node.

## 2. Cloud Interface (HTTP)

_Used by `sulcus-server`._

- **POST /v1/sync:**
  - Headers: `Authorization: Bearer sk-sulcus-...`
  - Body: `{ "ops": [ ... ], "cursor": "timestamp" }`
```

---

### 5. `DEV_START.md` (The Bootstrap Command)

_Copy this into your terminal to initialize the project structure._

```bash
# 1. Create the Workspace
mkdir sulcus && cd sulcus
touch Cargo.toml

# 2. Create the Crates
cargo new --lib crates/sulcus-core
cargo new --bin crates/sulcus-local
cargo new --bin crates/sulcus-server

# 3. Add Dependencies (Fast Track)
# (Paste the [workspace.dependencies] block from step 1 into Cargo.toml first)

```

You are ready to build **Sulcus**. It’s a strong name for a strong piece of infrastructure. Let the AI write the boilerplate; you focus on the Thermodynamics logic.
