# Sulcus Configuration Guide

> **Classification:** This guide covers client-side configuration. Server infrastructure configuration is internal. See [CLASSIFICATION.md](../CLASSIFICATION.md).

## API Connection

All Sulcus clients connect to the managed API:

- **API endpoint:** `https://api.sulcus.ca`
- **Authentication:** API key (`Bearer sk-...`)
- **Get a key:** [sulcus.ca](https://sulcus.ca) → Dashboard → API Keys

## Client Configuration

### `sulcus` CLI

Configuration via `sulcus.ini` or environment variables:

| Variable | Description |
|---|---|
| `SULCUS_API_KEY` | Your API key |
| `SULCUS_SERVER_URL` | API endpoint (default: `https://api.sulcus.ca`) |
| `SULCUS_NAMESPACE` | Memory namespace |

### OpenClaw Plugin

```json
{
  "plugins": {
    "entries": {
      "openclaw-sulcus": {
        "config": {
          "serverUrl": "https://api.sulcus.ca",
          "apiKey": "sk-YOUR_KEY",
          "namespace": "my-agent"
        }
      }
    }
  }
}
```

### SDK Configuration

**Python:**
```python
client = Sulcus(api_key="sk-...", server_url="https://api.sulcus.ca")
```

**Node.js:**
```typescript
const client = new Sulcus({ apiKey: 'sk-...', serverUrl: 'https://api.sulcus.ca' });
```

---

*Last Updated: 2026-06-20*
