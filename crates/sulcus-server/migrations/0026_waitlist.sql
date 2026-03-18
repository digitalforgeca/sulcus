-- Waitlist / newsletter signup capture
CREATE TABLE IF NOT EXISTS waitlist (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'landing',   -- landing, docs, referral, etc.
    ip_hash     TEXT,                               -- sha256 of IP for dedup, not raw IP
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(email)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at DESC);
