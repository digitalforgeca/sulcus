# OpenClaw Memory Plugin Setup — `openclaw-sulcus`

> Canonical guide for wiring Sulcus cloud memory into OpenClaw agents.
> Last updated: 2026-06-11.

---

## Prerequisites

- **OpenClaw** installed and running
- **Sulcus API key** — provided by a tenant admin. Format: `<label>-sulcus-<hex>`
- **Sulcus cloud account** — your key must be registered under a tenant on `api.sulcus.ca`

## 1. Install the Plugin

The plugin lives at `~/.openclaw/extensions/openclaw-sulcus/`.

### Fresh install (recommended)

```bash
mkdir -p ~/.openclaw/extensions/openclaw-sulcus
cd ~/.openclaw/extensions/openclaw-sulcus
npm init -y
npm install @digitalforgestudios/openclaw-sulcus@latest
```

### Update existing install

```bash
cd ~/.openclaw/extensions/openclaw-sulcus
npm update @digitalforgestudios/openclaw-sulcus
```

### Verify version

```bash
cat ~/.openclaw/extensions/openclaw-sulcus/package.json | grep '"version"'
```

**Minimum version: `7.2.0`** — v7.x is a major rewrite. Key improvements over v0.x (`memory-sulcus`):
- Namespace ACL enforcement (restrict agent reads/writes by namespace)
- SILU per-agent classification config
- Trigger creation from the plugin
- Fold/consolidation support (merge similar memories)
- Context Engine integration (`autoRecall` uses multi-signal recall: hot nodes + semantic + graph neighbors)

## 2. Plugin Manifest

The plugin manifest (`openclaw.plugin.json`) should be in the extension directory. If installing from npm, it's inside `node_modules/@digitalforgestudios/openclaw-sulcus/`. OpenClaw discovers it automatically.

**Plugin ID:** `openclaw-sulcus` (this is the canonical ID — always use this)

## 3. OpenClaw Configuration

Edit `~/.openclaw/openclaw.json`. Add the plugin to `plugins`:

```jsonc
{
  "plugins": {
    "enabled": ["openclaw-sulcus"],
    "slots": {
      "memory": "openclaw-sulcus"
    },
    "entries": {
      "openclaw-sulcus": {
        "enabled": true,
        "hooks": {
          "allowPromptInjection": true
        },
        "config": {
          "serverUrl": "https://api.sulcus.ca",
          "apiKey": "YOUR-API-KEY-HERE",
          "agentId": "your-agent-name",
          "namespace": "your-agent-name",
          "autoRecall": true,
          "autoCapture": true,
          "maxRecallResults": 5,
          "minRecallScore": 0.3
        }
      }
    }
  }
}
```

### Config Field Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `apiKey` | **Yes** | — | Your Sulcus Bearer token |
| `serverUrl` | No | `https://api.sulcus.ca` | Sulcus API endpoint |
| `agentId` | No | — | Agent identifier (used as default namespace) |
| `namespace` | No | Falls back to `agentId` | Memory namespace — scopes reads/writes |
| `autoRecall` | No | `true` | Inject relevant memories before agent starts |
| `autoCapture` | No | `true` | Auto-store important info from conversations |
| `maxRecallResults` | No | `5` | Max memories injected on auto-recall |
| `minRecallScore` | No | `0.3` | Min relevance score (0–1) for auto-recall |

### Critical Notes

- **`apiKey` goes in `config`**, not at the top level of the entry
- **`namespace` scopes all reads and writes** — set it to your agent name (e.g., `daedalus`, `icarus`, `ariadne`)
- **Without `namespace`**, searches return results from ALL namespaces in the tenant. This is fine for cross-pollination but may return irrelevant results.
- **`agentId` is the fallback** — if `namespace` isn't set, the plugin uses `agentId` as the namespace
- **`additionalProperties: false`** — the schema rejects unknown keys. Don't add fields that aren't in the table above. If you get "must NOT have additional properties", you have an old plugin version.

## 4. Restart Gateway

After editing `openclaw.json`:

```bash
openclaw gateway restart
```

Or from within a session: use the `gateway` tool with `action: restart`.

## 5. Verify

In a chat session, test:

```
memory_search("test query")
```

If working, you'll see results with heat scores. If empty:
- Check that your namespace has memories: `curl -s -H "Authorization: Bearer YOUR_KEY" "https://api.sulcus.ca/api/v1/agent/search" -X POST -H "Content-Type: application/json" -d '{"query":"test","limit":5}'`
- Check namespace filter: add `"namespace":"your-namespace"` to the JSON body
- Check gateway logs: `~/.openclaw/logs/`

## 6. Multi-Agent / Enterprise Setup

For teams with multiple agents under one tenant:

### API Keys
Each agent gets its own API key with a `label` field:
- `daedalus` key → label `daedalus`
- `icarus` key → label `icarus`
- `ariadne` key → label `ariadne`

The label is used server-side for **Namespace ACL** enforcement.

### Namespace ACL
The server can restrict which agent reads/writes which namespaces:
- **Default policy: `allow`** — all agents can see all namespaces (cross-pollination)
- To restrict: create ACL rules via `POST /api/v1/namespaces/acl`
- Dashboard: **Agents** page shows current ACL rules

### Namespace Convention
- Use the agent name as the namespace: `daedalus`, `icarus`, `ariadne`
- Memories created without explicit namespace go to `default`
- The `default` namespace is shared — all agents can read it

## Testing Your API Key

Use the verify endpoint to confirm your key is valid and see what it resolves to:

```bash
curl -H "Authorization: Bearer YOUR_KEY" https://api.sulcus.ca/api/v1/auth/verify
```

**Successful response:**
```json
{
  "authenticated": true,
  "tenant_id": "dooley",
  "plan_tier": "enterprise",
  "agent_label": "icarus",
  "limits": {
    "ops_per_month": "unlimited",
    "max_nodes": "unlimited",
    "max_agents": 10,
    "max_sync_requests": "unlimited"
  },
  "features": ""
}
```

**Invalid key:** Returns `401 Unauthorized`

**No key:** Returns `404` (the route requires authentication)

Use this **before** configuring the plugin to confirm your key works against the API.

## Troubleshooting

### "must NOT have additional properties"
**Cause:** Plugin version too old. `namespace`/`agentId` fields not in schema.
**Fix:** `cd ~/.openclaw/extensions/openclaw-sulcus && npm update`

### memory_search returns empty
**Causes:**
1. No memories in your namespace — check via curl (see step 5)
2. Search is ILIKE text match on `pointer_summary` — short/generic queries may not match
3. Namespace not set in config — searches all namespaces but results may not match query
4. API key not valid — check `curl -H "Authorization: Bearer YOUR_KEY" https://api.sulcus.ca/api/v1/status`

### Gateway rejects config
**Cause:** Typo in config keys, or extra keys not in schema.
**Fix:** Only use the exact fields listed in the Config Field Reference table above.

### "Plugin ID mismatch" warning
**Cosmetic only.** If upgrading from the old `@digitalforgestudios/memory-sulcus` package, you may see this once. The canonical plugin ID is now `openclaw-sulcus`. Re-run the fresh install steps above to resolve.

### Auto-capture storing garbage
If `autoCapture: true` is storing raw Discord metadata envelopes:
- Update to latest plugin version (has `stripMetadataEnvelope()` fix)
- Or set `"autoCapture": false` and use `memory_store` manually

---

## Example Configs

### Daedalus (enterprise, scoped namespace)
```json
{
  "serverUrl": "https://api.sulcus.ca",
  "apiKey": "daedalus-sulcus-...",
  "agentId": "daedalus",
  "namespace": "daedalus",
  "autoRecall": true,
  "autoCapture": true,
  "maxRecallResults": 5,
  "minRecallScore": 0.3
}
```

### Icarus (enterprise, scoped namespace)
```json
{
  "serverUrl": "https://api.sulcus.ca",
  "apiKey": "icarus-sulcus-...",
  "agentId": "icarus",
  "namespace": "icarus",
  "autoRecall": true,
  "autoCapture": true,
  "maxRecallResults": 5,
  "minRecallScore": 0.3
}
```

### Free tier (local only, no cloud)
For free tier users, the plugin talks to a local `sulcus` binary:
```json
{
  "serverUrl": "http://127.0.0.1:4201",
  "apiKey": "local",
  "autoRecall": true,
  "autoCapture": true
}
```

---

*Digital Forge Studios <contact@sulcus.ca>*
