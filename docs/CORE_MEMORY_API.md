# Core Memory API

**Server-side endpoints for persistent structured identity.**

The plugin implements the client and tools against these two endpoints.

## Overview

Core memory is a small structured JSON object per namespace (~1000 tokens max). It provides persistent identity/personality context that's always injected into agent context; never subject to adaptive scaling, diversity filtering, or self-muting.

## Endpoints

### Read Core Memory

`GET /api/v1/agent/core-memory`

Fetch the core memory block for a namespace.

**Query parameters:**
- `namespace` (string, optional): defaults to the API key's default namespace

**Response (200):**
```json
{
  "identity": "Atlas; senior backend engineering assistant.",
  "relationships": {
    "Alice": "tech lead, primary reviewer",
    "Bob": "platform engineer, database owner"
  },
  "preferences": "Sharp, grounded, pragmatic. Prefer small, tested diffs.",
  "current_focus": "Core memory API integration and schema validation",
  "custom": {
    "timezone": "America/Vancouver",
    "test_runner": "pytest"
  },
  "namespace": "backend-agent",
  "created_at": "2026-05-06T20:00:00Z",
  "updated_at": "2026-05-06T23:30:00Z"
}
```

**Response (404):** No core memory exists for this namespace yet.
```json
{ "error": "not_found", "message": "No core memory for namespace 'backend-agent'" }
```

### Update Core Memory

`PATCH /api/v1/agent/core-memory`

Update (merge) the core memory block. Creates it if it doesn't exist.

**Request body:**
```json
{
  "namespace": "backend-agent",
  "identity": "Atlas; backend and API reliability assistant.",
  "current_focus": "Phase 3 core memory implementation"
}
```

Only provided fields are updated; others are preserved. To clear a field, set it to `null` or `""`.

**Size enforcement:** Total serialized JSON must be ≤ 4000 chars. Server returns 400 if exceeded.

**Response (200):**
```json
{
  "identity": "Atlas; backend and API reliability assistant.",
  "relationships": { ... },
  "preferences": "...",
  "current_focus": "Phase 3 core memory implementation",
  "custom": { ... },
  "namespace": "backend-agent",
  "updated_at": "2026-05-06T23:45:00Z"
}
```

**Response (400):**
```json
{ "error": "too_large", "message": "Core memory exceeds 4000 character limit (current: 4523)" }
```

## Auth

Same auth as all `/api/v1/agent/*` endpoints; API key in `Authorization: Bearer sk-...` header.

## Plugin Behavior

- Core memory is fetched **once per session** on the first `before_prompt_build` turn
- Cached for the session duration (module-scope `coreMemoryCache`)
- Cache is invalidated when the agent calls `core_memory_update`
- Injected as `<core_memory>` XML block **before** all other context sections
- **Exempt from adaptive scaling and self-muting**: always injected even at >93% context utilization
- Max ~1000 tokens overhead per turn (tiny compared to recall budget)
