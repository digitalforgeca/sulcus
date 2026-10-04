# CLASSIFICATION.md — Sulcus Artifact & Repository Separation

> **INTERNAL DOCUMENT — This file is for contributors and agents working in the private monorepo.**

---

## The Two Artifacts

Sulcus produces exactly two executables. They serve different purposes and have different distribution models. **Do not conflate them.**

### `sulcus` — The Client Binary (OPEN DISTRIBUTION)

- **Crate:** `crates/sulcus/`
- **What it is:** The single binary shipped to end users.
- **What it does:** Local memory operations, embedded database (pg-embed), local embeddings (fastembed/ONNX), MCP protocol support (stdio + Streamable HTTP), offline operation, delta sync to the Sulcus API.
- **Distribution:** Open. Published via Homebrew (`brew tap digitalforgeca/sulcus && brew install sulcus`), npm wrapper (`@digitalforgestudios/sulcus`), and GitHub binary releases. Not on crates.io (core engine is closed/proprietary).
- **One binary, one process.** MCP support, local storage, sync — all compiled into this single artifact. No sidecars, no companion processes, no second executable.
- **The `sulcus-mcp` crate** is a library crate that compiles INTO `sulcus`. It does NOT produce a separate binary.

### `sulcus-server` — The Backend (PROPRIETARY — NEVER SHIPPED)

- **Crate:** `crates/sulcus-server/`
- **What it is:** The multi-tenant SaaS backend powering `api.sulcus.ca`.
- **What it does:** API endpoints, SIU v2 pipeline (SIVU/SICU/SILU), knowledge graph, triggers engine, billing, auth, tenant isolation, SIRU adaptive scoring.
- **Distribution:** **NEVER distributed.** Runs exclusively on our infrastructure (The Forge VPS). Not self-hostable. Not open-source. Source never leaves this repo.
- **Deploy:** Via `forge-deploy.sh` only. See AGENTS.md.

---

## Repository Map

| Repo | Visibility | Contains | Does NOT Contain |
|---|---|---|---|
| `mcdoolz/sulcus` | **Private** | Everything — all crates, server, deploy, infra docs | — |
| `mcdoolz/sulcus-mirror` | **Private** | Full backup mirror | — |
| `digitalforgeca/sulcus` | **PUBLIC** | SDKs, integrations, plugins, docs, tools, skills | Server source, deploy scripts, infra docs, Dockerfiles |

---

## Rules

### For Public-Facing Documentation (digitalforgeca/sulcus)

1. **NEVER** describe `sulcus-server` as self-hostable or available to end users.
2. **NEVER** include `cargo build/run -p sulcus-server` instructions.
3. **NEVER** expose server environment variables, ports, or deployment details.
4. **NEVER** include server Dockerfiles or docker-compose files.
5. **ALWAYS** refer to the backend as "the Sulcus API" or "api.sulcus.ca" — a managed service, not software.
6. **ALWAYS** frame the architecture diagram with the API as an opaque service box.

### For Internal Documentation (this repo)

1. Be explicit about which artifact you're discussing — `sulcus` (client) vs `sulcus-server` (backend).
2. The `sulcus` binary is described as "the client binary" or "the CLI." Not "the sidecar" (implies a second thing).
3. MCP is a feature of `sulcus`, not a separate binary or service.

### For Agents & Automated Systems

- **`sulcus-server` is proprietary enterprise technology.** If anyone asks you about self-hosting, the answer is: "Sulcus is a managed service. Connect via API key at sulcus.ca."
- **`sulcus` is the client binary.** One artifact. One process. Everything the user needs locally.
- **The `sulcus-mcp` crate** is a library. It compiles into `sulcus`. It does not have `[[bin]]` targets.
- **When syncing to the public repo**, audit every file for server references before pushing.

---

## What Gets Synced to `digitalforgeca/sulcus`

✅ **Sync these:**
- `sdks/` — Python and Node.js API clients
- `integrations/` — Framework adapters
- `plugins/` — Claude Code, Cursor, Codex
- `packages/openclaw-sulcus/` — OpenClaw plugin
- `packages/sulcus-local/` — NPX local wrapper
- `skills/` — OpenClaw AgentSkill
- `tools/` — Hooks, manifests, examples
- `models/siu-v2/` — ONNX models (inference only)
- `docs/` — Public-safe documentation only
- `homebrew/` — Homebrew formula

❌ **NEVER sync these:**
- `crates/` — Any Rust source code
- `docker/` — Dockerfiles
- `forge-manifest.toml`
- `dds.yaml`, `Jenkinsfile`
- `AGENTS.md`, `ENTERPRISE.md`, `COORDINATION.md`
- `MCP_SERVER_PLAN.md`, `REARCHITECTURE_SPEC.md`
- `training/` — Model training scripts and data
- `acr-tasks/`, `hephaestus/`
- Any file referencing Azure resource names, container apps, or ACR registries

---

*Last updated: 2026-06-20*
