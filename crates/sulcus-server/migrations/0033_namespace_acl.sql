-- 0033_namespace_acl.sql
-- Namespace access control: per-agent, per-namespace allow/deny rules.
-- Default policy is configurable per tenant.

-- Per-agent namespace rules
CREATE TABLE IF NOT EXISTS namespace_acl (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(64) NOT NULL,
    agent_label TEXT NOT NULL,          -- matches api_keys.label
    namespace TEXT NOT NULL,            -- target namespace
    policy TEXT NOT NULL DEFAULT 'allow' CHECK (policy IN ('allow', 'deny')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, agent_label, namespace)
);

CREATE INDEX IF NOT EXISTS idx_namespace_acl_tenant ON namespace_acl(tenant_id);
CREATE INDEX IF NOT EXISTS idx_namespace_acl_lookup ON namespace_acl(tenant_id, agent_label);

-- Tenant-level default namespace policy
CREATE TABLE IF NOT EXISTS namespace_defaults (
    tenant_id VARCHAR(64) PRIMARY KEY,
    default_policy TEXT NOT NULL DEFAULT 'allow' CHECK (default_policy IN ('allow', 'deny')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
