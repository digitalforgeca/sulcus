# SULCUS Centralized Infrastructure & Configuration

This document tracks all centralized IP and domain references within the SULCUS ecosystem.

## 1. Primary Production Domain
- **Domain:** `sulcus.dforge.ca`
- **Azure IP:** `40.87.99.178` (A Record points here)

## 2. Port Allocation
- **Port 80:** Public Next.js Marketing & Dashboard (`sulcus-web`)
- **Port 3000:** Enterprise Sync API & Remote MCP (`sulcus-server`)
- **Port 8081:** Keycloak 26+ IAM Service

## 3. Authentication & Identity
### Keycloak (Identity Provider)
- **Service:** Docker container (`keycloak`) running on port 8081.
- **Database:** Dedicated `keycloak` database in the same Postgres instance.
- **Admin:** Credentials managed via `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD` env vars.

### Frontend (Next.js - Auth.js)
- **Integration:** Auth.js (NextAuth v5) using Keycloak provider.
- **Config:** Managed in `packages/sulcus-web/src/auth.ts`.
- **Middleware:** Protects `/dashboard/*` with invisible redirect to Keycloak.
- **Env Vars Required:**
  - `AUTH_KEYCLOAK_ID`: Client ID (e.g. `sulcus-enterprise`)
  - `AUTH_KEYCLOAK_SECRET`: Client Secret
  - `AUTH_KEYCLOAK_ISSUER`: Issuer URL (e.g. `http://sulcus.dforge.ca:8081/realms/sulcus`)
  - `AUTH_SECRET`: Random string for cookie encryption.
### Backend (Rust - `sulcus-server`)
- Managed via `SULCUS_PUBLIC_URL` environment variable.
- Defaulted in `crates/sulcus-server/src/lib.rs` within `AppState`.
- Used for: Stripe Checkout success/cancel redirects.

### Frontend (Next.js - `sulcus-web`)
- Managed via `NEXT_PUBLIC_SULCUS_SERVER_URL` environment variable.
- Fallback defined in:
  - `packages/sulcus-web/src/app/dashboard/page.tsx`
  - `packages/sulcus-web/src/app/dashboard/billing/page.tsx`
- Used for: API calls to the Rust sync server.

### Local Sidecar (Rust - `sulcus`)
- Default server URL in `sulcus.ini`.
- `upgrade_to_team` MCP tool returns the dashboard URL.

## 4. Deployment Scripts
- `deploy_azure.sh`: Automates VM creation and initial provisioning.
- `update_azure.sh`: Synchronizes code and restarts Docker/Screen sessions.
- These scripts now use the `DOMAIN="sulcus.dforge.ca"` variable for building and running containers.

---
*Last Updated: 2026-03-05*
