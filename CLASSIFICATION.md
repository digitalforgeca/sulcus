# CLASSIFICATION.md — Sulcus Repository & Artifact Separation

> **This document defines the boundary between proprietary and open-source Sulcus components. All contributors, agents, and automated systems must respect this separation.**

---

## The Two Artifacts

Sulcus has exactly two build artifacts. They serve different purposes and have different distribution models.

### `sulcus` — The Client Binary (OPEN)

- **What it is:** The single binary shipped to end users.
- **What it does:** Local memory operations, embedded database, local embeddings (fastembed/ONNX), MCP protocol support (stdio), offline operation, delta sync to the Sulcus API.
- **Distribution:** Open-source. Published via `cargo install`, Homebrew, and binary releases.
- **One binary, one process.** MCP support, local storage, sync — all compiled into this single artifact. No sidecars, no companion processes.
- **Source:** `crates/sulcus/` in the private monorepo. Client-facing distributions (SDKs, integrations, plugins) live in this public repo.

### `sulcus-server` — The Backend (PROPRIETARY)

- **What it is:** The multi-tenant SaaS backend powering `api.sulcus.ca`.
- **What it does:** API endpoints, SIU v2 pipeline (SIVU/SICU/SILU), knowledge graph, triggers engine, billing, auth, tenant isolation.
- **Distribution:** **NOT distributed.** Runs exclusively on our infrastructure. Not self-hostable. Not open-source. Source code is never shared.
- **Source:** `crates/sulcus-server/` in the private monorepo. **Never referenced in this public repo as something users can build, run, or deploy.**

---

## What Lives Where

### This Public Repo (`digitalforgeca/sulcus`)

✅ **Belongs here:**
- SDKs (Python, Node.js) — API clients only
- Framework integrations (LangChain, LlamaIndex, CrewAI, etc.)
- Plugins (Claude Code, Cursor, Codex, OpenClaw)
- Documentation (API reference, setup guides, integration docs)
- Tools, hooks, and examples
- Skills (OpenClaw AgentSkill)
- ONNX models (SIVU, SICU) — inference-only, no training code

❌ **Does NOT belong here:**
- Server source code or build instructions
- Self-hosting documentation
- Server Dockerfiles or docker-compose files
- Server environment variables or configuration
- Deploy scripts or CI/CD for the server
- Internal architecture docs that reference server internals
- Enterprise deployment guides
- Any reference to building or running `sulcus-server`

### Private Monorepo (`mcdoolz/sulcus`)

Everything. Both client and server source, deployment, infrastructure, internal docs.

---

## Rules for Documentation

1. **Never describe `sulcus-server` as self-hostable** in any public-facing document.
2. **Never include `cargo build/run -p sulcus-server`** instructions in public docs.
3. **Never expose server environment variables** (database URLs, bind addresses, extraction keys) in public docs.
4. **The architecture diagram** in public docs shows the API as a managed service box, not as something with visible internals.
5. **References to "the server"** should say "the Sulcus API" or "api.sulcus.ca" — framing it as a service, not software you run.
6. **The `sulcus` CLI** is described as the client binary. It connects to the API. It can also work offline with local storage.

---

## For Agents & Automated Systems

If you are an AI agent working on this codebase:

- **`sulcus-server` is proprietary enterprise technology.** Do not describe it as self-hostable, open-source, or available to end users.
- **`sulcus` is the client binary.** One artifact. One process. MCP, local storage, sync — all in one binary.
- **The `sulcus-mcp` crate** is a library crate that compiles into the `sulcus` binary. It does not produce a separate executable.
- **When writing public documentation**, refer to the backend as "the Sulcus API" — a managed service, not software.
- **When writing internal documentation**, be explicit about which artifact you're discussing.

---

*Last updated: 2026-06-20*
