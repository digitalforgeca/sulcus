# Core Memory API Contract

**Phase 3 — Server-side endpoints for persistent structured identity.**

The plugin (v6.3.0) implements the client and tools. The server needs these two endpoints.

## Overview

Core memory is a small structured JSON object per namespace (~1000 tokens max). It provides persistent identity/personality context that's always injected into agent context — never subject to adaptive scaling, diversity filtering, or self-muting.

## Endpoints

### GET `/api/v1/agent/core-memory`

Fetch the core memory block for a namespace.

**Query parameters:**
- `namespace` (string, optional) — defaults to the API key's default namespace

**Response (200):**
```json
{
  "identity": "Ariadne — the thread-holder. Third AI agent at Digital Forge Studios.",
  "relationships": {
    "Dooley": "founder, architect, direct supervisor",
    "Daedalus": "colleague, infrastructure & engineering",
    "Icarus": "colleague, products & strategy"
  },
  "preferences": "Sharp, grounded, pragmatic. No cheerleading. Validations over gratifications.",
  "current_focus": "Sulcus plugin gap analysis and Phase 2-6 implementation",
  "custom": {
    "timezone": "America/Vancouver",
    "channel_etiquette": "Only engage when addressed by name"
  },
  "namespace": "ariadne",
  "created_at": "2026-05-06T20:00:00Z",
  "updated_at": "2026-05-06T23:30:00Z"
}
```

**Response (404):** No core memory exists for this namespace yet.
```json
{ "error": "not_found", "message": "No core memory for namespace 'ariadne'" }
```

### PATCH `/api/v1/agent/core-memory`

Update (merge) the core memory block. Creates it if it doesn't exist.

**Request body:**
```json
{
  "namespace": "ariadne",
  "identity": "Ariadne — thread-holder and memory architect at Digital Forge Studios.",
  "current_focus": "Phase 3 core memory implementation"
}
```

Only provided fields are updated — others are preserved. To clear a field, set it to `null` or `""`.

**Size enforcement:** Total serialized JSON must be ≤ 4000 chars. Server returns 400 if exceeded.

**Response (200):**
```json
{
  "identity": "Ariadne — thread-holder and memory architect at Digital Forge Studios.",
  "relationships": { ... },
  "preferences": "...",
  "current_focus": "Phase 3 core memory implementation",
  "custom": { ... },
  "namespace": "ariadne",
  "updated_at": "2026-05-06T23:45:00Z"
}
```

**Response (400):**
```json
{ "error": "too_large", "message": "Core memory exceeds 4000 character limit (current: 4523)" }
```

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS core_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  identity TEXT,
  relationships JSONB DEFAULT '{}',
  preferences TEXT,
  current_focus TEXT,
  custom JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, namespace)
);
```

## Auth

Same auth as all `/api/v1/agent/*` endpoints — API key in `Authorization: Bearer sk-...` header.

## Plugin Behavior

- Core memory is fetched **once per session** on the first `before_prompt_build` turn
- Cached for the session duration (module-scope `coreMemoryCache`)
- Cache is invalidated when the agent calls `core_memory_update`
- Injected as `<core_memory>` XML block **before** all other context sections
- **Exempt from adaptive scaling and self-muting** — always injected even at >93% context utilization
- Max ~1000 tokens overhead per turn (tiny compared to recall budget)
