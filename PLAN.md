# PLAN.md — SULCUS roadmap & milestone plan

## Status: ✅ SYSTEM PRODUCTION READY

## Completed Milestones

1. **Core library (`sulcus-core`)** — DONE
   - Node/Edge models, HLC-CRDTs, ACT-R thermodynamics.

2. **Local Sidecar (`sulcus`)** — DONE
   - PGlite/Postgres adapter, Stdio MCP Server, FastEmbed ONNX integration.

3. **Enterprise Platform (`sulcus-server`)** — DONE
   - Multi-tenant sync, JWKS/OIDC Identity, Stripe HMAC validation, Usage Telemetry.
   - **Keycloak Admin REST API Sync**: Automated user role provisioning from Stripe events.

4. **WASM Distribution** — DONE
   - Chrome Extension for Claude.ai, zero-friction local vMMU.

5. **Production Infrastructure** — DONE
   - Azure VM deployment, Nginx Reverse Proxy, HTTPS (Let's Encrypt), `sulcus.dforge.ca`.

6. **Marketing & ROI** — DONE
   - Next.js 14 Dashboard, 90% Cost Reduction ROI report, Performance Benchmarks.

## Current Focus: Embedded PG Hardening & Cloud Validation

### Recently Completed (2026-03-08)
- [x] **pg-embed 0.7.1 → 1.0.0**: Embedded PG now uses PostgreSQL 17.8.0 (commit `62e70f4`).
- [x] **OpenClaw plugin integration**: `memory-sulcus` plugin working end-to-end via pglite JS backend.
- [x] **`OPENCLAW_SETUP.md`**: Comprehensive config reference for all deployment gotchas.
- [x] **Azure Foundry routing**: All models through Azure Foundry (no direct Anthropic billing).
- [x] **`active_limit` config wiring**: INI → `serve()` → `start_background()` → tick handler.
- [x] **Dollar-quote-aware SQL splitter**: Replaces naive `split(';')` for migration scripts.
- [x] **Consolidation Loop Throttling**: Cooldown and locking for LLM synthesis.
- [x] **Edge Traversal Optimization**: Added `idx_edges_target_id`.

### In Progress
- [x] **Fix sqlx prepared statement caching bug**: `statement_cache_capacity(0)` applied to all connection pools (main and test) to support PGlite JS path.
- [x] **Fix parallel test port conflicts**: Isolated OpenClaw node/python example ports.
- [ ] **Validate Sulcus cloud sync**: Cross-agent memory mesh between Icarus ↔ Daedalus instances.
- [x] **MCP tick handler active_limit**: Now reads from config/env instead of hardcoded 20.
- [ ] **Push all commits to remote**.

### Backlog: OSS Extraction
- [ ] **Extract `sulcus-oss` Repository**: Move `sulcus-core` and `sulcus` to a clean public repo.
- [ ] **Publish Crates**: Release `sulcus-core` and `sulcus` to `crates.io`.
- [ ] **NPM Release**: Publish `@sulcus/mem` WASM package.

## Future Roadmap

- [ ] **V2 Federated Architecture**: 
  - **Cross-Modal Embeddings**: Support for image/multimodal memory nodes using ONNX Runtime Web.
  - **P2P Namespace Sharing**: Direct WAL segment exchange between SULCUS instances for collaborative agent fleets.
- [ ] **Adaptive Backoff**: Adapt thermodynamic tick frequency based on graph size.
- [ ] **PgBouncer Integration**: Support thousands of concurrent agent connections.
- [ ] **Mobile App**: Native iOS/Android sidecar for mobile agent memory.
- [ ] **Multi-Region Sync**: Geographically distributed Golden Indices for <100ms global latency.

---
*Last Updated: 2026-03-07*
