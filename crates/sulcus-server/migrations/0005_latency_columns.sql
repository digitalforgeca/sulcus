-- 0005_latency_columns.sql
-- Add per-tenant latency telemetry to tenant_usage for performance-based billing.

ALTER TABLE tenant_usage ADD COLUMN IF NOT EXISTS avg_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE tenant_usage ADD COLUMN IF NOT EXISTS max_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0;
