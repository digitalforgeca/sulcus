# sulcus-web

The public website, documentation hub, and authenticated dashboard for [Sulcus](https://sulcus.ca) — reactive, thermodynamic memory for AI agents.

## What This Is

`sulcus-web` serves three roles from a single Next.js application:

1. **Marketing site** (`sulcus.ca`) — landing page, product overview, newsletter signup
2. **Documentation** (`/docs/*`, `/articles/*`) — MDX-powered guides on the thermodynamic engine, memory graph, SDKs, triggers, dashboard usage, and the local panel
3. **Authenticated dashboard** (`/dashboard/*`) — memory browser, agent management, activity logs, trigger configuration, gamification stats, billing (Stripe), and account settings

## Architecture

```
sulcus.ca / status.sulcus.ca
        │
   ┌────┴────┐
   │ Next.js │  (Azure Container App or local dev)
   │  App    │
   └────┬────┘
        │
        ▼
  ┌───────────┐
  │ sulcus-   │  REST API (api.sulcus.ca)
  │ server    │
  └─────┬─────┘
        │
   ┌────┴────┐
   │ Postgres │  (Hades on Forge VPS, or pg-embed locally)
   └─────────┘
```

**Auth flow:** Session cookie (`sulcus.session`) → Keycloak OIDC via `/api/auth/*` routes → JWT validation. The middleware protects all `/dashboard/*` routes. Local mode (`NEXT_PUBLIC_LOCAL_MODE=true`) skips auth entirely for `sulcus` development.

## Tech Stack

| Layer       | Technology                                       |
| ----------- | ------------------------------------------------ |
| Framework   | Next.js 16 (App Router)                          |
| Runtime     | React 19                                         |
| Language    | TypeScript 5.9                                   |
| Styling     | Tailwind CSS 4, tw-animate-css                   |
| UI          | shadcn/ui (21 components), Lucide icons          |
| Content     | MDX (remark-gfm, rehype-slug, rehype-highlight)  |
| Data        | TanStack Query, TanStack Table                   |
| Graph Viz   | Sigma.js v3 + Graphology (WebGL), D3             |
| Auth        | jose (JWT), Keycloak OIDC                        |
| Payments    | Stripe (react-stripe-js)                         |
| Animation   | Framer Motion                                    |
| Deployment  | Docker (multi-stage), Azure Container Apps       |

## Project Structure

```
src/
├── app/
│   ├── page.tsx                 # Landing page
│   ├── login/                   # Auth login page
│   ├── auth/error/              # Auth error handling
│   ├── api/
│   │   ├── auth/                # login, logout, register, session
│   │   └── waitlist/            # Newsletter waitlist signup
│   ├── articles/                # MDX articles (reactive, thermodynamic memory, etc.)
│   ├── docs/                    # Documentation pages
│   │   ├── sdks/
│   │   ├── triggers/
│   │   ├── thermodynamic-engine/
│   │   ├── memory-graph/
│   │   ├── dashboard/
│   │   └── local-panel/
│   ├── dashboard/               # Authenticated dashboard
│   │   ├── memories/            # Memory browser
│   │   ├── agents/              # Agent management
│   │   ├── activity/            # Activity logs
│   │   ├── triggers/            # Trigger configuration
│   │   ├── gamification/        # Gamification stats
│   │   ├── billing/             # Stripe billing + checkout
│   │   ├── account/             # Account settings
│   │   └── settings/            # App settings
│   ├── membench/                # Memory benchmark tool
│   ├── performance/             # Performance testing
│   └── status/                  # Service status page
├── components/
│   ├── ui/                      # 21 shadcn/ui primitives
│   ├── WebGLGraph.tsx           # Sigma.js memory map renderer
│   ├── KeryxNewsletter.tsx      # Newsletter signup widget
│   ├── site-nav.tsx             # Site navigation
│   ├── providers.tsx            # React Query + theme providers
│   └── toast.tsx                # Sonner toast notifications
├── lib/
│   ├── api.ts                   # API client with auth (Keycloak JWT / API key / local mode)
│   ├── utils.ts                 # Tailwind merge utilities
│   └── type-svg-paths.ts        # Memory type icon SVG paths
└── middleware.ts                 # Route protection for /dashboard/*
```

## Development

### Prerequisites

- Node.js 20+
- npm

### Local development (against sulcus)

```bash
# From the monorepo root:
cd packages/sulcus-web

# Install dependencies
npm install

# Run against a local sulcus instance (no auth required)
NEXT_PUBLIC_LOCAL_MODE=true \
NEXT_PUBLIC_SULCUS_SERVER_URL=http://localhost:43210 \
npm run dev
```

### Local development (against production API)

```bash
NEXT_PUBLIC_SULCUS_SERVER_URL=https://api.sulcus.ca \
NEXT_PUBLIC_SULCUS_API_KEY=<your-api-key> \
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `NEXT_PUBLIC_SULCUS_SERVER_URL` | Yes | `https://api.sulcus.ca` | Sulcus API endpoint |
| `NEXT_PUBLIC_SULCUS_API_KEY` | No | — | Static API key (fallback auth) |
| `NEXT_PUBLIC_LOCAL_MODE` | No | `false` | Skip auth for local development |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No | — | Stripe publishable key for billing |

## Building

```bash
npm run build
```

### Docker

The Dockerfile uses a multi-stage build (deps → builder → runner) and bakes `NEXT_PUBLIC_*` variables at build time:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SULCUS_SERVER_URL=https://api.sulcus.ca \
  --build-arg CACHE_BUST=$(date +%s) \
  -t sulcus-web .
```

The production image exposes port 8080.

## Deployment

Currently deployed as an Azure Container App. The Docker image is built with `CACHE_BUST` to ensure fresh source is always picked up.

**Redirects handled by Next.js config:**
- `www.sulcus.ca/*` → `sulcus.ca/*` (permanent)
- `status.sulcus.ca/*` → `sulcus.ca/status` (permanent)

## License

See [LICENSE-COMMERCIAL](../../LICENSE-COMMERCIAL) in the monorepo root.
