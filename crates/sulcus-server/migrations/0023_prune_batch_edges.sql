-- 0023_prune_batch_edges.sql
-- One-time cleanup: remove edges generated from batch imports
-- where source and target had identical updated_at timestamps.
-- These are noise from the old 1h-window temporal proximity heuristic.

DELETE FROM golden_edges
WHERE edge_type = 'temporal_proximity'
  AND weight = 0.5
  AND (source_id, target_id) IN (
    SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id)
    FROM golden_index a
    JOIN golden_index b ON a.tenant_id = b.tenant_id
      AND a.id < b.id
      AND a.updated_at = b.updated_at
    WHERE a.tenant_id = golden_edges.tenant_id
  );
