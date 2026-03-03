-- 0003_usage_tracking.sql
-- Per-tenant monthly usage counters for billing.

CREATE TABLE IF NOT EXISTS tenant_usage (
    tenant_id  VARCHAR(64)  NOT NULL,
    month      DATE         NOT NULL,  -- first day of the billing month
    sync_requests  BIGINT   NOT NULL DEFAULT 0,
    nodes_added    BIGINT   NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, month)
);