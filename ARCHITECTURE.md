# SULCUS Architecture

## 1. Workspace Structure

The project is a Cargo Workspace containing four primary Rust crates and several TypeScript packages:

```text
SULCUS/
├── Cargo.toml              # Workspace definition
├── crates/
│   ├── sulcus-core/        # Shared Business Logic (The Brain)
│   │   # Responsibility: Defines HLC-CRDTs, Node/Edge models, and ACT-R thermodynamics.
│   │
│   ├── sulcus-local/       # Open Source CLI (The Sidecar)
│   │   # Responsibility: MCP Server (Stdio), Local Embeddings (FastEmbed), PGlite adapter.
│   │
│   ├── sulcus-server/      # Enterprise API (The Platform)
│   │   # Responsibility: Multi-tenant Sync, OIDC/SSO, Stripe Billing, Telemetry.
│   │
│   └── sulcus-wasm/        # Browser Distribution
│       # Responsibility: compilation of core logic for Chrome Extension/Web use.
├── packages/
│   ├── sulcus-web/         # Next.js 14 Dashboard & Marketing (https://sulcus.ca)
│   ├── sulcus-extension/   # Chrome Extension for Claude.ai / ChatGPT
│   └── openclaw-sulcus/    # TypeScript Plugin for OpenClaw
```

## 2. The Core Brain (`crates/sulcus-core`)

This library defines the physics of memory using a **Thermodynamic Graph**.

### The ACT-R Decay Model
Memory nodes follow a biological decay curve derived from the ACT-R cognitive architecture:
$$H(t) = H_0 \cdot e^{-\lambda \cdot \Delta t / S}$$
- $H(t)$: Current Heat (Activation).
- $S$: Stability. Successful retrievals ("ignitions") multiply $S$ by 1.5x, simulating spaced repetition.
- $\lambda$: Decay constant (default 0.85).

### Zero-Copy Shared Index
To achieve sub-50ms context builds, `sulcus-core` uses `rkyv` for zero-copy serialization. The `active_index` is stored in a memory-mapped file (`mmap`), allowing LLM runtimes to read the most important memories with near-zero CPU overhead.

## 3. Distributed Consistency (HLC-CRDT)

SULCUS ensures causal consistency across distributed agent fleets using **Hybrid Logical Clocks (HLC)**.
- **LWW-Element-Graph:** All mutations (Add/Update/Delete) are idempotent patches.
- **Anti-Entropy:** Agents push/pull Write-Ahead Log (WAL) segments to the `sulcus-server`.
- **Golden Index:** The server maintains the globally consistent "Truth" for a tenant, resolving conflicts via HLC timestamps.

## 4. Production Infrastructure

- **Domain:** `https://sulcus.ca` (Secured via Let's Encrypt ECDSA).
- **Backend:** Axum (Rust) running on Azure DS2 v2.
- **Frontend:** Next.js 14 (Dockerized) on Port 80/443 via Nginx reverse proxy.
- **Database:** PostgreSQL 15 + `pgvector`.
- **Identity:** OIDC / JWKS verification for enterprise "Join" handshakes.

## 5. Security & Compliance (SOC2 Ready)

- **Tenant Isolation:** Cryptographically derived `tenant_id` from SHA256 hashed API keys.
- **HMAC Validation:** Stripe webhooks are verified via constant-time HMAC-SHA256 checks.
- **SSRF Protection:** OIDC issuers are strictly validated against a database allow-list before JWKS fetching.
- **Audit Logging:** Every sync operation is metered and tracked for enterprise compliance.

---
*Last Updated: 2026-03-05*
