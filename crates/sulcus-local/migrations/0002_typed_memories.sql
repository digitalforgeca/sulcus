-- 0002_typed_memories.sql
-- Phase 1: memory_type taxonomy, temporal edge validity, inhibition-of-return,
-- FTS5 on node summaries, fold-summary nodes.

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

-- ── Memory type on nodes ─────────────────────────────────────────────────────
-- Episodic: conversation events (fast decay)
-- Semantic:  facts / knowledge (slow decay)
-- Preference: user preferences (very slow decay)
-- Procedural: skills / how-to (near-permanent)
ALTER TABLE nodes ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'episodic'
    CHECK(memory_type IN ('episodic', 'semantic', 'preference', 'procedural'));

ALTER TABLE nodes ADD COLUMN updated_at TEXT;

-- ── Temporal edge validity ───────────────────────────────────────────────────
-- valid_to IS NULL means the edge is currently active.
-- Retiring (not deleting) preserves causal history.
ALTER TABLE edges ADD COLUMN valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE edges ADD COLUMN valid_to   TEXT;

-- Backfill existing edges with a valid_from timestamp
UPDATE edges SET valid_from = CURRENT_TIMESTAMP WHERE valid_from IS NULL;

-- ── Inhibition of return on active_index ────────────────────────────────────
-- Tracks how many consecutive ticks a node has stayed in the active index.
-- Used to penalise over-surfaced nodes and promote novelty.
ALTER TABLE active_index ADD COLUMN consecutive_active_ticks INTEGER NOT NULL DEFAULT 0;

-- ── FTS5 table for hybrid keyword + vector search on node summaries ──────────
-- Enables fast full-text search against pointer_summary without scanning every row.
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    node_id   UNINDEXED,
    content               -- mirrors pointer_summary
);

-- Backfill existing nodes into the FTS index
INSERT OR IGNORE INTO nodes_fts(node_id, content)
SELECT id, pointer_summary FROM nodes;

-- ── memory_ops status index (perf) ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_memory_ops_status ON memory_ops(status);

-- ── Edge index for temporal queries ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_edges_valid_to ON edges(valid_to);

COMMIT;
