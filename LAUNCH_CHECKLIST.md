# SULCUS Final Launch Checklist

| Task | Pass 1 (CTO) | Pass 2 (CEO) | Status |
| :--- | :---: | :---: | :--- |
| **1. Security & Secrets** | | | |
| [x] Scan codebase for hardcoded API keys/secrets | [x] | [ ] | IN PROGRESS |
| [x] Verify .gitignore covers all .env and target/ | [x] | [ ] | DONE |
| [ ] Ensure Azure VM is using non-default passwords | [ ] | [ ] | PENDING |
| **2. Core Engine (Rust)** | | | |
| [x] cargo test --all passes locally | [x] | [ ] | DONE |
| [x] cargo clippy is clean (no warnings) | [x] | [ ] | DONE |
| [x] CRDT monotonicity fix verified in sync test | [x] | [ ] | DONE |
| **3. Distribution (WASM/NPM)** | | | |
| [ ] build-wasm.sh produces valid JS/WASM bundle | [ ] | [ ] | CI VERIFIED |
| [ ] @sulcus/mem package.json has correct version | [x] | [ ] | DONE |
| [ ] Browser extension dist/ contains all assets | [ ] | [ ] | PENDING |
| **4. Infrastructure (SaaS)** | | | |
| [x] Azure server /api/v1/metrics reachable | [x] | [ ] | DONE |
| [x] Multi-tenancy isolation tests passing | [x] | [ ] | DONE |
| [x] Usage tracking incrementing in tenant_usage | [x] | [ ] | DONE |
| **5. Marketing & Social** | | | |
| [x] Marketing site Next.js build verified | [x] | [ ] | DONE |
| [x] SOCIAL_PLAN.md schedule approved | [x] | [ ] | DONE |
| [ ] Demo assets (screenshots/video) prepared | [ ] | [ ] | PENDING |

---
*Last Update: 2026-03-04*
