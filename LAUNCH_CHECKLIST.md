# SULCUS Final Launch Checklist

| Task | Pass 1 (CTO) | Pass 2 (CEO) | Status |
| :--- | :---: | :---: | :--- |
| **1. Security & Secrets** | | | |
| [x] Scan codebase for hardcoded API keys/secrets | [x] | [ ] | DONE |
| [x] Verify .gitignore covers all .env and target/ | [x] | [ ] | DONE |
| [x] Ensure Azure VM is using non-default passwords (SSH Only) | [x] | [ ] | DONE |
| **2. Core Engine (Rust)** | | | |
| [x] cargo test --all passes locally | [x] | [ ] | DONE |
| [x] cargo clippy is clean (no warnings) | [x] | [ ] | DONE |
| [x] CRDT monotonicity fix verified in sync test | [x] | [ ] | DONE |
| **3. Distribution (WASM/NPM)** | | | |
| [x] build-wasm.sh produces valid JS/WASM bundle (CI verified) | [x] | [ ] | DONE |
| [x] @sulcus/mem package.json has correct version | [x] | [ ] | DONE |
| [x] Browser extension src finalized (manifest, popup, background) | [x] | [ ] | DONE |
| **4. Infrastructure (SaaS)** | | | |
| [x] Azure server /api/v1/metrics reachable | [x] | [ ] | DONE |
| [x] Multi-tenancy isolation tests passing | [x] | [ ] | DONE |
| [x] Usage tracking incrementing in tenant_usage | [x] | [ ] | DONE |
| **5. Marketing & Social** | | | |
| [x] Marketing site Next.js build verified | [x] | [ ] | DONE |
| [x] SOCIAL_PLAN.md schedule approved | [x] | [ ] | DONE |
| [x] DEMO_STORYBOARD.md prepared for asset capture | [x] | [ ] | DONE |

---
*Final Pass 1 Complete: 2026-03-04*
