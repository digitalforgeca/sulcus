# @digitalforgestudios/sulcus

**Thermodynamic memory for AI agents.** Zero-config MCP server that gives Claude Code, OpenClaw, Cursor, and any LLM agent persistent, heat-governed memory.

Memories gain heat when used and decay over time — just like human recall. Hot memories surface in context; cold ones fade to storage.

## Quick Start

```bash
# Install globally (downloads prebuilt binary)
npm install -g @digitalforgestudios/sulcus

# Set your API key
export SULCUS_API_KEY=sk-your-api-key-here

# Run MCP server (stdio)
sulcus mcp stdio

# Or use directly
npx @digitalforgestudios/sulcus mcp stdio
```

Get an API key at [sulcus.ca/dashboard/settings](https://sulcus.ca/dashboard/settings).

## Claude Desktop / Claude Code Setup

Add to your MCP config:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "sulcus",
      "args": ["mcp", "stdio"],
      "env": {
        "SULCUS_API_KEY": "sk-your-api-key-here"
      }
    }
  }
}
```

Or via npx (no global install):

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "npx",
      "args": ["-y", "@digitalforgestudios/sulcus", "mcp", "stdio"],
      "env": {
        "SULCUS_API_KEY": "sk-your-api-key-here"
      }
    }
  }
}
```

## CLI Commands

The unified `sulcus` binary includes MCP and standalone CLI tools:

```bash
# MCP server (for IDE integrations)
sulcus mcp stdio
sulcus mcp http --port 3100

# CLI tools
sulcus status                    # Connection + memory stats
sulcus search "project decisions"  # Semantic search
sulcus remember "important fact"   # Store a memory
sulcus import memories.md          # Import from markdown
sulcus export                      # Export all memories
```

## MCP Tools (19)

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
| `SULCUS_SERVER_URL` | No | `https://api.sulcus.ca` | Custom server URL |
| `SULCUS_NAMESPACE` | No | `default` | Memory namespace |

## Alternative Install Methods

```bash
# Cargo (from source)
cargo install sulcus

# Cargo binstall (prebuilt)
cargo binstall sulcus

# From source
git clone https://github.com/digitalforgeca/sulcus
cd sulcus && cargo build --release -p sulcus
cp target/release/sulcus ~/.local/bin/
```

## With OpenClaw

See the [OpenClaw plugin](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus) for automatic integration.

## License

MIT — [Digital Forge Studios](https://dforge.ca) | [sulcus.ca](https://sulcus.ca)
