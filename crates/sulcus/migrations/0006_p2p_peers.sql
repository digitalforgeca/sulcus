-- 0006_p2p_peers.sql
-- Table for tracking discovered P2P peers for localized differential sync.

CREATE TABLE IF NOT EXISTS peers (
    peer_id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sync_status TEXT NOT NULL DEFAULT 'idle',
    last_sync_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_peers_last_seen ON peers(last_seen_at DESC);
