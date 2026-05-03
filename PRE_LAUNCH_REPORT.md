--- SULCUS PRE-LAUNCH INVENTORY ---
## 1. System Components (The Infrastructure)
- **Enterprise Server (Azure):** https://api.sulcus.ca (Protected by Bearer Auth)
- **Rust Core:** crates/sulcus-core (HLC-CRDT, Thermodynamic Graph)
- **Local Sidecar:** crates/sulcus (Embedded Postgres, MCP Stdio Server)
- **WASM Module:** crates/sulcus-wasm -> packages/sulcus-mem (Browser-ready vMMU)
- **Marketing Hub:** packages/sulcus-web (Next.js 14, Tailwind)
- **Browser Extension:** packages/sulcus-extension (Claude.ai/ChatGPT Injector)
## 2. Key Documentation (Human Review Files)
- **Master Strategy:** [COMMERCIAL_STRATEGY.md](./COMMERCIAL_STRATEGY.md)
- **Technical Specs:** [ARCHITECTURE.md](./ARCHITECTURE.md), [ENTERPRISE.md](./ENTERPRISE.md)
- **Social Roadmap:** [marketing/SOCIAL_PLAN.md](./marketing/SOCIAL_PLAN.md)
- **Roadmap/Progress:** [PLAN.md](./PLAN.md), [PROGRESS.md](./PROGRESS.md)
## 3. Deployment & Build Scripts
- **Azure Deploy:** ./update_azure.sh
- **WASM Packager:** ./build-wasm.sh
- **Benchmarking:** ./benchmark_server.sh
- **CI/CD:** .github/workflows/ci.yml
## 4. Human Verification Checklist (Final Check)
1. [ ] **Secret Management:** Ensure NO production API keys are in git history (we used 'test_token' for staging).
2. [ ] **Domain Setup:** Connect 'sulcus.io' to the packages/sulcus-web deployment.
3. [ ] **Social Assets:** Prepare high-res screenshots of the 'Julian/Aethelgard' demo for the Day 3 thread.
4. [ ] **Stripe/Billing:** Connect the SaaS usage hooks to a payment provider if immediate monetisation is required.
