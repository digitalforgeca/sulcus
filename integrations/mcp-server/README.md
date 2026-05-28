# sulcus-mcp

MCP server for [Sulcus](https://sulcus.ca) — Thermodynamic Memory for AI Agents.

Give any MCP-compatible client persistent, intelligent memory. Single static binary, no runtime dependencies.

## Quick Start

```bash
# Install
cargo install sulcus-mcp

# Set your API key
export SULCUS_API_KEY=sk-your-api-key-here

# Run with stdio (Claude Desktop, Cursor, etc.)
sulcus-mcp

# Run with Streamable HTTP (remote agents, MAF)
sulcus-mcp --http --port 3100
```

Get an API key at [sulcus.ca/dashboard/settings](https://sulcus.ca/dashboard/settings).

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "sulcus-mcp",
      "env": {
        "SULCUS_API_KEY": "sk-your-api-key-here"
      }
    }
  }
}
```

## Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "sulcus-mcp",
      "env": {
        "SULCUS_API_KEY": "sk-your-api-key-here"
      }
    }
  }
}
```

## VS Code (GitHub Copilot)

Add to `.vscode/settings.json`:

```json
{
  "mcp": {
    "servers": {
      "sulcus": {
        "type": "stdio",
        "command": "sulcus-mcp",
        "env": {
          "SULCUS_API_KEY": "sk-your-api-key-here"
        }
      }
    }
  }
}
```

## HTTP Mode (Remote)

For web agents, MAF, or multi-tenant deployments:

```bash
sulcus-mcp --http --port 3100 --host 0.0.0.0
```

In production, place behind Traefik for TLS and auth:

```yaml
# traefik dynamic config
http:
  routers:
    sulcus-mcp:
      rule: "Host(`mcp.sulcus.ca`)"
      service: sulcus-mcp
      tls:
        certResolver: letsencrypt
  services:
    sulcus-mcp:
      loadBalancer:
        servers:
          - url: "http://sulcus-mcp:3100"
```

## Tools (19)

### Core Memory
| Tool | Description |
|------|-------------|
| `sulcus_remember` | Store a memory (facts, preferences, decisions, events) |
| `sulcus_search` | Semantic + full-text search across memories |
| `sulcus_list` | Browse memories with filters (type, namespace, pinned) |
| `sulcus_forget` | Permanently delete a memory |
| `sulcus_update` | Update memory fields (preserves history and graph edges) |

### Heat (Thermodynamic)
| Tool | Description |
|------|-------------|
| `sulcus_boost` | Increase a memory's heat (surfaces more often) |
| `sulcus_deprecate` | Decrease a memory's heat (surfaces less often) |
| `sulcus_hot_nodes` | List the hottest memories (what's top-of-mind) |

### Context Assembly
| Tool | Description |
|------|-------------|
| `sulcus_build_context` | Token-budgeted context block for prompt injection |
| `sulcus_auto_recall` | Full auto-recall with graph expansion + hot nodes |
| `sulcus_auto_capture` | SIU-gated fire-and-forget capture |

### Knowledge Graph
| Tool | Description |
|------|-------------|
| `sulcus_relate` | Create relationships between memories |
| `sulcus_graph_traverse` | Walk the knowledge graph from any memory |

### Reactive Triggers
| Tool | Description |
|------|-------------|
| `sulcus_create_trigger` | Create triggers on memory events |
| `sulcus_list_triggers` | List active triggers |
| `sulcus_delete_trigger` | Remove a trigger |

### Intelligence
| Tool | Description |
|------|-------------|
| `sulcus_classify` | SIU v2 quality gate — classify text before storing |
| `sulcus_scan_pii` | Detect PII (emails, phones, SSNs, API keys) |
| `sulcus_status` | Server status, version, memory count |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SULCUS_API_KEY` | Yes | — | API key from sulcus.ca |
| `SULCUS_BASE_URL` | No | `https://api.sulcus.ca` | Custom server URL |
| `SULCUS_NAMESPACE` | No | `default` | Default memory namespace |
| `RUST_LOG` | No | `info` | Log level (trace/debug/info/warn/error) |

## Building from Source

```bash
git clone https://github.com/digitalforgeca/sulcus
cd crates/sulcus-mcp
cargo build --release
```

Binary: `target/release/sulcus-mcp` (~5MB)

Requires Rust 1.75+.

## Architecture

```
Claude Desktop / Cursor / VS Code
    └── stdio → sulcus-mcp binary (local)

MAF / Remote Agents
    └── HTTPS → Traefik → sulcus-mcp (HTTP mode)

sulcus-mcp
    └── reqwest → Sulcus Cloud API (api.sulcus.ca)
```

## License

MIT — [Digital Forge Studios](https://dforge.ca)
