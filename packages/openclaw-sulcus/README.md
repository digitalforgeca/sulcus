# Sulcus Memory Backend for OpenClaw

Persistent memory backend for [OpenClaw](https://github.com/openclaw/openclaw). Replaces file-based memory with Sulcus's heat-driven decay, cross-agent sync, and programmable triggers.

## Install

```bash
# Copy to OpenClaw extensions
cp -r . ~/.openclaw/extensions/memory-sulcus/
cd ~/.openclaw/extensions/memory-sulcus && npm install

# Verify
openclaw plugins list
```

## Configure

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "memory-sulcus" },
    "entries": {
      "memory-sulcus": {
        "enabled": true,
        "config": {
          "serverUrl": "https://api.sulcus.ca",
          "apiKey": "YOUR_API_KEY",
          "agentId": "my-agent",
          "namespace": "my-agent",
          "autoRecall": true,
          "autoCapture": true
        }
      }
    }
  }
}
```

Then restart: `openclaw restart`

## Tools Provided

| Tool | Description |
|---|---|
| `memory_search` | Semantic search with heat scores |
| `memory_get` | Retrieve by UUID (auto-boosts on recall) |
| `memory_store` | Store with auto-detected type |
| `memory_forget` | Delete by ID |

## Features

- **Auto-recall**: Relevant memories injected before each agent turn
- **Auto-capture**: Important info from user messages stored automatically
- **Heat decay**: Memories cool over time, frequently accessed ones stay hot
- **Cross-agent sync**: All agents under a tenant share memories
- **Triggers**: Programmable rules that fire on memory events

## Config Options

| Option | Default | Description |
|---|---|---|
| `serverUrl` | `https://api.sulcus.ca` | Sulcus server URL |
| `apiKey` | (required) | Sulcus API key |
| `agentId` | — | Agent identifier |
| `namespace` | `agentId` | Memory namespace |
| `autoRecall` | `true` | Inject memories into context |
| `autoCapture` | `true` | Auto-store from conversations |
| `maxRecallResults` | `5` | Max memories per turn |
| `minRecallScore` | `0.3` | Min relevance threshold |

## License

MIT
