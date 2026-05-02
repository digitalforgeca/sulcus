SELECT id, label, current_heat, last_accessed_at FROM nodes WHERE label IN ('A', 'B') ORDER BY created_at DESC LIMIT 2;
