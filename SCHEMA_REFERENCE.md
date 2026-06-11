# Sulcus Schema Reference — Canonical Source of Truth

> **This file exists to prevent column name mismatches between SQL and application code.**
> Read this before writing ANY raw SQL against `golden_index` or other core tables.
> Last audited: 2026-04-04 by Daedalus. All files clean.

---

## ⚠️ The One Rule

**DB column `pointer_summary` is exposed as `label` in the API and `Node` struct.**

Any raw SQL MUST use `pointer_summary`. The struct/API rename happens in the ORM layer.
If you write `SET label =` or `WHERE label =` against `golden_index`, it WILL fail silently or error.

---

## `golden_index` — Complete Column Reference

| Column | Type | Migration | Notes |
|---|---|---|---|
| `tenant_id` | VARCHAR(64) | 0001 | PK (composite with `id`) |
| `id` | UUID | 0001 | PK. Always bind as `$N::uuid` in raw SQL |
| `pointer_summary` | TEXT | 0001 | **The memory content. API name: `label`** |
| `base_utility` | REAL | 0001 | SIU confidence score (0.0–1.0) |
| `current_heat` | REAL | 0001 | Thermodynamic heat (0.0–1.0) |
| `is_pinned` | BOOLEAN | 0001 | Exempt from decay when true |
| `updated_at` | TIMESTAMPTZ | 0001 | Last modification time. Used by decay formula. |
| `vector` | BYTEA | 0002 | **Legacy — deprecated.** Use `embedding` instead. |
| `memory_type` | TEXT | 0004 | episodic/semantic/preference/procedural/fact/synthesis |
| `modality` | TEXT | 0012 | text/image/audio/video/mixed |
| `source_mime` | TEXT | 0012 | Optional MIME type of original content |
| `namespace` | TEXT | 0012 | Agent-scoped isolation. Default: agent's label |
| `decay_class` | TEXT | 0021 | fast/normal/slow/glacial. Default: 'normal' |
| `stability` | REAL | 0021 | Decay resistance factor. Default: 1.0 |
| `min_heat` | REAL | 0021 | Floor — node won't decay below this |
| `ttl_hours` | REAL | 0021 | Auto-archive after this many hours |
| `valid_from` | TIMESTAMPTZ | 0021 | Temporal validity window start |
| `valid_until` | TIMESTAMPTZ | 0021 | Temporal validity window end |
| `is_locked` | BOOLEAN | 0027 | Prevent modification when true |
| `embedding` | vector(384) | 0031 | pgvector HNSW index. BGE-small-en-v1.5 |
| `archived_at` | TIMESTAMPTZ | 0040 | Soft delete. Non-null = archived |

---

## API ↔ DB Name Mapping

| API Field | DB Column | Direction |
|---|---|---|
| `label` | `pointer_summary` | Read (Node struct) + Write (CreateMemory body → INSERT) |
| `heat` | `current_heat` | Read + Write |
| `id` | `id` | Both. **Always use `::uuid` cast in raw SQL bindings** |
| `is_locked` | `is_locked` | Both |
| All others | Same name | Both |

---

## Raw SQL Rules

1. **Always use `pointer_summary`** — never `label`, `content`, or `text` in SQL
2. **Always use `$N::uuid`** for `id` column bindings — string-to-UUID implicit cast fails silently
3. **Always check `rows_affected() > 0`** for UPDATE/DELETE — don't assume `is_ok()` means rows changed
4. **Never reference columns that don't exist** — check this file first. `decay_class` exists but is rarely used.
5. **`updated_at` is touched by decay** — don't use it to detect "recently recalled" (use `recall_log` instead)

---

## `triggers` Table

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID string) | PK |
| `tenant_id` | TEXT | Scopes trigger ownership |
| `namespace` | TEXT | Metadata — NOT used for trigger routing |
| `name` | TEXT | Human-readable trigger name |
| `description` | TEXT | Optional |
| `event` | TEXT | on_store/on_recall/on_boost/on_decay |
| `action` | TEXT | notify/boost/pin/tag/deprecate/webhook/chain |
| `action_config` | JSONB | Action-specific params |
| `filter_memory_type` | TEXT | Optional filter |
| `filter_namespace` | TEXT | Optional filter |
| `filter_label_pattern` | TEXT | ILIKE pattern filter |
| `filter_heat_below` | REAL | Fire when heat < threshold |
| `filter_heat_above` | REAL | Fire when heat > threshold |
| `fire_count` | INTEGER | Only incremented on successful fires |
| `max_fires` | INTEGER | Optional cap |
| `cooldown_seconds` | INTEGER | Minimum gap between fires |
| `last_fired_at` | TIMESTAMPTZ | |
| `enabled` | BOOLEAN | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

## `training_signals` Table

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) | PK |
| `tenant_id` | TEXT | |
| `signal_type` | TEXT | accept/reject/reclassify |
| `predicted_type` | TEXT | What SIU predicted |
| `predicted_store` | BOOLEAN | Whether SIU said to store |
| `corrected_type` | TEXT | Human/agent correction |
| `corrected_store` | BOOLEAN | Human/agent correction |
| `content_snapshot` | TEXT | **NEVER expose via API** (PII risk) |
| `source` | TEXT | plugin/manual/auto |
| `created_at` | TIMESTAMPTZ | |

---

## `entities` Table (Migration 0041)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK, auto-generated |
| `tenant_id` | VARCHAR(64) | Scopes entity ownership |
| `namespace` | VARCHAR(64) | Scoped to agent namespace |
| `name` | TEXT | Normalized entity name (lowercase, trimmed) |
| `entity_type` | TEXT | person/organization/tool/concept/location/project/event/model/metric/other |
| `summary` | TEXT | Optional description |
| `first_seen` | TIMESTAMPTZ | When entity was first extracted |
| `last_seen` | TIMESTAMPTZ | When entity was last mentioned |
| `mention_count` | INTEGER | How many times entity has been extracted |
| **UNIQUE** | | `(tenant_id, namespace, name, entity_type)` |

## `golden_edges` — Additional Columns (Migration 0041)

| Column | Type | Notes |
|---|---|---|
| `source_memory_id` | UUID | Provenance: which memory produced this edge |
| `relationship_label` | TEXT | Verb phrase describing the relationship |
| `extracted_at` | TIMESTAMPTZ | When LLM extracted this edge |

**Edge types:**
- `temporal_proximity` — heuristic (existing worker)
- `extracted` — LLM-based entity/relationship extraction (GPT-5.4-nano)

---

## Audit Checklist (Run Before Every Deployment)

- [ ] `grep -rn "SET label\|WHERE label" crates/sulcus-server/src/` — should return 0 golden_index hits
- [ ] `grep -rn "WHERE id = \$" crates/sulcus-server/src/` — all should use `::uuid`
- [ ] `grep -rn "content_snapshot" crates/sulcus-server/src/` — never in API response bodies
- [ ] `grep -rn "success: result.is_ok()" crates/sulcus-server/src/` — should be 0 (use rows_affected)

---

_The craftsman who lies about his measurements builds crooked walls._
