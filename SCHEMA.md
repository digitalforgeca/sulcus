# SaaS Database Schema (PostgreSQL)

## 1. Identity & Billing

```sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    stripe_id TEXT UNIQUE,
    plan_tier TEXT DEFAULT 'free', -- 'free', 'pro', 'enterprise'
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT, -- or Auth provider ID
    role TEXT DEFAULT 'member'
);

CREATE TABLE api_keys (
    prefix TEXT NOT NULL, -- "sk-agent"
    hash TEXT PRIMARY KEY, -- SHA256(secret)
    org_id UUID REFERENCES organizations(id),
    label TEXT,
    last_used_at TIMESTAMPTZ
);
```

## 2. The Semantic Brain (Multi-Tenant)

Note: These mirror the local SQLite tables but add org_id.

```
SQL
CREATE TABLE nodes (
    id UUID PRIMARY KEY, -- Client-generated UUIDv7
    org_id UUID REFERENCES organizations(id) NOT NULL,
    content TEXT,
    vector VECTOR(1536), -- pgvector extension
    heat FLOAT DEFAULT 100.0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX on nodes (org_id);
CREATE INDEX on nodes USING hnsw (vector vector_cosine_ops);

CREATE TABLE edges (
    source_id UUID REFERENCES nodes(id),
    target_id UUID REFERENCES nodes(id),
    org_id UUID REFERENCES organizations(id) NOT NULL,
    weight FLOAT,
    PRIMARY KEY (source_id, target_id)
);
```

## 3. The Sync Log (Write-Ahead Log)

```
SQL
CREATE TABLE memory_ops (
    seq_id BIGSERIAL PRIMARY KEY,
    org_id UUID REFERENCES organizations(id) NOT NULL,
    agent_id TEXT, -- "sulcus-local-dev-1"
    op_type TEXT, -- "ADD", "UPDATE", "DELETE"
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

## Server-side WAL & Golden Index (service)

The server persists an append-only WAL (`server_ops`) and maintains a `golden_index` view.

```sql
CREATE TABLE server_ops (
    seq_id BIGSERIAL PRIMARY KEY,
    op_type TEXT NOT NULL CHECK (op_type IN ('Add','Update','Delete')),
    payload JSONB,
    op_hash TEXT NOT NULL, -- dedupe fingerprint (sha256 hex)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_server_ops_op_hash ON server_ops(op_hash);

CREATE TABLE golden_index (
    id UUID PRIMARY KEY,
    summary TEXT NOT NULL,
    heat FLOAT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
