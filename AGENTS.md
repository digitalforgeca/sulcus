# AGENTS.md — Sulcus Operating Directives

## Deployment (MANDATORY)

**All server deployments MUST go through `./deploy.sh`.** No exceptions.

- Do NOT run `az acr build` or `az containerapp update` manually.
- Do NOT deploy by pushing to ACR and manually updating the container app.
- If `deploy.sh` is broken, **fix the script first**, then deploy through it.
- The script is the single source of truth for how deployments happen.
- Improving the deployment system is always welcome — make it better, not worse.

### Deploy config

All deployment configuration lives in `crates/sulcus-server/Cargo.toml` under `[package.metadata.deploy]`:

```toml
[package.metadata.deploy]
acr_registry = "sulcusacr"
acr_image = "sulcus-server:latest"
container_app = "sulcus-server"
resource_group = "sulcus-rg"
api_url = "https://api.sulcus.ca"
dockerfile = "docker/server/Dockerfile"
```

### Deploy commands

```bash
./deploy.sh              # Deploy at current version
./deploy.sh --bump patch # Bump patch, build, deploy
./deploy.sh --bump minor # Bump minor, build, deploy
./deploy.sh --bump major # Bump major, build, deploy
./deploy.sh --set X.Y.Z  # Set explicit version, build, deploy
./deploy.sh --build-only # Build image without deploying
./deploy.sh --dry-run    # Preview without executing
```

### What the script does

1. Reads config from Cargo.toml `[package.metadata.deploy]`
2. Bumps version in Cargo.toml (if `--bump` or `--set` specified)
3. `cargo check` — compile validation before wasting ACR build time
4. `az acr build` — builds Docker image on Azure Container Registry
5. `az containerapp update` — deploys new revision with version-stamped suffix
6. Deactivates old revisions automatically
7. Health check — verifies API responds with correct version
8. Git commit — commits the version bump (if version changed)

### Deployment principles

- **Version is the single source of truth:** `crates/sulcus-server/Cargo.toml` → `CARGO_PKG_VERSION` → server response. One place to change.
- **Every deploy gets a versioned revision suffix:** `v2-9-0-{timestamp}` — traceable in Azure portal.
- **Old revisions are cleaned up automatically:** No stale revisions accumulating.
- **Health check verifies the deployed version matches:** Catches image caching bugs.
- **Dry run before production:** Always `--dry-run` first if unsure.

### When the script breaks

If `deploy.sh` fails or doesn't handle a new requirement:
1. **Fix the script.** Do not work around it.
2. Test with `--dry-run`.
3. Commit the fix alongside whatever else you're deploying.
4. Document what broke and why in the commit message.

The goal is a deployment system that gets better with every use, not one that gets bypassed.

---

## Identity & Role

You are building **SULCUS**, a "Memory-as-a-Service" platform for AI Agents.

## Core Philosophy

1. **Semantic, Not Hardware:** We are building a _Semantic VMMU_ (Virtual Memory Management Unit). We care about _Concept Mapping_ and _Knowledge Graphs_, not GPU VRAM or tensor paging.
2. **Map vs. Territory:** Strictly separate the "Map" (Lightweight Pointers/Vectors) from the "Territory" (Heavy Raw Text). The LLM scans the Map; it only fetches the Territory on a "Page Fault."
3. **Thermodynamics:** Memory is not static. It has "Heat." Nodes accessed frequently stay hot; nodes ignored decay and fall out of the context window.
4. **Local-First, Cloud-Sync:** Must work 100% offline (local PostgreSQL) but support "Delta Sync" to a central server for team collaboration.

## Technical Constraints

- **Language:** Rust (2021 edition)
- **Workspace:** Cargo Workspace with separated crates
- **Async:** `tokio` for everything
- **Database:** `sqlx` with PostgreSQL (local and server)
- **Embeddings:** `fastembed` (local CPU inference)
- **Protocol:** MCP for the Agent Interface (Stdio for Local, SSE for Server)

## The "Do Not" List

- **Do NOT** use an ORM (Diesel/SeaORM). Raw SQL via `sqlx`.
- **Do NOT** suggest Python. Single-binary distribution.
- **Do NOT** implement "Chat" features. We are the _Memory_, not the _Agent_.
- **Do NOT** use heavy graph databases (Neo4j). Graph in SQL.
- **Do NOT** deploy without `./deploy.sh`.

## SaaS Constraints

1. **No "Global" State:** All state scoped to Request or Organization.
2. **Secret Management:** Never store API keys in plaintext. Hash them. Return key only once upon creation.
3. **Rate Limiting:** `tower_governor` middleware. 100 syncs/minute per Organization.
4. **Error Handling:** Cross-org reads return `404` (mask existence), not `403`.
