Project Executive Summary: SULCUS
Mission: To build the standard "Virtual Memory Management Unit" (VMMU) for AI Agents.
Tagline: "PGlite for Agent Memory."
Core Value: Eliminates agent "Context Dementia" by autonomously paging memories in and out of the context window based on salience and utility.

1. The Problem: Context Dementia

   Modern LLMs have finite context windows. When an agent exceeds this limit, it loses older context, leading to hallucinations, broken logic, and lost instructions. Current RAG (Retrieval-Augmented Generation) solutions are too slow for high-frequency agent loops and fail to maintain graph-like causal relationships.

2. The Solution: The SULCUS vMMU

   SULCUS provides a low-latency, thermodynamic memory management unit. 
   - Heat: Knowledge graph nodes gain "heat" when paged into a prompt.
   - Decay: Memory "cools down" over time if unused.
   - Paging: The vMMU automatically pages the "hottest" nodes into the agent's prompt, ensuring the context window is always filled with the most salient data.

3. Key Differentiators

   - Zero-Copy Hot Path: Uses `rkyv` and `mmap` to share memory between the core and the agent with zero deserialization cost.
   - Distributed Consensus: HLC-CRDTs allow multiple agents to sync to a shared "Golden Index" without a central coordinator.
   - Local-First: Designed to run inside the agent's process or as a sidecar (via MCP).

4. Technology Stack

   Core Engine: Rust (For safety, speed, and WASM compatibility).
   Local Storage: PGlite / Embedded Postgres (High-performance vector and FTS search).
   Cloud Data: PostgreSQL + pgvector (High-concurrency multi-tenant syncing).
   Frontend: React (For the "Team Intelligence" Dashboard).

5. Roadmap & Delivered Features

   Completed (Q1 2026):
   - `sulcus-local` launched and validated with OpenClaw community.
   - Invitation System: Team workspace invitations with RBAC and Collective Brain validation.
   - Usage & Visualization API: Observability endpoints for token usage metrics, memory heatmaps, and latency telemetry.
   - OIDC / SSO Scaffold: Native OpenID Connect / SSO integration (Azure AD, Okta) with auto-sync worker.
   - SaaS Edge Support: Low-latency edge graph sync; Prune Surgeon MCP tool for automated graph hygiene.

   Q2 2026: Release MCP Integrations for VS Code, Cursor, and Claude Desktop.

   Q3 2026: Launch SULCUS Cloud (SaaS). Enable "Sync" feature for paying teams.

6. The Moat

   SULCUS doesn't just store data; it manages the *lifecycle* of agent context. Our moat is the thermodynamic decay engine and the zero-copy shared index. We are the "Operating System for Memory," while others are just filing cabinets.

7. License

| Component | License |
|:---|:---|
| `sulcus-core`, `sulcus-local`, `sulcus-wasm` | Proprietary — © Digital Forge Studios |
| `sulcus-server` (Cloud / Enterprise) | Commercial License (contact hello@dforge.ca) |

The SDK and integration layer (MIT) drives adoption; the proprietary engine and coordination layer is the revenue engine.

---
*Created: 2026-02-15*
*Updated: 2026-03-04*
