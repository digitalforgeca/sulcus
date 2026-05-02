# sulcus-server

The HTTP API server for [Sulcus](https://sulcus.ca) — a reactive, thermodynamic memory system for AI agents.

This is the central service that handles memory sync, search, decay, triggers, billing, extensions, and the admin dashboard API. All client integrations (OpenClaw plugin, MCP bridge, SDKs) talk to this server.

**Live at:** [api.sulcus.ca](https://api.sulcus.ca)

## Architecture

```
                    ┌─────────────────────┐
                    │   sulcus-server     │
                    │   (Axum + Tokio)    │
                    ├─────────────────────┤
                    │  Auth Middleware    │ ← API key or Keycloak OIDC
                    │  Rate Limiter      │
                    ├─────────────────────┤
                    │  Agent API         │ ← sync, search, hot_nodes
                    │  Admin API         │ ← dashboard, usage, invite
                    │  Billing API       │ ← Stripe products/webhooks
                    │  Trigger Engine    │ ← programmable memory triggers
                    │  MCP Bridge        │ ← SSE + JSON-RPC (remote MCP)
                    │  Extensions API    │ ← native plugin sync/download
                    │  Telemetry         │ ← client-side event ingest
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │  PostgreSQL (Hades) │
                    │  sulcus-core schema │
                    └─────────────────────┘
```

## Crate Dependencies

| Crate | Role |
|-------|------|
| `sulcus-core` | Thermodynamic engine — decay, diffusion, heat calculations |
| `sulcus` | Local storage operations, migration runner |
| `axum` | HTTP framework |
| `sqlx` | Async PostgreSQL driver |
| `tokio` | Async runtime |

## API Endpoints

### Authenticated (API key required)

| Method | Path | Module | Description |
|--------|------|--------|-------------|
| POST | `/api/v1/agent/sync` | agent | Sync memories (push/pull) |
| GET | `/api/v1/agent/hot_nodes` | agent | List hottest memories |
| POST | `/api/v1/agent/search` | agent | Semantic text search |
| GET | `/api/v1/agent/storage` | agent | Storage usage stats |
| GET | `/api/v1/metrics` | agent | Agent metrics |
| POST | `/api/v1/feedback` | thermo_api | Memory feedback (boost/suppress) |
| GET | `/api/v1/auth/verify` | agent | Validate API key — returns identity, tier, limits |
| GET | `/api/v1/keys` | keys | List API keys |
| POST | `/api/v1/keys` | keys | Create API key |
| DELETE | `/api/v1/keys/:id` | keys | Revoke API key |
| GET | `/api/v1/triggers/history` | triggers | Trigger execution history |
| GET | `/api/v1/extensions/sync` | extensions | Sync native extensions |

### Admin (OIDC session required)

| Method | Path | Module | Description |
|--------|------|--------|-------------|
| GET | `/api/v1/admin/dashboard` | agent | Dashboard statistics |
| POST | `/api/v1/admin/invite` | agent | Generate invite code |
| POST | `/api/v1/admin/invite/send` | agent | Send invite email |
| GET | `/api/v1/admin/usage` | agent | Usage analytics |
| GET | `/api/v1/admin/telemetry` | telemetry | Telemetry stats |
| GET | `/api/v1/admin/waitlist` | waitlist | View waitlist |
| GET | `/api/v1/org` | org | Get organization |
| PATCH | `/api/v1/org` | org | Update organization |
| POST | `/api/v1/org/invite` | org | Invite org member |
| DELETE | `/api/v1/org/members` | org | Remove org member |

### Public (no auth)

| Method | Path | Module | Description |
|--------|------|--------|-------------|
| GET | `/` | — | Health check ("SULCUS Server Active") |
| POST | `/api/v1/admin/join` | agent | Account registration |
| POST | `/api/v1/waitlist` | waitlist | Join waitlist |
| GET | `/api/v1/billing/products` | billing | List subscription products |
| POST | `/api/v1/telemetry` | telemetry | Ingest client telemetry |
| GET | `/api/v1/status` | status | Public service status |

### MCP (Model Context Protocol)

| Method | Path | Module | Description |
|--------|------|--------|-------------|
| GET | `/api/v1/mcp/sse` | remote_mcp | SSE transport |
| POST | `/api/v1/mcp/message` | remote_mcp | JSON-RPC message handler |

## Source Modules

| File | Lines | Purpose |
|------|-------|---------|
| `agent.rs` | Core | Memory sync, search, hot nodes, dashboard |
| `auth.rs` | Core | API key validation, OIDC middleware |
| `db.rs` | Core | PostgreSQL pool, migrations |
| `worker.rs` | Core | Background tasks (decay sweeps, trigger evaluation) |
| `thermo_api.rs` | Engine | Thermodynamic feedback API |
| `trigger_engine.rs` | Engine | Programmable trigger evaluation |
| `triggers.rs` | Engine | Trigger CRUD and history |
| `billing.rs` | Business | Stripe integration, product listing |
| `org.rs` | Business | Organization management, multi-tenant |
| `keys.rs` | Business | API key lifecycle |
| `extensions.rs` | Platform | Native extension sync/download |
| `remote_mcp.rs` | Platform | MCP SSE + JSON-RPC bridge |
| `telemetry.rs` | Ops | Client telemetry ingest + admin view |
| `metrics.rs` | Ops | Prometheus-style metrics export |
| `status.rs` | Ops | Public health/status endpoint |
| `rate_limit.rs` | Infra | Per-key rate limiting |
| `middleware.rs` | Infra | Request logging, CORS, compression |
| `encryption.rs` | Security | At-rest encryption for memory content |
| `keycloak.rs` | Security | OIDC token validation, JIT provisioning |
| `email.rs` | Comms | SMTP invite/notification emails |
| `waitlist.rs` | Growth | Waitlist signup and management |
| `gamification.rs` | Growth | Usage streaks and achievements |
| `activity.rs` | Analytics | User activity tracking |

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `SULCUS_DATABASE_URL` | PostgreSQL connection string | `postgres://sulcus:pass@localhost:5432/sulcus` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `SULCUS_BIND_ADDR` | `127.0.0.1:3000` | Server listen address |
| `SULCUS_CORS_ORIGINS` | — | Allowed CORS origins (comma-separated) |
| `SULCUS_PUBLIC_URL` | — | Public-facing URL for links/emails |
| `SULCUS_ALLOW_ANY_KEY` | — | Skip API key validation (dev only) |
| `SULCUS_METRICS_ADDR` | — | Separate metrics endpoint address |
| `SULCUS_EXTENSION_VERSION` | — | Current native extension version string |

### Authentication (Keycloak OIDC)

| Variable | Description |
|----------|-------------|
| `SULCUS_OIDC_ISSUER` | Keycloak realm issuer URL |
| `SULCUS_OIDC_CLIENT_ID` | OIDC client ID |
| `SULCUS_OIDC_JIT_ENABLED` | Enable just-in-time user provisioning |
| `AUTH_KEYCLOAK_ISSUER` | Alternative issuer URL (legacy) |
| `KEYCLOAK_ADMIN` | Admin username (for realm management) |
| `KEYCLOAK_ADMIN_PASSWORD` | Admin password |

### Billing (Stripe)

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `SULCUS_STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

### Email (SMTP)

| Variable | Description |
|----------|-------------|
| `SULCUS_SMTP_HOST` | SMTP server hostname |
| `SULCUS_SMTP_PORT` | SMTP server port |
| `SULCUS_SMTP_USERNAME` | SMTP auth username |
| `SULCUS_SMTP_PASSWORD` | SMTP auth password |
| `SULCUS_SMTP_FROM` | Sender email address |
| `SULCUS_SMTP_FROM_NAME` | Sender display name |

### Extensions

| Variable | Description |
|----------|-------------|
| `EXTENSION_STORAGE_URL` | Base URL for native extension downloads |

## Building

```bash
# Check
cargo check -p sulcus-server

# Build (library only — for integration tests or embedding)
cargo build -p sulcus-server

# Build the HTTP server binary
cargo build -p sulcus-server --features server-bin

# Release build
cargo build --release -p sulcus-server --features server-bin
```

The `server-bin` feature flag gates the HTTP listener. Without it, the crate compiles as a library (useful for testing or embedding the router in other services).

## Running

```bash
# Minimal (local dev)
SULCUS_DATABASE_URL=postgres://localhost/sulcus \
  cargo run -p sulcus-server --features server-bin

# With auth + CORS
SULCUS_DATABASE_URL=postgres://localhost/sulcus \
SULCUS_BIND_ADDR=0.0.0.0:3000 \
SULCUS_CORS_ORIGINS=https://sulcus.ca,http://localhost:3001 \
SULCUS_OIDC_ISSUER=https://auth.sulcus.ca/realms/sulcus \
SULCUS_OIDC_CLIENT_ID=sulcus-web \
  cargo run -p sulcus-server --features server-bin
```

## Docker

```bash
# Build from repo root
docker build -f Dockerfile.server -t sulcus-server .

# Run
docker run -p 3000:3000 \
  -e SULCUS_DATABASE_URL=postgres://host.docker.internal/sulcus \
  sulcus-server
```

## License

Proprietary — © [Digital Forge Studios](https://dforge.ca). See [LICENSE-COMMERCIAL](../../LICENSE-COMMERCIAL).
