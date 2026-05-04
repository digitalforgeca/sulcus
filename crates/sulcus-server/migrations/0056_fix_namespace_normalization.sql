-- Migration 0051: Fix namespace normalization from 0050
-- Bug: 0050 applied lower() AFTER stripping non-lowercase chars,
-- so uppercase letters like 'T' in 'Thor' were stripped → 'hor'.
-- Fix: Re-normalize with lower() applied FIRST, then strip non-alphanumeric.

-- golden_index
UPDATE golden_index
SET namespace = regexp_replace(
    regexp_replace(
        regexp_replace(lower(trim(namespace)), '[ _]+', '-', 'g'),
        '[^a-z0-9-]', '', 'g'
    ),
    '-{2,}', '-', 'g'
)
WHERE namespace IS DISTINCT FROM regexp_replace(
    regexp_replace(
        regexp_replace(lower(trim(namespace)), '[ _]+', '-', 'g'),
        '[^a-z0-9-]', '', 'g'
    ),
    '-{2,}', '-', 'g'
);

-- namespace_counters
UPDATE namespace_counters
SET namespace = regexp_replace(
    regexp_replace(
        regexp_replace(lower(trim(namespace)), '[ _]+', '-', 'g'),
        '[^a-z0-9-]', '', 'g'
    ),
    '-{2,}', '-', 'g'
)
WHERE namespace IS DISTINCT FROM regexp_replace(
    regexp_replace(
        regexp_replace(lower(trim(namespace)), '[ _]+', '-', 'g'),
        '[^a-z0-9-]', '', 'g'
    ),
    '-{2,}', '-', 'g'
);

-- namespace_acl
UPDATE namespace_acl
SET namespace = regexp_replace(
    regexp_replace(
        regexp_replace(lower(trim(namespace)), '[ _]+', '-', 'g'),
        '[^a-z0-9-]', '', 'g'
    ),
    '-{2,}', '-', 'g'
)
WHERE namespace IS DISTINCT FROM regexp_replace(
    regexp_replace(
        regexp_replace(lower(trim(namespace)), '[ _]+', '-', 'g'),
        '[^a-z0-9-]', '', 'g'
    ),
    '-{2,}', '-', 'g'
);

-- api_keys
UPDATE api_keys
SET namespace = regexp_replace(
    regexp_replace(
        regexp_replace(lower(trim(namespace)), '[ _]+', '-', 'g'),
        '[^a-z0-9-]', '', 'g'
    ),
    '-{2,}', '-', 'g'
)
WHERE namespace IS NOT NULL
AND namespace IS DISTINCT FROM regexp_replace(
    regexp_replace(
        regexp_replace(lower(trim(namespace)), '[ _]+', '-', 'g'),
        '[^a-z0-9-]', '', 'g'
    ),
    '-{2,}', '-', 'g'
);

-- Merge orphaned truncated namespaces back into their correct names.
-- Example: 'hor' (from broken 'Thor' normalization) should merge into 'thor'.
-- This handles the specific case where the first character(s) were uppercase and got stripped.
-- We can't automatically detect all cases, but common patterns:
--   'hor' → should be 'thor' (if 'thor' exists or was the original)
-- Manual merge via admin portal (/api/v1/admin/agents/merge) recommended for edge cases.
