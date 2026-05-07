# UX Parity Spec — Phase 3-6 Feature Exposure

After the plugin grew from 15 → 26 tools (Phases 1-6), the three UX surfaces need updates
to expose the new capabilities: config file, local control panel, and cloud portal.

## Surfaces

| Surface | Location | Owner | Format |
|---------|----------|-------|--------|
| Config file | `crates/sulcus/src/config.rs` | Ariadne (Rust) | INI `[sulcus]` section |
| Local panel | `crates/sulcus/src/panel.html` | Ariadne (HTML/JS) | Single-file SPA, 1352 lines |
| Local API | `crates/sulcus/src/local_api.rs` + `runtime.rs` | Ariadne (Rust) | axum routes |
| Cloud portal | sulcus.ca (Azure CDN, 38 static HTML pages) | Daedalus | Separate repo |

This spec covers the first three. Cloud portal parity is tracked separately for Daedalus.

---

## Task A — Config File Expansion

**File:** `crates/sulcus/src/config.rs`

Add 6 new fields to the `Config` struct and parser:

```ini
[sulcus]
# Existing fields...
database_url = postgres://sulcus@127.0.0.1:15432/sulcus
server_url = https://api.sulcus.ca
server_api_key = sk-...

# NEW: Agent namespace (default: "default")
namespace = ariadne

# NEW: Core memory — persistent identity block
core_memory_enabled = true

# NEW: Episode capture — structured session recording
episode_capture = true

# NEW: Auto-recall — inject memories into context on each turn
auto_recall = true

# NEW: Auto-capture — store conversation summaries on session end
auto_capture = true

# NEW: Consolidation schedule (off | daily | weekly)
consolidation_schedule = daily
```

**Implementation:**
- Add fields to `Config` struct: `namespace`, `core_memory_enabled`, `episode_capture`,
  `auto_recall`, `auto_capture`, `consolidation_schedule`
- Add parsing in `from_path()` match arms
- Add accessor methods with defaults
- Add tests for new fields
- **No breaking changes** — all new fields are `Option<T>` with sensible defaults

---

## Task B — Local Panel: Core Memory Section

**File:** `crates/sulcus/src/panel.html`

Add a **Core Memory** section to the Settings tab, after the SIU section.

### Layout
```
## Core Memory — Persistent Identity Block

[identity]     textarea, 3 rows
[relationships] textarea, 3 rows  
[preferences]  textarea, 2 rows
[current_focus] text input
[custom]       textarea (JSON), 3 rows

[Save Core Memory] [Clear] [Status message]
```

### API
- **Load:** `GET /api/v1/agent/core-memory` (needs new local API endpoint)
- **Save:** `PATCH /api/v1/agent/core-memory` (needs new local API endpoint)

### New Local API Endpoints Needed
```rust
// GET /api/v1/agent/core-memory
pub async fn get_core_memory(State(state): State<Arc<AppState>>) -> Json<Value>
// Returns core memory JSON from `core_memory` table (or empty object if none exists)

// PATCH /api/v1/agent/core-memory  
pub async fn patch_core_memory(State(state): State<Arc<AppState>>, Json(body): Json<Value>) -> Result<Json<Value>, StatusCode>
// Upserts core memory fields. Enforces 4000 char limit.
```

### Database
```sql
CREATE TABLE IF NOT EXISTS core_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace TEXT NOT NULL DEFAULT 'default',
  identity TEXT,
  relationships TEXT,
  preferences TEXT,
  current_focus TEXT,
  custom JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (namespace)
);
```

---

## Task C — Local Panel: Episode Viewer

**File:** `crates/sulcus/src/panel.html`

### Option 1 (simpler): Add "episode" to existing Browse tab
- Add `episode` to type filter pills
- Add `episode` to Create Memory type dropdown
- When an episode node is clicked, render structured metadata (topic, decisions, files, mood, outcome, duration)

### Option 2 (richer): Dedicated Episodes sub-section in Browse
- New filter mode: "Episodes" pill that auto-filters to episodic + shows timeline view
- Episode cards with mood emoji, duration badge, outcome status

**Recommendation:** Option 1 — minimal change, high value.

---

## Task D — Local Panel: Namespace Switcher

**File:** `crates/sulcus/src/panel.html`

### In header bar (next to LOCAL MODE badge):
```html
<select id="active-ns" onchange="switchNamespace(this.value)">
  <option value="">All namespaces</option>
  <!-- Populated from dashboard_stats.namespace_counts -->
</select>
```

### Behavior:
- Populated on page load from existing `/api/v1/admin/dashboard` response (already has `namespace_counts`)
- When changed, filters Browse tab, Recent Memories, and Hot Nodes to that namespace
- Stored in `localStorage` for persistence across refreshes
- "All namespaces" shows everything (current behavior)

### No new API needed — data already available.

---

## Task E — Local Panel: Consolidate Now Button

**File:** `crates/sulcus/src/panel.html`

### In Overview tab, after the "Hottest Nodes" section:
```html
<div class="section">
  <div class="section-header">
    <h2>Maintenance</h2>
  </div>
  <button class="btn primary" onclick="runConsolidation()">Consolidate Now</button>
  <span id="consolidate-status"></span>
  <p class="sub">Merge related cold memories, reduce noise. Runs against nodes below the cold threshold.</p>
</div>
```

### New Local API Endpoint Needed
```rust
// POST /api/v1/agent/consolidate
pub async fn consolidate(State(state): State<Arc<AppState>>, Json(body): Json<Value>) -> Result<Json<Value>, StatusCode>
// Triggers consolidation pass. Body: { "min_heat": 0.1 }
// Returns: { "ok": true, "merged": 5, "removed": 12 }
```

---

## Task F — Local Panel: Episode Type Parity

Ensure "episode" appears everywhere other types appear:

1. **TYPE_COLORS** JS object — add `episode: '#10b981'` (green tint, distinct from episodic purple)
2. **Create Memory** dropdown — add `<option value="episode">Episode — session summary</option>`
3. **Browse filter pills** — add episode pill
4. **Detail panel** — when `memory_type === 'episode'` or metadata has episode fields, render structured view

Wait — actually episodes use `memory_type: "episodic"` (same as regular episodic memories), distinguished by content pattern "Session episode:". So no new type needed in filters. The structured metadata display in the detail panel is what matters.

---

## Execution Order

| # | Task | Scope | Effort | Dependencies |
|---|------|-------|--------|--------------|
| A | Config expansion | Rust (`config.rs`) | ~1h | None |
| B | Core Memory UI | HTML/JS (`panel.html`) + Rust (`local_api.rs`, `runtime.rs`) | ~2h | New DB table + API endpoints |
| C | Episode viewer | HTML/JS (`panel.html`) | ~30min | None (uses existing nodes API) |
| D | Namespace switcher | HTML/JS (`panel.html`) | ~30min | None (uses existing dashboard API) |
| E | Consolidate button | HTML/JS (`panel.html`) + Rust (`local_api.rs`, `runtime.rs`) | ~1h | New API endpoint |
| F | Portal parity spec | Markdown | ~30min | None — handed to Daedalus |

**Can be parallelized:** A, C, D can start immediately.  
**Sequential:** B needs DB migration → API endpoints → UI.  
**E** needs API endpoint → UI.

---

## Portal Parity (Daedalus)

Cloud portal (sulcus.ca) needs the same features exposed in its React-equivalent pages.
Since the portal is 38 static HTML pages on Azure CDN and lives outside this repo,
Daedalus should reference this spec and add equivalent UI for:

- Core Memory editor (Settings or dedicated page)
- Episode viewer (Browse/Memory page)
- Namespace switcher (global header)
- Consolidate button (Dashboard or Settings)

The cloud server already has `/api/v1/agent/core-memory` in the contract
(`docs/CORE_MEMORY_API.md`). The portal just needs to call it.
