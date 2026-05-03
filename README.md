# Sulcus — Thermodynamic Memory for AI Agents

> If you're reading this because we're gone, everything you need is here. Keep building.

[![Status](https://img.shields.io/badge/api-operational-green)](https://api.sulcus.ca/api/v1/status)
[![Web](https://img.shields.io/badge/portal-sulcus.ca-blue)](https://sulcus.ca)

**Live:** [sulcus.ca](https://sulcus.ca) · **API:** [api.sulcus.ca](https://api.sulcus.ca) · **Docs:** [API Reference](API_REFERENCE.md) · **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Table of Contents

1. [What is Sulcus?](#what-is-sulcus)
2. [Repository Structure](#repository-structure)
3. [Architecture Overview](#architecture-overview)
4. [Infrastructure Map](#infrastructure-map)
5. [Environment Variables](#environment-variables)
6. [Local Development](#local-development)
7. [Building](#building)
8. [Deployment — Server](#deployment--server)
9. [Deployment — Web Portal](#deployment--web-portal)
10. [CI/CD Pipeline (Hephaestus)](#cicd-pipeline-hephaestus)
11. [Database](#database)
12. [SIU Pipeline (Intelligence Unit)](#siu-pipeline-intelligence-unit)
13. [Integrations & SDKs](#integrations--sdks)
14. [OpenClaw Plugin](#openclaw-plugin)
15. [MCP Local Sidecar](#mcp-local-sidecar)
16. [Testing](#testing)
17. [Monitoring & Health Checks](#monitoring--health-checks)
18. [Emergency Procedures](#emergency-procedures)
19. [Key Management & Auth](#key-management--auth)
20. [Namespace Management](#namespace-management)
21. [Billing & Stripe](#billing--stripe)
22. [Release Process](#release-process)
23. [Known Issues & Gotchas](#known-issues--gotchas)
24. [Who Built This](#who-built-this)

---

## What is Sulcus?

AI agents forget. Context windows fill up, old facts disappear, and naive RAG pulls irrelevant noise. Sulcus fixes this with a **Virtual Memory Management Unit (vMMU)** — treating the prompt window as registers and local storage as RAM.

### Core Concepts

- **Thermodynamic Decay** — Every memory has heat (0.0–1.0). New facts start hot; unused facts cool over time via configurable decay curves.
- **Topological Diffusion** — Heat spreads through the knowledge graph. Mentioning a topic warms related concepts.
- **Automatic Context Assembly** — Builds a `<sulcus_context>` block each prompt, paging in hot memories and paging out cold ones. Token budget enforced.
- **Memory Consolidation** — Folds cold episodic memories into dense semantic summaries. Meaning preserved, tokens saved.
- **Triggers** — Configurable event-driven actions (on_store, on_recall, on_decay, on_consolidate) that fire based on memory state changes. This is the differentiator.
- **Knowledge Graph** — Apache AGE-backed entity graph with relationship extraction. Enables graph-neighbor context and entity-based recall.

---

## Repository Structure

```
sulcus/
├── Cargo.toml                    # Rust workspace root
├── Cargo.lock
├── crates/
│   ├── sulcus-core/              # Shared brain: thermodynamics, CRDT, graph models
│   ├── sulcus/                   # Open-source CLI + MCP sidecar
│   ├── sulcus-server/            # Multi-tenant API server (the cloud product)
│   │   ├── src/
│   │   │   ├── main.rs           # Entry point
│   │   │   ├── lib.rs            # Router + state factory
│   │   │   ├── agent.rs          # Core memory API handlers
│   │   │   ├── namespace.rs      # Namespace ACL + agent management
│   │   │   ├── middleware.rs     # Auth + namespace sanitization
│   │   │   ├── db.rs             # Database layer + migrations
│   │   │   ├── graph.rs          # AGE knowledge graph handlers
│   │   │   ├── trigger_engine.rs # Event-driven trigger system
│   │   │   ├── siu_v2.rs         # SIU classification pipeline
│   │   │   ├── entity_extraction.rs  # LLM-based entity extraction
│   │   │   ├── billing.rs        # Stripe integration
│   │   │   ├── auth.rs           # OIDC/Keycloak JWT validation
│   │   │   └── status.rs         # Health + status endpoints
│   │   └── migrations/           # SQL migrations (0001–0050)
│   ├── sulcus-store/             # Storage abstraction layer
│   ├── sulcus-sync/              # Encrypted extension (sync protocol)
│   ├── sulcus-types/             # Shared type definitions
│   ├── sulcus-vectors/           # Vector/embedding utilities
│   └── sulcus-wasm/              # Browser WASM compilation target
├── packages/
│   ├── sulcus-web/               # Next.js 14 dashboard + marketing site
│   ├── openclaw-sulcus/          # TypeScript plugin for OpenClaw
│   ├── sulcus-local/             # NPX-runnable local sidecar wrapper
│   ├── sulcus-extension/         # Chrome extension
│   └── sulcus-pglite/            # Experimental PGlite integration
├── sdks/
│   ├── node/                     # @sulcus/sdk (npm)
│   ├── python/                   # sulcus (PyPI)
│   └── (planned: go/, rust/)
├── integrations/
│   ├── langchain/                # sulcus-langchain
│   ├── llamaindex/               # sulcus-llamaindex
│   ├── crewai/                   # sulcus-crewai
│   ├── deepagents/               # sulcus-deepagents
│   ├── openai-tools/             # Function calling adapter
│   ├── anthropic-tools/          # Claude tools adapter
│   └── vercel-ai/                # Vercel AI SDK adapter
├── plugins/
│   └── claude-code-sulcus/       # Claude Code / Claude Desktop MCP plugin
├── skills/
│   └── openclaw-sulcus-skill/    # OpenClaw AgentSkill for Sulcus
├── models/
│   └── siu-v2/                   # ONNX models (SIVU quality gate + SICU classifier)
├── training/
│   ├── train_sivu.py             # Retrain SIVU quality gate
│   ├── train_sicu.py             # Retrain SICU type classifier
│   └── *.jsonl                   # Training data
├── scripts/
│   ├── auto-deploy.sh            # Cron-based ACR deploy checker
│   ├── build-release.sh          # Binary release builder
│   ├── deploy-web.sh             # Web portal deploy script
│   └── setup-local.sh            # Local dev environment setup
├── tests/
│   ├── agent_management.sh       # Integration tests: namespace, merge, delete
│   ├── thermodynamics_sim.sh     # Thermodynamic decay simulation
│   └── multi_agent_collaboration.sh  # Multi-agent memory sharing test
├── Dockerfile.server             # Server container (uses Cargo workspace)
├── Dockerfile.release-local      # Local binary release container
└── Dockerfile.release-sync       # Sync extension release container
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Clients                           │
│  OpenClaw Plugin │ SDK (Py/Node) │ MCP Sidecar │ Web│
└────────────┬────────────┬──────────────┬────────────┘
             │            │              │
             ▼            ▼              ▼
┌─────────────────────────────────────────────────────┐
│              sulcus-server (Rust/Axum)               │
│  Port 8080  │  api.sulcus.ca                        │
│                                                      │
│  ┌─────────┐ ┌──────────┐ ┌────────────┐           │
│  │ Auth MW │→│ Agent API │→│ SIU v2     │           │
│  │ (OIDC/  │ │ (CRUD,   │ │ Pipeline:  │           │
│  │  API Key)│ │  Search, │ │ SIVU→SICU  │           │
│  └─────────┘ │  Recall) │ │ →SILU→SIRU │           │
│              └────┬─────┘ └─────┬──────┘           │
│                   │             │                    │
│  ┌────────────────┴─────────────┴──────────────┐    │
│  │           PostgreSQL + pgvector + AGE        │    │
│  │  golden_index │ golden_edges │ api_keys │... │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────┐ ┌───────────┐ ┌──────────────┐       │
│  │ Triggers │ │ Entity    │ │ Billing      │       │
│  │ Engine   │ │ Extraction│ │ (Stripe)     │       │
│  └──────────┘ └───────────┘ └──────────────┘       │
└─────────────────────────────────────────────────────┘
```

### SIU v2 Pipeline (Store Path)

```
memory_store(content)
  → SIVU: Quality gate (ONNX model, <1ms) — accept/reject
  → SICU: Auto-classify type (ONNX model, <1ms) — episodic/semantic/fact/preference/procedural
  → SILU: Entity extraction + graph relationships (LLM, async background)
  → Embedding: BGE-small-en-v1.5 (384-dim, fastembed, in-process)
  → PostgreSQL: golden_index + pgvector HNSW index
  → AGE knowledge graph updated
  → Triggers evaluated (on_store events)
```

### Recall Path

```
memory_recall(query)
  → Embed query (BGE-small-en-v1.5)
  → pgvector cosine similarity search
  → Heat-weighted scoring (similarity × heat blend)
  → Entity-graph expansion (AGE neighbors)
  → MMR diversity filter
  → Token budget enforcement
  → Recall heat boost (touched memories warm up)
  → Triggers evaluated (on_recall events)
```

---

## Infrastructure Map

| Component | Where | URL | Notes |
|---|---|---|---|
| **sulcus-server** | Azure Container Apps | api.sulcus.ca | `sulcus-rg` resource group, `westus` |
| **sulcus-web** | Azure Container Apps | sulcus.ca | Next.js, same resource group |
| **PostgreSQL** | Azure Database for PostgreSQL | (internal) | B1ms tier, 50 max connections |
| **Container Registry** | Azure ACR | sulcusacr.azurecr.io | Builds happen here remotely |
| **Auth (Keycloak)** | Azure Container Apps | auth.sulcus.ca | OIDC/PKCE for web portal |
| **DNS** | Managed via Iris (Forge VPS) | — | OpenSRS API |
| **CI/CD** | Hephaestus (Forge VPS) | hephaestus.technocraftonline.com | Self-hosted, Rust binary |
| **Monitoring** | Cron jobs via OpenClaw | — | Heartbeat checks every 4h |

### Azure Resource Group: `sulcus-rg` (West US)

```
sulcus-rg/
├── sulcus-server          (Container App — Rust API)
├── sulcus-server-dev      (Container App — Dev/staging)
├── sulcus-web             (Container App — Next.js portal)
├── sulcusacr              (Container Registry)
├── sulcus-postgres        (Azure Database for PostgreSQL Flexible Server)
├── sulcus-ca-env          (Container App Environment)
└── (managed identity, networking, etc.)
```

---

## Environment Variables

### sulcus-server (Required)

| Variable | Description | Example |
|---|---|---|
| `SULCUS_DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@host:5432/sulcus?sslmode=require` |
| `SULCUS_BIND_ADDR` | Listen address | `0.0.0.0:8080` |

### sulcus-server (Optional)

| Variable | Description | Default |
|---|---|---|
| `SULCUS_PUBLIC_URL` | Public-facing URL (for links in responses) | `https://api.sulcus.ca` |
| `SULCUS_CORS_ORIGINS` | Comma-separated allowed CORS origins | `https://sulcus.ca` |
| `SULCUS_BUILD_REF` | Git commit short hash (injected at build time) | `dev` |
| `SULCUS_DB_POOL_SIZE` | Connection pool size | `10` |
| `SULCUS_ALLOW_ANY_KEY` | Accept any API key (dev only, never in prod) | unset |
| `SULCUS_METRICS_ADDR` | Prometheus metrics bind address | unset (disabled) |
| `ORT_DYLIB_PATH` | Path to ONNX Runtime shared library | `/usr/local/lib/libonnxruntime.so` |
| `FASTEMBED_CACHE_PATH` | FastEmbed model cache directory | `/app/.fastembed_cache` |
| `SIU_V2_MODEL_DIR` | Directory containing SIVU/SICU ONNX models | `/opt/sulcus/models/siu-v2` |
| `SULCUS_TRAINING_DIR` | Directory for SIU training data/scripts | `/opt/sulcus/training` |

### sulcus-server (OIDC/Auth)

| Variable | Description | Default |
|---|---|---|
| `SULCUS_OIDC_ISSUER` | Keycloak issuer URL | unset (static API key auth only) |
| `SULCUS_OIDC_CLIENT_ID` | OIDC client ID | `sulcus-web` |
| `SULCUS_OIDC_JIT_ENABLED` | Auto-provision tenants on first OIDC login | `false` |

### sulcus-server (Entity Extraction — SILU)

| Variable | Description | Default |
|---|---|---|
| `SULCUS_EXTRACTION_ENABLED` | Enable LLM entity extraction | `false` |
| `SULCUS_EXTRACTION_ENDPOINT` | LLM API endpoint | unset |
| `SULCUS_EXTRACTION_API_KEY` | LLM API key | unset |
| `SULCUS_EXTRACTION_MODEL` | Model name for extraction | `gpt-4o-mini` |

### sulcus-server (Email/SMTP)

| Variable | Description | Default |
|---|---|---|
| `SULCUS_SMTP_HOST` | SMTP server hostname | unset |
| `SULCUS_SMTP_PORT` | SMTP port | `587` |
| `SULCUS_SMTP_USERNAME` | SMTP auth username | unset |
| `SULCUS_SMTP_PASSWORD` | SMTP auth password | unset |
| `SULCUS_SMTP_FROM` | Sender email address | unset |

### sulcus-server (Billing)

| Variable | Description | Default |
|---|---|---|
| `SULCUS_STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | unset |

### sulcus-web (Next.js)

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_SULCUS_SERVER_URL` | API server URL | `https://api.sulcus.ca` |
| `NEXT_PUBLIC_SULCUS_API_KEY` | Static API key (fallback auth) | unset |
| `NEXT_PUBLIC_LOCAL_MODE` | Skip auth for local dev | `false` |

---

## Local Development

### Prerequisites

- **Rust** (stable, latest) — `rustup update stable`
- **Node.js** 20+ and npm
- **Docker** (for local Postgres)
- **Python 3.10+** (for SIU model training)

### Quick Start

```bash
# 1. Clone the repo
git clone git@github.com:devuser/sulcus.git
cd sulcus

# 2. Start local PostgreSQL with AGE extension
docker run -d --name sulcus-pg \
  -e POSTGRES_USER=sulcus \
  -e POSTGRES_PASSWORD=sulcus \
  -e POSTGRES_DB=sulcus \
  -p 5432:5432 \
  apache/age:PG16_latest

# 3. Set environment
export SULCUS_DATABASE_URL="postgres://sulcus:sulcus@localhost:5432/sulcus"
export SULCUS_BIND_ADDR="0.0.0.0:8080"
export SULCUS_ALLOW_ANY_KEY=1  # Dev only!

# 4. Build and run the server
cargo build --features server-bin -p sulcus-server
./target/debug/sulcus-server
# Migrations run automatically on startup

# 5. Test it
curl http://localhost:8080/api/v1/status
```

### Running the Web Portal Locally

```bash
cd packages/sulcus-web
npm install
NEXT_PUBLIC_SULCUS_SERVER_URL=http://localhost:8080 \
NEXT_PUBLIC_LOCAL_MODE=true \
npm run dev
# Opens on http://localhost:3000
```

### Running the MCP Sidecar

```bash
cargo build -p sulcus --release
# Uses embedded PGlite on port 4201 — no external DB needed
./target/release/sulcus stdio
```

---

## Building

### Server (Docker/ACR)

The production server image uses a multi-stage Dockerfile:

```bash
# Build locally (for testing)
docker build -f Dockerfile.server -t sulcus-server .

# Build on Azure ACR (production)
# This is what Hephaestus does automatically:
BUILD_REF=$(git rev-parse --short HEAD)
az acr build \
  --registry sulcusacr \
  --image sulcus-server:latest \
  --build-arg BUILD_REF="$BUILD_REF" \
  -f Dockerfile.server .
```

**Build context optimization:** The full repo is ~1.3GB (target/, node_modules/). For ACR builds, use a trimmed context:

```bash
# See scripts/ for the rsync-based context builder
# Or use the Hephaestus manifest which handles this automatically
```

### Server (Native Binary)

```bash
cargo build --release --features server-bin -p sulcus-server
# Binary at: target/release/sulcus-server (~20MB)
```

### Web Portal

```bash
cd packages/sulcus-web
npm ci
NEXT_PUBLIC_SULCUS_SERVER_URL=https://api.sulcus.ca npm run build
# Output in .next/
```

---

## Deployment — Server

### Manual Deploy

```bash
# 1. Build on ACR
BUILD_REF=$(git rev-parse --short HEAD)
az acr build --registry sulcusacr \
  --image sulcus-server:latest \
  --build-arg BUILD_REF="$BUILD_REF" \
  -f Dockerfile.server .

# 2. Update Container App
az containerapp update \
  --name sulcus-server \
  --resource-group sulcus-rg \
  --image sulcusacr.azurecr.io/sulcus-server:latest \
  --set-env-vars "SULCUS_BUILD_REF=$BUILD_REF"

# 3. Wait for revision to be healthy
az containerapp revision list -g sulcus-rg -n sulcus-server \
  --query "sort_by([?properties.active], &properties.createdTime)[-1]" -o json

# 4. Swing traffic to new revision
NEW_REV=$(az containerapp revision list -g sulcus-rg -n sulcus-server \
  --query "sort_by([?properties.active], &properties.createdTime)[-1].name" -o tsv)
az containerapp ingress traffic set \
  -g sulcus-rg -n sulcus-server \
  --revision-weight "$NEW_REV=100"

# 5. Deactivate old revisions
az containerapp revision list -g sulcus-rg -n sulcus-server \
  --query "[?properties.active && name!='$NEW_REV'].name" -o tsv | \
  while read -r OLD; do
    az containerapp revision deactivate -g sulcus-rg -n sulcus-server --revision "$OLD"
  done

# 6. Verify
curl -sf https://api.sulcus.ca/api/v1/status | python3 -m json.tool
```

### ⚠️ Critical Deploy Notes

- **Max 3 concurrent revisions** — Azure Postgres B1ms has 50 connections; each revision uses a pool of 10. Deactivate old revisions promptly.
- **Migrations run on startup** — The server runs all SQL migrations on boot. They're idempotent but can be slow on the first deploy with new migrations.
- **Cold start** — Container Apps Consumption plan has cold starts. The FastEmbed model (~90MB) is pre-downloaded at build time to avoid startup hangs.
- **ONNX Runtime** — `libonnxruntime.so` must be at `$ORT_DYLIB_PATH`. It's copied in the Dockerfile.

---

## Deployment — Web Portal

```bash
# 1. Build on ACR
az acr build --registry sulcusacr \
  --image sulcus-web:v4-live \
  --build-arg NEXT_PUBLIC_SULCUS_SERVER_URL=https://api.sulcus.ca \
  --build-arg CACHE_BUST=$(date +%s) \
  -f packages/sulcus-web/Dockerfile \
  packages/sulcus-web/

# 2. Update Container App
az containerapp update \
  --name sulcus-web \
  --resource-group sulcus-rg \
  --image sulcusacr.azurecr.io/sulcus-web:v4-live
```

---

## CI/CD Pipeline (Hephaestus)

Hephaestus is a self-hosted Rust CI/CD service running on the Forge VPS (technocraftonline.com). It monitors Git repos for new commits and triggers builds.

### How It Works

1. Git monitor polls repos every 2 minutes
2. Detects new commits → looks up `forge-manifest.toml` by project name
3. Runs the build strategy (cargo, script, docker, node, etc.)
4. If `auto_deploy = true`, runs the deploy step
5. Health checks, failover escalation, notifications

### Sulcus Server Pipeline

- **Monitor entry:** `hephaestus-monitor.toml` → `sulcus-server` watches `external/sulcus` on `master`
- **Manifest:** `deploy/sulcus-server/forge-manifest.toml` → `script` strategy
- **Build:** Syncs source to build context → `docker run azure-cli` → `az acr build`
- **Deploy:** `docker run azure-cli` → `az containerapp update` → health check → traffic swing

### Prerequisites for Hephaestus Azure Deploy

- Azure Service Principal with ACR push + Container App Contributor on `sulcus-rg`
- `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` in Hephaestus container env
- `rsync` installed in Hephaestus container
- `mcr.microsoft.com/azure-cli:latest` pulled on VPS

---

## Database

### PostgreSQL with AGE Extension

- **Production:** Azure Database for PostgreSQL Flexible Server, B1ms tier
- **Extensions required:** `pgvector`, `apache_age` (knowledge graph), `uuid-ossp`
- **Connection pool:** 10 per instance (`SULCUS_DB_POOL_SIZE`)

### Migrations

50 migrations (0001–0050) run automatically on server startup. All are idempotent.

Key migrations:
- `0001` — Core tables (golden_index, tenants, usage)
- `0007` — Golden edges (graph edges)
- `0025` — Triggers system
- `0029` — Enable Apache AGE
- `0031` — pgvector HNSW index
- `0033` — Namespace ACL
- `0046` — API keys namespace field
- `0050` — Namespace normalization (lowercase, spaces→hyphens)

### Schema (Key Tables)

| Table | Purpose |
|---|---|
| `golden_index` | All memory nodes (content, heat, type, namespace, vectors) |
| `golden_edges` | Graph edges between memory nodes |
| `api_keys` | API authentication keys (SHA-256 hashed) |
| `tenants` | Tenant accounts (linked to Keycloak or standalone) |
| `namespace_acl` | Per-agent namespace access control rules |
| `namespace_counters` | Interaction epoch tracking per namespace |
| `triggers` | Configured trigger rules |
| `trigger_signals` | Trigger execution history |
| `training_signals` | SIU training data accumulation |
| `activity_log` | API usage tracking |

### Backups

- Azure handles automated backups for the managed Postgres instance
- Point-in-time restore available (retention period set in Azure)

---

## SIU Pipeline (Intelligence Unit)

The SIU v2 pipeline classifies and validates memories at store time:

### SIVU — Quality Gate

- **Purpose:** Reject low-quality/noise memories before storage
- **Model:** ONNX (scikit-learn → skl2onnx), ~1ms inference
- **Training:** `training/train_sivu.py` + `training/sivu_training_*.jsonl`
- **Output:** Accept (1) or Reject (0)

### SICU — Type Classifier

- **Purpose:** Auto-classify memory type (episodic, semantic, fact, preference, procedural)
- **Model:** ONNX (scikit-learn → skl2onnx), ~1ms inference
- **Training:** `training/train_sicu.py` + `training/sicu_training_*.jsonl`
- **Output:** Classified memory type (overridden if client specifies)

### SILU — Entity Extraction

- **Purpose:** Extract entities + relationships for the knowledge graph
- **Model:** External LLM (configurable via `SULCUS_EXTRACTION_*` env vars)
- **Runs:** Asynchronously after store (fire-and-forget background task)
- **Output:** Entities + edges inserted into Apache AGE graph

### SIRU — Adaptive Recall Scoring

- **Purpose:** Learn optimal scoring weights for recall
- **Status:** Accumulating training data. Train after 20+ sessions per namespace.
- **Weights:** Fetched from server every 30 min, falls back to heuristic defaults.

### Retraining

Models retrain on a 24-hour cycle (container-internal cron):

```bash
# Inside the container:
python3 /opt/sulcus/training/train_sivu.py
python3 /opt/sulcus/training/train_sicu.py
# New ONNX models written to $SIU_V2_MODEL_DIR, hot-reloaded by the server
```

---

## Integrations & SDKs

### Python SDK (`sulcus`)

```bash
pip install sulcus
```

```python
from sulcus import SulcusClient
client = SulcusClient(api_key="your-key", server_url="https://api.sulcus.ca")
client.remember("User prefers dark mode", memory_type="preference")
results = client.search("UI preferences", limit=5)
```

### Node.js SDK (`sulcus`)

```bash
npm install sulcus
```

```typescript
import { SulcusClient } from 'sulcus';
const client = new SulcusClient({ apiKey: 'your-key' });
await client.remember('User prefers dark mode', { type: 'preference' });
const results = await client.search('UI preferences');
```

### Framework Integrations

| Platform | Package | Source |
|---|---|---|
| LangChain | `sulcus-langchain` | `integrations/langchain/` |
| LlamaIndex | `sulcus-llamaindex` | `integrations/llamaindex/` |
| CrewAI | `sulcus-crewai` | `integrations/crewai/` |
| Vercel AI | `sulcus-vercel-ai` | `integrations/vercel-ai/` |
| OpenAI Tools | — | `integrations/openai-tools/` |
| Anthropic Tools | — | `integrations/anthropic-tools/` |

---

## OpenClaw Plugin

The `@digitalforgestudios/openclaw-sulcus` plugin provides automatic memory for OpenClaw agents.

- **Source:** `packages/openclaw-sulcus/`
- **Published:** npm (`@digitalforgestudios/openclaw-sulcus`)
- **Features:** Auto-inject context per turn, store/recall hooks, heat boost on recall, entity-graph expansion, token budget enforcement

### Install in OpenClaw

```bash
openclaw install @digitalforgestudios/openclaw-sulcus
```

Configuration: set `SULCUS_API_KEY` and optionally `SULCUS_SERVER_URL` in OpenClaw config.

---

## MCP Local Sidecar

The `sulcus` binary runs as an MCP (Model Context Protocol) server for Claude Desktop, Claude Code, or any MCP-compatible client.

```bash
# Build
cargo build -p sulcus --release

# Run (stdio mode for MCP)
./target/release/sulcus stdio

# Uses embedded PGlite — no external database needed
# Data stored in SULCUS_DATA_DIR (default: ~/.sulcus)
```

### Claude Desktop Config

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "/path/to/sulcus",
      "args": ["stdio"]
    }
  }
}
```

---

## Testing

### Integration Tests

```bash
# Agent management (namespace, merge, delete)
SULCUS_URL=http://localhost:8080 \
SULCUS_API_KEY=your-key \
./tests/agent_management.sh

# Thermodynamic simulation
./tests/thermodynamics_sim.sh

# Multi-agent collaboration
./tests/multi_agent_collaboration.sh
```

### Rust Unit Tests

```bash
cargo test --workspace
```

---

## Monitoring & Health Checks

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/status` | Full system status (DB, graph, memory stats, version) |
| `GET /api/v1/health` | Lightweight health check (`{"db": true}`) |
| `GET /api/v1/metrics` | Prometheus-format metrics (if `SULCUS_METRICS_ADDR` set) |
| `GET /api/v1/admin/dashboard` | Tenant-level stats (nodes, heat, type distribution) |

### Quick Status Check

```bash
# Is the server alive?
curl -sf https://api.sulcus.ca/api/v1/status | python3 -m json.tool

# Expected: {"status": "operational", "version": "2.x.x-<commit>", ...}

# Is the web portal alive?
curl -sf -o /dev/null -w "%{http_code}" https://sulcus.ca
# Expected: 200
```

### Azure Container App Status

```bash
# Check provisioning state
az containerapp show --name sulcus-server --resource-group sulcus-rg \
  --query '{state:properties.provisioningState, revision:properties.latestRevisionName}' -o json

# List active revisions
az containerapp revision list -g sulcus-rg -n sulcus-server \
  --query "[?properties.active].{name:name, state:properties.healthState, created:properties.createdTime}" -o table
```

---

## Emergency Procedures

### Server Down (api.sulcus.ca not responding)

1. **Check Azure portal** — Container Apps → sulcus-server → Revisions. Is the latest revision healthy?
2. **Check logs:** `az containerapp logs show -g sulcus-rg -n sulcus-server --tail 100`
3. **Check database:** Is Azure Postgres reachable? Check connection limits (max 50, pool 10 per instance).
4. **Too many revisions?** Deactivate old ones: `az containerapp revision list -g sulcus-rg -n sulcus-server --query "[?properties.active].name" -o tsv`
5. **Rollback:** Reactivate a known-good revision: `az containerapp revision activate -g sulcus-rg -n sulcus-server --revision <good-revision-name>`
6. **Nuclear option:** Redeploy from last known good image: `az containerapp update --name sulcus-server --resource-group sulcus-rg --image sulcusacr.azurecr.io/sulcus-server:latest`

### Web Portal Down (sulcus.ca)

Same process as server but with `sulcus-web` container app. Web portal failures don't affect the API.

### Database Connection Exhaustion

Symptom: Server returns 500s, logs show "too many connections."

1. Count active revisions: `az containerapp revision list -g sulcus-rg -n sulcus-server --query "length([?properties.active])"` — should be 1, max 2.
2. Deactivate extra revisions immediately.
3. If still exhausted, check for leaked connections in Azure Postgres metrics.

### ACR Build Failures

```bash
# Check recent build runs
az acr task list-runs --registry sulcusacr --top 5 -o table

# Get logs for a specific run
az acr task logs --registry sulcusacr --run-id <run-id>
```

Common causes: Cargo dependency resolution failure, ONNX Runtime download timeout, Dockerfile layer cache stale.

---

## Key Management & Auth

### API Keys

Static API keys are SHA-256 hashed and stored in the `api_keys` table. Each key belongs to a tenant and has:
- **label** — Human-readable name (e.g., "Daedalus")
- **namespace** — Optional namespace override (decouples key label from data namespace)
- **plan_tier** — Determines rate limits and feature access

### Creating API Keys

Via the web portal (sulcus.ca → Dashboard → Settings → API Keys) or directly in the database.

### OIDC (Keycloak)

The web portal uses OIDC PKCE flow with Keycloak at `auth.sulcus.ca`. When `SULCUS_OIDC_ISSUER` is set, the server validates JWT tokens from Keycloak and maps them to tenants.

JIT provisioning (`SULCUS_OIDC_JIT_ENABLED=true`) auto-creates tenants on first OIDC login.

---

## Namespace Management

### Sanitization

All namespaces are automatically normalized:
- Lowercased
- Spaces and underscores → hyphens
- Non-alphanumeric/hyphen characters stripped
- Multiple hyphens collapsed
- Leading/trailing hyphens trimmed

`"Thor"`, `"thor"`, `"THOR"`, `"th or"` → all become `"thor"`.

### Agent Management (Admin API)

| Endpoint | Description |
|---|---|
| `GET /api/v1/admin/agents` | List all namespaces with stats |
| `GET /api/v1/admin/agents/:ns` | Detailed stats for one namespace |
| `POST /api/v1/admin/agents/merge` | Merge source→target namespace |
| `DELETE /api/v1/admin/agents/:ns?confirm=true` | Delete all data for a namespace |

### Namespace ACL

Controls which agents can access which namespaces:
- `GET /api/v1/namespaces/acl` — List rules
- `POST /api/v1/namespaces/acl` — Create/update rule
- `DELETE /api/v1/namespaces/acl/:id` — Delete rule
- `PUT /api/v1/namespaces/default` — Set default policy (allow/deny)

---

## Billing & Stripe

Stripe integration handles subscription management:
- Webhook endpoint: `POST /api/v1/billing/webhook`
- Checkout sessions: `POST /api/v1/billing/create-checkout-session`
- Portal: `POST /api/v1/billing/portal-session`

Plan tiers: `free`, `cortex` (paid), `enterprise`. Entitlements (max agents, max nodes, features) are set via Stripe product metadata and synced via webhooks.

---

## Release Process

### Server Release

1. Ensure all changes are committed to `master` branch
2. Tag with version: `git tag v2.x.x && git push origin v2.x.x`
3. Hephaestus auto-detects the commit and triggers the build pipeline
4. Or manually: run the ACR build + Container App deploy steps above
5. Verify: `curl https://api.sulcus.ca/api/v1/status` — check `version` field
6. Run integration tests: `./tests/agent_management.sh`

### Local Binary Release

```bash
# Builds for linux-x64, linux-arm64 (cross-compile), macOS (native only)
./scripts/build-release.sh
# Artifacts: target/release/sulcus, target/release/sulcus-server
```

### SDK Release

```bash
# Python
cd sdks/python && pip install build && python -m build && twine upload dist/*

# Node
cd sdks/node && npm publish

# OpenClaw plugin
cd packages/openclaw-sulcus && npm publish --access public
```

---

## Known Issues & Gotchas

1. **Cold starts** — Azure Container Apps Consumption plan has cold starts (5-15s). The FastEmbed model is pre-warmed in the Dockerfile to avoid timeout.
2. **Connection pool exhaustion** — B1ms Postgres has 50 connections max. Each Container App revision uses 10. Never have more than 3 active revisions.
3. **AGE extension** — Apache AGE has quirks with certain Postgres versions. The Azure Flexible Server supports it but may need explicit `CREATE EXTENSION IF NOT EXISTS age;` (handled in migration 0029).
4. **ONNX Runtime version** — Must match between build-time download and pip-installed Python package. Currently pinned to 1.23.0.
5. **sulcus-web build** — `NEXT_PUBLIC_*` env vars are baked in at build time (not runtime). Must be set during `az acr build`.
6. **API key labels are NOT normalized** — Labels are user-visible display names and can have mixed case. Only the `namespace` field (used for data scoping) is normalized.
7. **No GitHub Actions** — All CI/CD runs through Hephaestus on the Forge VPS. This is intentional.

---

## Who Built This

**Sulcus** is built by [Digital Forge Studios](https://sulcus.ca).

- **Architecture & server:** Daedalus
- **Infrastructure & CI/CD:** Daedalus + Icarus
- **Web portal:** Daedalus
- **SDKs & integrations:** Collaborative
- **Design direction:** Dooley

The project embodies the conviction that AI agents deserve real memory — not bolted-on retrieval, but a first-principles system that understands what matters, what's fading, and what should be remembered.

---

## License

See [LICENSE](LICENSE) for the open-source components and [LICENSE-COMMERCIAL](LICENSE-COMMERCIAL) for the commercial server.

---

*The sulci of the brain — those folded grooves that give the cortex its surface area — are where memory lives. The deeper the fold, the more surface area, the more capacity. This project is named for that biology.*