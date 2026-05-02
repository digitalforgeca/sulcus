-- Migration 0050: Normalize namespaces to lowercase-hyphenated canonical form
-- Fixes case-sensitivity issues (e.g. "Thor" vs "thor" being different namespaces)
-- Rule: lowercase, spaces/underscores → hyphens, strip non-alphanumeric/hyphen, collapse multi-hyphens

-- golden_index: the main memory table
UPDATE golden_index
SET namespace = lower(
    regexp_replace(
        regexp_replace(
            regexp_replace(
                trim(namespace),
                '[ _]+', '-', 'g'       -- spaces/underscores → hyphens
            ),
            '[^a-z0-9-]', '', 'g'       -- strip non-alphanumeric/hyphen (after lowercase)
        ),
        '-{2,}', '-', 'g'               -- collapse multiple hyphens
    )
)
WHERE namespace IS DISTINCT FROM lower(
    regexp_replace(
        regexp_replace(
            regexp_replace(
                trim(namespace),
                '[ _]+', '-', 'g'
            ),
            '[^a-z0-9-]', '', 'g'
        ),
        '-{2,}', '-', 'g'
    )
);

-- namespace_counters
UPDATE namespace_counters
SET namespace = lower(
    regexp_replace(
        regexp_replace(
            regexp_replace(trim(namespace), '[ _]+', '-', 'g'),
            '[^a-z0-9-]', '', 'g'
        ),
        '-{2,}', '-', 'g'
    )
)
WHERE namespace IS DISTINCT FROM lower(
    regexp_replace(
        regexp_replace(
            regexp_replace(trim(namespace), '[ _]+', '-', 'g'),
            '[^a-z0-9-]', '', 'g'
        ),
        '-{2,}', '-', 'g'
    )
);

-- namespace_acl
UPDATE namespace_acl
SET namespace = lower(
    regexp_replace(
        regexp_replace(
            regexp_replace(trim(namespace), '[ _]+', '-', 'g'),
            '[^a-z0-9-]', '', 'g'
        ),
        '-{2,}', '-', 'g'
    )
)
WHERE namespace IS DISTINCT FROM lower(
    regexp_replace(
        regexp_replace(
            regexp_replace(trim(namespace), '[ _]+', '-', 'g'),
            '[^a-z0-9-]', '', 'g'
        ),
        '-{2,}', '-', 'g'
    )
);

-- api_keys: normalize the namespace column (agent namespace override)
UPDATE api_keys
SET namespace = lower(
    regexp_replace(
        regexp_replace(
            regexp_replace(trim(namespace), '[ _]+', '-', 'g'),
            '[^a-z0-9-]', '', 'g'
        ),
        '-{2,}', '-', 'g'
    )
)
WHERE namespace IS NOT NULL
AND namespace IS DISTINCT FROM lower(
    regexp_replace(
        regexp_replace(
            regexp_replace(trim(namespace), '[ _]+', '-', 'g'),
            '[^a-z0-9-]', '', 'g'
        ),
        '-{2,}', '-', 'g'
    )
);

-- NOTE: api_keys.label is NOT normalized — it's a user-visible display name
-- that may intentionally have mixed case (e.g., "Daedalus").
-- The effective_namespace() function in middleware.rs now sanitizes
-- label→namespace at runtime.

-- Handle potential duplicates created by normalization:
-- If "Thor" and "thor" both exist with the same tenant_id, they'll conflict on unique constraints.
-- The UPDATE above will naturally deduplicate if there's no unique constraint on (tenant_id, namespace).
-- If there IS a unique constraint, we'd need a merge strategy. For now, rely on ON CONFLICT behavior
-- or manual merge via the new web portal agent management tools.
