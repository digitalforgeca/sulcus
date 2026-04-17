-- SIRU: Recall session logging for the Sulcusian Intelligence Recall Unit.
-- Every recall (context injection) logs what was queried, what was selected, 
-- and how well each signal performed. This data feeds SIRU's learned scoring model.

-- ─── Recall Sessions (plugin-level context injection events) ──────────────────

CREATE TABLE IF NOT EXISTS recall_sessions (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL,
    namespace       VARCHAR(128),
    agent_id        VARCHAR(128),

    -- What was queried
    query_text      TEXT NOT NULL,
    entity_hints    TEXT[],              -- entities extracted from query

    -- Budget
    token_budget    INT NOT NULL,
    tokens_used     INT NOT NULL,

    -- Selection stats
    candidates_total    INT NOT NULL,
    candidates_selected INT NOT NULL,
    semantic_count      INT NOT NULL DEFAULT 0,
    hot_count           INT NOT NULL DEFAULT 0,
    entity_count        INT NOT NULL DEFAULT 0,

    -- Detailed selections (parallel arrays — memory IDs, scores, sources)
    memory_ids      TEXT[],
    memory_scores   REAL[],
    memory_sources  TEXT[],              -- 'semantic' | 'hot' | 'entity' | 'profile'

    -- Feedback (filled later if agent/user provides explicit feedback on recall quality)
    feedback_signal VARCHAR(32),         -- 'helpful' | 'unhelpful' | 'partial' | null
    feedback_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recall_sessions_tenant
    ON recall_sessions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recall_sessions_namespace
    ON recall_sessions (tenant_id, namespace, created_at DESC);

-- ─── SIRU Weights: Per-tenant/namespace learned scoring weights ───────────────

CREATE TABLE IF NOT EXISTS siru_weights (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL,
    namespace       VARCHAR(128),        -- null = tenant-wide default

    -- Composite scoring weights (replace heuristic defaults)
    similarity_weight   REAL NOT NULL DEFAULT 0.40,
    heat_weight         REAL NOT NULL DEFAULT 0.30,
    recency_weight      REAL NOT NULL DEFAULT 0.20,
    source_boost_semantic  REAL NOT NULL DEFAULT 0.00,
    source_boost_hot       REAL NOT NULL DEFAULT 0.05,
    source_boost_entity    REAL NOT NULL DEFAULT 0.10,
    source_boost_profile   REAL NOT NULL DEFAULT 0.15,

    -- Training metadata
    trained_from    INT NOT NULL DEFAULT 0,    -- number of recall sessions used
    model_version   INT NOT NULL DEFAULT 0,    -- incremented on each retrain
    trained_at      TIMESTAMPTZ,

    -- Effectiveness metrics from last training run
    precision_at_k  REAL,                      -- precision@k on held-out set
    recall_at_k     REAL,                      -- recall@k on held-out set
    ndcg            REAL,                      -- NDCG (normalized discounted cumulative gain)

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, namespace)
);

CREATE INDEX IF NOT EXISTS idx_siru_weights_tenant
    ON siru_weights (tenant_id);
