# Sulcus × OpenClaw Setup Guide

> Hard-won configuration notes from production deployment (2026-03-08).
> This document captures every gotcha encountered wiring Sulcus into OpenClaw
> so future setups don't repeat the same mistakes.

## Overview

Sulcus integrates with OpenClaw as a **memory plugin** (`openclaw-sulcus`). It replaces the
built-in `memory-core` backend with a thermodynamic graph-based memory system backed by
PostgreSQL.

## Prerequisites

- OpenClaw `>= 2026.2.24`
- `sulcus` binary built and accessible (either in `$PATH` or via absolute path)
- PostgreSQL running (or use sulcus's embedded PG mode)

---

## openclaw.json Configuration

### 1. Provider Setup (Azure Foundry via Anthropic Messages API)

The Azure AI Foundry endpoint uses the **Anthropic wire format** (`/anthropic/v1/messages`),
NOT the OpenAI-compatible format. This means:

```json
"models": {
  "providers": {
    "anthropic:foundry": {
      "baseUrl": "https://<resource>.services.ai.azure.com/anthropic/v1",
      "apiKey": "<your-api-key>",
      "api": "anthropic-messages",
      "models": [
        { "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6" },
        { "id": "claude-opus-4-6", "name": "Claude Opus 4.6" }
      ]
    }
  }
}
```

#### ⚠️ CRITICAL: `"api": "anthropic-messages"`

Without this field, OpenClaw uses the built-in Anthropic provider which makes a
**preflight `GET /models`** request. Azure Foundry returns `404 Requested API is
currently not supported` for that endpoint. Adding `"api": "anthropic-messages"` tells
OpenClaw to use the raw messages transport (POST `{baseUrl}/messages` only) — no
preflight discovery call.

**Symptom if missing:** `404 Requested API is currently not supported` or
`Connection error` in session logs.

#### ⚠️ Auth Header

Azure Foundry Anthropic endpoints require `x-api-key` (Anthropic-style), NOT `api-key`
(Azure-style). The `anthropic-messages` API transport sends the correct header. Confirmed:
- `x-api-key: <key>` → 200 ✅
- `api-key: <key>` → 401 ❌

#### ⚠️ No auth profile needed

When the `apiKey` is inline in the provider config, do NOT add an `auth.profiles` entry
for it. OpenClaw's config validator rejects `mode: "api-key"` for Anthropic-type profiles.
Just leave `auth.profiles` empty:

```json
"auth": { "profiles": {} }
```

### 2. Model Allowlist

Both models must appear in `agents.defaults.models` for session overrides to work:

```json
"agents": {
  "defaults": {
    "model": {
      "primary": "anthropic:foundry/claude-opus-4-6",
      "fallbacks": ["anthropic:foundry/claude-sonnet-4-6"]
    },
    "models": {
      "anthropic:foundry/claude-opus-4-6": {},
      "anthropic:foundry/claude-sonnet-4-6": {}
    }
  }
}
```

#### ⚠️ `"fallbacks"` is plural and an array

- ✅ `"fallbacks": ["anthropic:foundry/claude-sonnet-4-6"]`
- ❌ `"fallback": "anthropic:foundry/claude-sonnet-4-6"` → `agents.defaults.model: Invalid input`

#### ⚠️ Model IDs in the provider `models[]` array are bare

Inside `models.providers.<name>.models[]`, use just the model ID:
- ✅ `{ "id": "claude-sonnet-4-6" }`
- ❌ `{ "id": "anthropic:foundry/claude-sonnet-4-6" }`

The full `provider/model` path is only used in `agents.defaults.model.primary`,
`fallbacks`, heartbeat model, and `agents.defaults.models` keys.

### 3. Heartbeat / Cron Model

Use Sonnet for heartbeats (cost-efficient), Opus for interactive sessions:

```json
"heartbeat": {
  "every": "30m",
  "model": "anthropic:foundry/claude-sonnet-4-6"
}
```

### 4. Memory Plugin Configuration

#### ⚠️ Do NOT set `memory.backend`

As of OpenClaw 2026.2.24, the `memory.backend` field validation runs before plugin
schemas are loaded. Setting `"backend": "sulcus"` causes:

```
Invalid config: memory.backend: Invalid input
```

Instead, route memory via `plugins.slots.memory`:

```json
"memory": {
  "citations": "on"
},
"plugins": {
  "enabled": true,
  "allow": ["openclaw-sulcus", "whatsapp", "googlechat"],
  "slots": {
    "memory": "openclaw-sulcus"
  },
  "entries": {
    "openclaw-sulcus": { "enabled": true },
    "memory-core": { "enabled": true }
  }
}
```

#### Key points:

- **`plugins.allow`** must include `"openclaw-sulcus"` — without it, the plugin
  loads but shows a warning: `plugins.allow is empty; discovered non-bundled plugins
  may auto-load`. This can cause memory routing to silently fall back to `memory-core`.
- **`plugins.slots.memory`** is what actually routes memory operations to Sulcus.
- **Keep `memory-core` enabled** as a fallback — if Sulcus fails to start, OpenClaw
  needs a working memory backend.
- **`memory.backend` field** — leave it out entirely. The `plugins.slots.memory` field
  supersedes it.

### 5. Plugin Installation

The plugin must be installed via path reference:

```json
"plugins": {
  "installs": {
    "openclaw-sulcus": {
      "source": "path",
      "sourcePath": "/path/to/sulcus/packages/openclaw-sulcus",
      "installPath": "~/.openclaw/extensions/openclaw-sulcus",
      "version": "0.1.0"
    }
  }
}
```

---

## Azure Foundry Deployment Notes

### Claude on Sponsored Azure Subscriptions

Despite Azure docs claiming Claude requires Enterprise/MCA-E subscriptions, **Claude
models CAN be deployed on Sponsored accounts** through the Azure AI Foundry portal GUI
(https://ai.azure.com). The CLI (`az cognitiveservices`) fails with
`InvalidModelProviderData`, but the portal works.

### Deployment Checklist

1. Go to https://ai.azure.com/catalog/models/claude-opus-4-6 (or claude-sonnet-4-6)
2. Deploy via the portal GUI (not CLI)
3. The endpoint will be: `https://<resource>.services.ai.azure.com/anthropic/v1/messages`
4. Use `x-api-key` header for authentication

### Test the endpoint

```bash
curl -X POST "https://<resource>.services.ai.azure.com/anthropic/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "max_tokens": 200,
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "ping"}]
  }'
```

### Removing the Direct Anthropic API Key

To prevent accidental billing on the direct Anthropic API, purge these files:

```bash
# Clear agent-level auth
echo '{}' > ~/.openclaw/agents/main/agent/auth.json

# Clear auth profiles
cat > ~/.openclaw/agents/main/agent/auth-profiles.json << 'EOF'
{ "version": 1, "profiles": {}, "lastGood": {}, "usageStats": {} }
EOF

# Ensure openclaw.json has no anthropic:default auth profile
# auth.profiles should be: {}
```

---

## Embedded PostgreSQL

`sulcus` ships with **two embedded PG paths** — no external database required:

### 1. Pglite JS (primary, with pgvector)

When `packages/sulcus-pglite/dist/bin/pglite-server.js` exists relative to the binary's
working directory, Sulcus starts an embedded PGlite JS service (PG16) with pgvector support.

This is the default path when running from the project directory.

### 2. pg-embed (fallback, PG17, no pgvector)

If the pglite JS service is not found or fails to start, Sulcus falls back to `pg-embed`
which downloads and runs PostgreSQL 17.8.0 binaries. First run downloads ~30MB; subsequent
starts are instant.

Data directory: `~/.sulcus/local/postgres/`

#### ⚠️ Version Mismatch Recovery

If you see `FATAL: database files are incompatible with server`, the data dir was
initialized by a different PG version. Fix:

```bash
rm -rf ~/.sulcus/local/postgres/
# Next start will reinitialize with the correct PG version
```

### External Database Override

Set `SULCUS_DATABASE_URL` to bypass embedded PG entirely:

```bash
export SULCUS_DATABASE_URL="postgres://user:pass@host:5432/dbname"
```

Or configure in `sulcus.ini` (see below).

## Sulcus INI Configuration

The `sulcus` binary reads config from `sulcus.ini`. Resolution order:
1. `$SULCUS_CONFIG` env var (explicit path)
2. `<binary_dir>/../../sulcus.ini` (project root)
3. `~/.config/sulcus/sulcus.ini`

Key settings:

```ini
[sulcus]
database_url = postgres://sulcus:sulcus@127.0.0.1:5432/sulcus
active_limit = 20
therm_interval_ms = 1000
decay = 0.85
prune_threshold = 0.05
```

The `active_limit` flows from INI → `serve()` → `start_background()` → background
worker tick. This was wired through in commit `f8be8f0` (2026-03-08).

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `404 Requested API is currently not supported` | Missing `"api": "anthropic-messages"` in provider config | Add `"api": "anthropic-messages"` to the `anthropic:foundry` provider |
| `memory.backend: Invalid input` | `memory.backend` validated before plugins load | Remove `memory.backend`, use `plugins.slots.memory` instead |
| `auth.profiles.anthropic:foundry.mode: Invalid input` | Invalid auth profile mode for Anthropic | Remove the auth profile entirely; apiKey is inline in provider |
| `agents.defaults.model: Invalid input` | `"fallback"` (singular string) instead of `"fallbacks"` (array) | Use `"fallbacks": ["model-id"]` |
| `plugins.allow is empty` warning | `openclaw-sulcus` discovered but not trusted | Add `"allow": ["openclaw-sulcus"]` to plugins config |
| `Connection error` after config change | Gateway running with stale config | `openclaw gateway restart` |
| `Model "..." is not allowed` | Model not in `agents.defaults.models` allowlist | Add it to the `models` object |

---

## Reference: Minimal Working Config (excerpt)

```json
{
  "auth": { "profiles": {} },
  "models": {
    "providers": {
      "anthropic:foundry": {
        "baseUrl": "https://<your-resource>.services.ai.azure.com/anthropic/v1",
        "apiKey": "YOUR_KEY",
        "api": "anthropic-messages",
        "models": [
          { "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6" },
          { "id": "claude-opus-4-6", "name": "Claude Opus 4.6" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic:foundry/claude-opus-4-6",
        "fallbacks": ["anthropic:foundry/claude-sonnet-4-6"]
      },
      "models": {
        "anthropic:foundry/claude-opus-4-6": {},
        "anthropic:foundry/claude-sonnet-4-6": {}
      },
      "heartbeat": {
        "every": "30m",
        "model": "anthropic:foundry/claude-sonnet-4-6"
      }
    }
  },
  "memory": { "citations": "on" },
  "plugins": {
    "enabled": true,
    "allow": ["openclaw-sulcus"],
    "slots": { "memory": "openclaw-sulcus" },
    "entries": {
      "openclaw-sulcus": { "enabled": true },
      "memory-core": { "enabled": true }
    }
  }
}
```
