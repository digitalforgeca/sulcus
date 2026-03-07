# PLAN.md — SULCUS roadmap & milestone plan

## Status: ✅ SYSTEM PRODUCTION READY

## Completed Milestones

1. **Core library (`sulcus-core`)** — DONE
   - Node/Edge models, HLC-CRDTs, ACT-R thermodynamics.

2. **Local Sidecar (`sulcus-local`)** — DONE
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

## Current Focus: OSS Extraction

- [ ] **Extract `sulcus-oss` Repository**: Move `sulcus-core` and `sulcus-local` to a clean public repo.
- [ ] **Publish Crates**: Release `sulcus-core` and `sulcus-local` to `crates.io`.
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
