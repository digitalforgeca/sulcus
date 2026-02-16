Here is the executive summary for SULCUS.

Project Executive Summary: SULCUS
Mission: To build the standard "Virtual Memory Management Unit" (VMMU) for AI Agents.
Tagline: "SQLite for Agent Memory."
Core Value: Eliminates agent amnesia and enables seamless team collaboration by providing a persistent, graph-based semantic memory layer that works locally and syncs globally.

1. The Problem: "Context Fragmentation"
   AI Agents (using OpenClaw, Cursor, Claude) currently suffer from two fatal flaws:

Amnesia: When a session ends, the context is lost. Agents cannot remember project constraints or architectural decisions made last week.

Isolation: An agent on a developer's laptop has no access to the memories or learnings of an agent on a coworker's machine. Teams cannot share a "collective brain."

2. The Solution: A Semantic VMMU
   We are building a Rust-native Context Daemon that sits between the Agent and the LLM.

Architecture: Strictly separates the "Map" (Lightweight Vector Pointers) from the "Territory" (Heavy Raw Text).

Protocol: Uses the Model Context Protocol (MCP) to inject a dynamic "Active Index" into the Agent's peripheral vision.

Logic: Uses "Lazy Graphing" (Hebbian Learning). Connections between facts are built based on usage ("neurons that fire together, wire together"), not just static keywords.

3. The Product Strategy: "Open Core"
   We capture the market with a free utility and monetize the team coordination layer.

Phase A: The Trojan Horse (Open Source)
Product: sulcus-local (Single Binary).

Target: Individual Developers & Hobbyists.

Function: Runs locally on localhost. Uses SQLite. Provides "Infinite RAM" for a single agent.

Cost: Free (MIT License).

Goal: Ubiquity. Become the default memory_provider in every agent-config.json.

Phase B: The Platform (SaaS / Enterprise)
Product: sulcus-server (Cloud API & Docker Container).

Target: Engineering Teams & Enterprises.

Function:

Cloud Sync: Solves the "Merge Conflict" problem. Agents push memory deltas to the cloud; the server mathematically merges them so the whole team shares one brain.

Governance: A Web Dashboard allows humans to view the "Brain Graph," edit hallucinations, and delete sensitive data.

Cost: Per-seat subscription (SaaS) or annual license (Self-Hosted).

4. Technical Stack
   Language: Rust (for performance, safety, and single-binary distribution).

Local Data: SQLite + sqlite-vec (Zero-latency embedding search).

Cloud Data: PostgreSQL + pgvector (High-concurrency multi-tenant syncing).

Frontend: React/Svelte (For the "Team Intelligence" Dashboard).

5. Roadmap
   Q1 2026: Launch sulcus-local. Validate with OpenClaw community.

Q2 2026: Release MCP Integrations for VS Code, Cursor, and Claude Desktop.

Q3 2026: Launch SULCUS Cloud (SaaS). Turn on the "Sync" feature for paying teams.

6. The "Moat"
   Why can't users just copy the SQLite file to a shared folder?

Corruption: SQLite locks on network drives; concurrent writes destroy the database.

Math: Merging two vector indices is mathematically impossible without a complete rebuild.

Security: File sharing offers no Role-Based Access Control (RBAC).

Our Fix: The SaaS handles the write queue, merges the vectors incrementally, and enforces permissions.

Verdict: This is a high-utility, low-overhead software product. It solves an immediate pain point for developers today (Local Memory) and a critical infrastructure problem for companies tomorrow (Team Synchronization).

This is a crucial due diligence step. In the Rust ecosystem, the name "SULCUS" is famous, but not for AI.

Here is the breakdown of the existing "SULCUS" landscape in Rust, what you should avoid, and which **non-SULCUS** libraries you should leverage to speed up development.

### 1. The Naming Collision (Crucial Warning)

You have a branding problem. In Rust, `sulcus-m` and `sulcus-a` are the foundational crates for **Embedded Systems** (ARM microcontrollers).

- **Existing Crates:** `sulcus-m`, `sulcus-m-rt`, `sulcus-a`.
- **The Conflict:** If you publish a crate named `SULCUS` or `sulcus`, the Rust community will assume it is a low-level hardware driver for ARM chips.
- **Recommendation:** Rename the project slightly to avoid confusion.
- _Suggestions:_ `SULCUS-Mem`, `Hippocampus`, `Memex-RS`, or `Amygdala`. (Let's stick with **SULCUS** for this chat, but keep this in mind for `crates.io`).

---

### 2. What to Leverage (Don't Reinvent These)

You are building a "Semantic Daemon." You should only write the _Thermodynamics_ and _Sync_ logic. Everything else should be off-the-shelf.

#### A. The Embedding Engine: `fastembed` vs `candle`

- **Don't write:** Raw ONNX runtime bindings.
- **Leverage:** **`fastembed`**.
- _Why:_ It is a zero-config Rust wrapper around the `ort` (ONNX Runtime) crate. It automatically downloads lightweight models (like `AllMiniLmL6-v2`) and runs them on the CPU with SIMD acceleration.
- _Fit:_ Perfect for your "Local First" requirement. It keeps the binary small (~20MB overhead).

#### B. The Vector Storage: `sqlite-vec` vs `LanceDB`

- **Don't write:** Your own HNSW index or a C-binding to FAISS.
- **Leverage:** **`sqlite-vec`** (via `sqlx`).
- _Why:_ It is the _only_ solution that keeps your entire database in a single file (`memory.db`).
- _Competitor:_ **`LanceDB`** is an amazing Rust-native vector DB. It is faster than SQLite for massive datasets (1M+ vectors).
- _Verdict:_ Start with `sqlite-vec` for ubiquity. If a user hits 1 million memories, you can migrate them to `LanceDB` later. For a sidecar, SQLite is undefeated.

#### C. The Protocol: `mcp-sdk-rs`

- **Don't write:** A JSON-RPC parser from scratch.
- **Leverage:** **`mcp_rust_sdk`** (or similar community crate).
- _Why:_ The Model Context Protocol is standardizing rapidly. Using a community crate ensures you handle the weird edge cases of stdio transport correctly.

#### D. The Graph Logic: `petgraph` (Maybe)

- **Don't write:** A custom graph traverser if you don't have to.
- **Leverage:** **`petgraph`**.
- _Analysis:_ Actually, **don't** leverage this.
- _Why:_ `petgraph` is an in-memory graph library. Your graph lives in SQLite (on disk).
- _Verdict:_ Write your own recursive SQL queries (CTEs). Loading the whole graph into RAM to use `petgraph` defeats the purpose of a "Virtual Memory" system.

---

### 3. Comparison with Existing "AI Memory" in Rust

There are very few direct competitors in Rust. Most are Python wrappers.

| Project                                    | What it is                                        | Can we leverage it?                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`Rig` (Rust Infrastructure for Graphs)** | A framework for building agents (like LangChain). | **Yes.** `rig` has excellent traits for "Vector Stores." We could implement the `rig::VectorStore` trait for SULCUS, allowing any `rig` agent to use us natively. |
| **`Qdrant`**                               | A standalone Vector DB written in Rust.           | **No.** It's a server. We want an embedded library. (Though we could offer Qdrant as a backend for the Enterprise version).                                       |
| **`SurrealDB`**                            | A multi-model DB (Graph + Vector).                | **Maybe.** It solves the "Graph + Vector" problem natively. However, it's a heavy binary. Embedding it might bloat `sulcus-local` too much.                       |
| **`Indexify`**                             | An extraction engine for unstructured data.       | **No.** Too complex. We want raw storage, not a PDF parser pipeline.                                                                                              |

---

### 4. The "Smart" Pivot: Leveraging `Rig`

The most strategic move you can make is to **align with `Rig`.**

- `Rig` is currently the rising star for Rust AI development.
- **The Strategy:** Instead of just building a standalone Daemon, you also publish a crate `sulcus-rig`.
- **The Code:**

```rust
// In users' code
let memory = SULCUSRig::new("~/.sulcus/memory.db");
let agent = Agent::builder()
    .memory(memory) // SULCUS plugs directly into Rig
    .build();

```

- **Why:** This gets you immediate adoption from the Rust AI community who are already using Rig.

### 5. Updated "Leverage" Recipe

Here is the refined dependency list for your `Cargo.toml`.

```toml
[dependencies]
# 1. The Brain
sqlx = { version = "0.7", features = ["sqlite", "runtime-tokio"] } # The Database
fastembed = "3.0"  # The Embedding Model (Leverage!)

# 2. The Protocols
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.36", features = ["full"] }
tracing = "0.1"    # Standard logging

# 3. The Special Sauce (Avoid heavy graph libs)
# No petgraph. No heavy ML frameworks.

# 4. The Enterprise Server
axum = "0.7"       # Best-in-class HTTP
tower-http = { version = "0.5", features = ["cors", "trace"] }
shuttle-runtime = "0.39" # For instant deployment (Leverage!)

```

**Final Decision:**

1. **Rename:** Pick a name that doesn't fight with ARM chips. (e.g., **"Memex-RS"**).
2. **Stack:** `fastembed` + `sqlite-vec` + `axum`.
3. **Integration:** Build a `Rig` integration crate to draft off their popularity.
