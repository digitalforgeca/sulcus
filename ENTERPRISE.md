# SULCUS Enterprise Systems Documentation

## 1. Architectural Overview
SULCUS Enterprise is designed as a high-scale Coordination Layer for distributed AI agents. Unlike the local vMMU, the Enterprise Server handles:
- **Global Golden Index:** A unified memory graph across multiple agents and devices.
- **Tenant Isolation:** Strong cryptographic and logical partitioning of memory pools.
- **Multi-modal Vector Caching:** Efficient storage and retrieval of high-dimensional embeddings using `pgvector`.

## 2. Security & Compliance
- **Authentication:** All requests require a `Bearer` token. Tokens are SHA256 hashed and matched against the `api_keys` table.
- **Data at Rest:** Leverages Azure/AWS native encryption for PostgreSQL storage.
- **Audit Logging:** Every `SyncRequest` and `search_golden_index` call is logged with `tenant_id` and timestamp.
- **SOC2 Readiness:** Designed for easy integration with corporate logging providers (Datadog, Splunk).

## 3. Multi-tenancy Logic
Each request is scoped to a `tenant_id` derived from the API key.
- **Database Partitioning:** All tables (nodes, edges, golden_index, server_ops) use a `tenant_id` column as part of the primary or composite index.
- **Context Integrity:** An agent for Tenant A can never retrieve, update, or even know of the existence of memories belonging to Tenant B.

## 4. Performance & Scalability
- **Horizontal Scaling:** The `sulcus-server` is stateless and can be scaled behind a load balancer.
- **Connection Pooling:** Uses `sqlx` with aggressive pooling to minimize Postgres handshake overhead.
- **Latency Targets:** 
    - Local: <50ms context build.
    - Remote Sync: <250ms (p95).
    - Remote Search: <300ms (p95).

## 5. Deployment Guide (Azure)
1. **Infrastructure:** Ubuntu 22.04 VM + PostgreSQL 15 (with `pgvector`).
2. **Setup:**
   ```bash
   git clone https://github.com/google/sulcus.git
   cd sulcus
   docker compose -f docker-compose.postgres.yml up -d
   cargo build --release -p sulcus-server --features server-bin
   ```
3. **Configuration:**
   - `SULCUS_DATABASE_URL`: Connection string.
   - `SULCUS_BIND_ADDR`: Binds to `0.0.0.0:3000`.
   - `SULCUS_ALLOW_ANY_KEY`: Set to `true` only for initial bootstrap or local dev.
