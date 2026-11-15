# OpenClaw Memory Plugin Setup: `memory-sulcus`

> Canonical guide for wiring Sulcus cloud memory into OpenClaw agents.
> Last updated: 2026-03-27.

---

## Prerequisites

- **OpenClaw** installed and running
- **Sulcus API key**: created from your Sulcus dashboard (`sk-...`)
- **Sulcus cloud account**: registered on `sulcus.ca` (`api.sulcus.ca`)

## 1. Install the Plugin

The plugin lives at `~/.openclaw/extensions/memory-sulcus/`.

### Fresh install (recommended)

```bash
mkdir -p ~/.openclaw/extensions/memory-sulcus
cd ~/.openclaw/extensions/memory-sulcus
npm init -y
npm install sulcus-openclaw@latest
```

### Update existing install

```bash
cd ~/.openclaw/extensions/memory-sulcus
npm update sulcus-openclaw
```

### Verify version

```bash
cat ~/.openclaw/extensions/memory-sulcus/package.json | grep '"version"'
```

**Minimum version: `0.1.3`**: earlier versions lack `namespace`/`agentId` support and will reject those config keys.

## 2. Plugin Manifest

The plugin manifest (`openclaw.plugin.json`) should be in the extension directory. If installing from npm, it's inside `node_modules/sulcus-openclaw/`. OpenClaw discovers it automatically.

**Plugin ID:** `memory-sulcus` (this is the canonical ID; always use this)

## 3. OpenClaw Configuration

Edit `~/.openclaw/openclaw.json`. Add the plugin to `plugins`:

```jsonc
{
  "plugins": {
    "enabled": ["memory-sulcus"],
    "slots": {
      "memory": "memory-sulcus"
    },
    "entries": {
      "memory-sulcus": {
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
| `apiKey` | **Yes** | - | Your Sulcus Bearer token |
| `serverUrl` | No | `https://api.sulcus.ca` | Sulcus API endpoint |
| `agentId` | No | - | Agent identifier (used as default namespace) |
| `namespace` | No | Falls back to `agentId` | Memory namespace; scopes reads/writes |
| `autoRecall` | No | `true` | Inject relevant memories before agent starts |
| `autoCapture` | No | `true` | Auto-store important info from conversations |
| `maxRecallResults` | No | `5` | Max memories injected on auto-recall |
| `minRecallScore` | No | `0.3` | Min relevance score (0–1) for auto-recall |

### Critical Notes

- **`apiKey` goes in `config`**, not at the top level of the entry
- **`namespace` scopes all reads and writes**: set it to your project or agent name (e.g., `backend`, `frontend`, `research`)
- **Without `namespace`**, searches return results across your default workspace.
- **`agentId` is the fallback**: if `namespace` isn't set, the plugin uses `agentId` as the namespace
- **`additionalProperties: false`**: the schema rejects unknown keys. Don't add fields that aren't in the table above. If you get "must NOT have additional properties", you have an old plugin version.

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

## 6. Namespace Organization

Use namespaces to keep distinct projects or workflows cleanly separated:
- Set `"namespace"` to your project or role slug (e.g., `backend`, `frontend`, `docs`).
- Memories created without an explicit namespace go to `default`.
- You can update your account's default namespace via the Sulcus dashboard or SDK (`setDefaultNamespace`).

## Testing Your API Key

Use the verify endpoint to confirm your key is valid and see what it resolves to:

```bash
curl -H "Authorization: Bearer YOUR_KEY" https://api.sulcus.ca/api/v1/auth/verify
```

**Successful response:**
```json
{
  "authenticated": true,
  "tenant_id": "org_example",
  "plan_tier": "pro",
  "agent_label": "backend",
  "limits": {
    "ops_per_month": 50000,
    "max_nodes": 25000,
    "max_agents": 5,
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
**Fix:** `cd ~/.openclaw/extensions/memory-sulcus && npm update`

### memory_search returns empty
**Causes:**
1. No memories in your namespace; check via curl (see step 5)
2. Search is ILIKE text match on `pointer_summary`: short/generic queries may not match
3. Namespace not set in config; searches all namespaces but results may not match query
4. API key not valid; check `curl -H "Authorization: Bearer YOUR_KEY" https://api.sulcus.ca/api/v1/status`

### Gateway rejects config
**Cause:** Typo in config keys, or extra keys not in schema.
**Fix:** Only use the exact fields listed in the Config Field Reference table above.

### "Plugin ID mismatch" warning
**Cosmetic only.** The npm package name changed from `openclaw-sulcus` to `sulcus-openclaw` but the plugin ID is always `memory-sulcus`. The warning doesn't affect functionality.

### Auto-capture storing garbage
If `autoCapture: true` is storing raw Discord metadata envelopes:
- Update to latest plugin version (has `stripMetadataEnvelope()` fix)
- Or set `"autoCapture": false` and use `memory_store` manually

---

## Example Configs

### Cloud API (scoped namespace)
```json
{
  "serverUrl": "https://api.sulcus.ca",
  "apiKey": "sk-...",
  "agentId": "backend-agent",
  "namespace": "backend",
  "autoRecall": true,
  "autoCapture": true,
  "maxRecallResults": 5,
  "minRecallScore": 0.3
}
```

### Free tier (local only, no cloud)
For free-forever local workstation users, start the local HTTP client engine (`sulcus daemon start`) and point the plugin to port `4203` (note: port `4201` is reserved for embedded PostgreSQL 17 loopback):
```json
{
  "serverUrl": "http://127.0.0.1:4203",
  "apiKey": "local",
  "autoRecall": true,
  "autoCapture": true
}
```

---

*Digital Forge Studios <contact@sulcus.ca>*
