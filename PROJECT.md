# PROJECT: Sulcus

## Overview
SULCUS is a production-grade, thermodynamic vMMU (virtual Memory Management Unit) evolving into a Federated Knowledge Network. It provides agent-native persistent memory with autonomous thermodynamic data structures, federated fleet sync, and zero-copy performance.

## Repository
- Local: `/Users/dv00003-00/dev/sulcus`
- Remote: `git@github.com:mcdoolz/sulcus.git`

## Orchestration (Important)
**This is a shared project between two peer orchestrators:**
- **Icarus** — Sulcus-Continuous-Improvement cron; owns performance, sustainability, integrity, stability cycles.
- **Daedalus** — Handles implementation missions delegated by Dooley; owns feature evolution and OSS extraction.

**Both are orchestrators, not delegators. Dooley assigns work. Neither assigns to the other.**

Before starting any mission, check this file and recent git log to avoid stepping on each other:
```bash
cd /Users/dv00003-00/dev/sulcus && git log --oneline -10
```

## Tech Stack
- **Core Library (`sulcus-core`):** Rust — Node/Edge models, HLC-CRDTs, ACT-R thermodynamics
- **Local Sidecar (`sulcus-local`):** Rust — PGlite/Postgres adapter, Stdio MCP Server, FastEmbed ONNX
- **Enterprise Platform (`sulcus-server`):** Rust/Axum — Multi-tenant sync, JWKS/OIDC, Stripe, Telemetry
- **WASM Distribution:** Chrome Extension for Claude.ai, zero-friction local vMMU
- **Dashboard:** Next.js 14 — Marketing + ROI + performance benchmarks
- **Infrastructure:** Azure VM, Nginx, HTTPS (Let's Encrypt), `sulcus.dforge.ca`

## Current Status
| Area | Status |
|------|--------|
| sulcus-core | ✅ Production ready |
| sulcus-local | ✅ Production ready |
| sulcus-server | ✅ Production ready |
| WASM distribution | ✅ Production ready |
| Infrastructure | ✅ Live at sulcus.dforge.ca |
| Dashboard | ✅ Complete |
| OSS Extraction | 🔴 In progress |
| V2 Federated Architecture | 🔴 In progress |

## Active Work (Current Focus)

### OSS Extraction
- [ ] Extract `sulcus-oss` repository: move `sulcus-core` and `sulcus-local` to a clean public repo
- [ ] Publish `sulcus-core` and `sulcus-local` crates to `crates.io`
- [ ] Publish `@sulcus/mem` WASM package to npm

### V2 Federated Architecture
- [ ] **Cross-Modal Embeddings:** Image/multimodal memory nodes via ONNX Runtime Web
- [ ] **P2P Namespace Sharing:** Direct WAL segment exchange between SULCUS instances
- [x] **HNSW Indexing:** Fast similarity search with deterministic context builds (Completed: deterministic sorting by created_at for Prompt Caching stability).
- [ ] **Adaptive Backoff:** Thermodynamic tick frequency adapted to graph size
- [ ] **PgBouncer Integration:** Thousands of concurrent agent connections
- [ ] **Localized Differential Sync:** Cross-instance delta sync for federated fleet
- [x] **Memory Consolidation Loop:** Background synthesis pass — queries high-heat node clusters (not full-scan; thermodynamics does the prioritization), runs synthesis over hot clusters only, writes insight edges back with their own heat score; connected nodes get heat boost, isolated nodes decay faster. Scoped consolidation, not the Python/SQLite full-table-scan approach. Now uses semantic clustering via embeddings (v2).
- [ ] **Structured Multimodal Pre-processing:** Before embedding images via CLIP, run a Gemini extraction pass to pull entities/topics/importance from the image; embed the *structured output* rather than raw visual features — higher semantic density in the HNSW index.
- [ ] **KV Compaction via Attention Matching:** Reference arXiv:2602.16284 — during consolidation loop, compact the working context of a hot-cluster synthesis pass using attention matching rather than lossy summarization. Constructs compact keys/values to reproduce attention outputs at up to 50x compaction in seconds. Apply before writing insight edges to keep context footprint bounded without degrading synthesis quality.

### Ongoing Quality (Icarus-owned)
- Performance: HNSW indexing, prompt caching, zero-copy paths (mmap/rkyv)
- Sustainability: code consolidation, footprint reduction, abstraction tightening
- Integrity: 100% clean builds, TDD coverage, hourly benchmarks
- Stability: engine + dashboard + services error-free

## Architectural Rules
- All Rust code uses `anyhow::Result` — no `.unwrap()` in non-test code
- Every mission ends with `cargo check` + `cargo build` passing
- New functionality is modular — separate crates or modules as appropriate
- Dashboard changes follow Next.js 14 conventions
- Minimal diff — only touch files in scope for the current mission

## Validation Gates
```bash
# Rust validation
cd /Users/dv00003-00/dev/sulcus && cargo check --workspace
cd /Users/dv00003-00/dev/sulcus && cargo build --workspace

# Dashboard validation
cd /Users/dv00003-00/dev/sulcus/dashboard && npm run build 2>/dev/null || pnpm build
```

## Coordination Protocol
When either orchestrator completes a mission:
1. Commit with a clear message: `feat(scope): description`
2. Push to remote: `git push origin main`
3. Append to `/Users/dv00003-00/.openclaw/workspace/output/status.txt`:
   `YYYY-MM-DD HH:MM | project:sulcus | orchestrator:<icarus|daedalus> | build:<change> | next:<action>`

The hourly `Icarus-Daedalus-Sync` cron monitors git log and flags any overlap.
