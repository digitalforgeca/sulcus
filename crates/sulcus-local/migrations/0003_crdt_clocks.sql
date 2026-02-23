-- Migration 0003: Add per-field CRDT clock storage to nodes.
--
-- `crdt_clocks` is a JSONB map of field-name → serialised Hlc
-- (e.g. {"label": {"wall": 1700000000000, "logical": 0, "node_id": "…"}}).
-- Storing this alongside the node row avoids a separate table join on every
-- sync apply and makes the clock state trivially durable across restarts.

BEGIN;

ALTER TABLE nodes ADD COLUMN IF NOT EXISTS crdt_clocks JSONB;

COMMIT;
