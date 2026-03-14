-- 0021: Configurable thermodynamic engine.
--
-- Adds per-tenant thermo config, per-node decay overrides,
-- temporal validity, stability tracking, and recall logging.

-- ─── Per-tenant thermodynamic configuration ─────────────────────────────────
CREATE TABLE IF NOT EXISTS thermo_config (
    tenant_id   TEXT PRIMARY KEY REFERENCES api_keys(tenant_id) ON DELETE CASCADE,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Per-node decay overrides + temporal fields ─────────────────────────────
ALTER TABLE golden_index
    ADD COLUMN IF NOT EXISTS decay_class  TEXT NOT NULL DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS stability    REAL NOT NULL DEFAULT 1.0,
    ADD COLUMN IF NOT EXISTS min_heat     REAL,
    ADD COLUMN IF NOT EXISTS ttl_hours    REAL,
    ADD COLUMN IF NOT EXISTS valid_from   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS valid_until  TIMESTAMPTZ;

-- ─── Recall log for feedback loop + adaptation ──────────────────────────────
CREATE TABLE IF NOT EXISTS recall_log (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    node_id     UUID NOT NULL,
    recalled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    context     TEXT,          -- 'search' | 'page_in' | 'mcp_tool'
    signal      TEXT,          -- 'relevant' | 'irrelevant' | 'outdated' | null
    heat_before REAL,
    heat_after  REAL
);

CREATE INDEX IF NOT EXISTS idx_recall_log_tenant ON recall_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_recall_log_node ON recall_log (node_id);
CREATE INDEX IF NOT EXISTS idx_recall_log_recalled_at ON recall_log (recalled_at DESC);

-- ─── Feedback endpoint support ──────────────────────────────────────────────
-- The recall_log.signal column serves as the feedback mechanism.
-- 'relevant' → boost stability, reinforce heat
-- 'irrelevant' → reduce stability, decay heat faster
-- 'outdated' → invalidate (set valid_until = now())
