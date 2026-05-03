# @digitalforgestudios/sulcus

**Thermodynamic memory sidecar for AI agents.** Local-first, zero-config MCP server that gives Claude Code, OpenClaw, and any LLM agent persistent, heat-governed memory.

Memories gain heat when used and decay over time — just like human recall. Hot memories surface in context; cold ones fade to storage.

## Quick Start

```bash
# Install globally
npm install -g @digitalforgestudios/sulcus

# Or run directly
npx @digitalforgestudios/sulcus serve
```

## Claude Code Setup

Add Sulcus to your Claude Code MCP config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "npx",
      "args": ["-y", "@digitalforgestudios/sulcus", "stdio"]
    }
  }
}
```

That's it. Claude Code will now have persistent memory across conversations.

### Available MCP Tools

Once connected, Claude Code gets these tools:

| Tool | Description |
|------|-------------|
| `record_memory` | Store a new memory with type, decay class, importance, and key details |
| `search_memory` | Semantic search across all memories |
| `get_node` | Recall a specific memory by ID (boosts heat) |
| `memory_boost` | Manually increase a memory's heat |
| `memory_deprecate` | Lower a memory's priority |
| `memory_relate` | Create edges between related memories |
| `memory_reclassify` | Change a memory's type |
| `list_triggers` | List programmable memory triggers |
| `create_trigger` | Create a reactive trigger (fires on memory events) |
| `sync_now` | Hint to trigger cloud sync (requires sulcus.ca subscription; no-op in local mode) |
| `prune_cold_memories` | Run thermodynamic pruning passes |
| `metrics` | Show memory system metrics |
| `storage_info` | Show local storage details |

> **Note:** `memory_pin`, `memory_unpin` are set via the `is_pinned` parameter in `record_memory`, not as standalone tools.

### With OpenClaw

See the [OpenClaw plugin](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus) for automatic integration.

## Commands

```bash
# Start HTTP server (port 4200 by default)
sulcus serve

# Start MCP stdio server (for Claude Code / IDE integrations)
sulcus stdio

# Initialize local database
sulcus init

# Add a memory from the CLI
sulcus add-memory "Important fact about the project" 0.9

# List hottest memories
sulcus list-hot 20

# Show metrics
sulcus metrics

# Seed demo data
sulcus demo
```

## How It Works

- **Local Postgres** — Runs an embedded Postgres instance via pg-embed. Zero external dependencies.
- **Thermodynamic decay** — Memories lose heat over time based on configurable half-lives per type.
- **Spaced repetition** — Each recall boosts heat and increases stability (longer effective half-life).
- **Semantic search** — FastEmbed vectors for similarity matching, no API calls.
- **Triggers** — Programmable rules that fire when memories change, cross thresholds, or match patterns.
- **Cloud sync** — Optional paid tier adds encrypted cloud sync, multi-agent mesh, remote DB. [sulcus.ca](https://sulcus.ca)

## Configuration

Create `~/.sulcus/sulcus.ini`:

```ini
[sulcus]
# Thermodynamics
therm_interval_ms = 1000
decay = 0.85
active_limit = 50

# Cloud sync (paid tier — leave blank for local-only)
# server_url = https://api.sulcus.ca
# server_api_key = your-api-key
```

## Building from Source

```bash
git clone https://github.com/digitalforgeca/sulcus.git
cd sulcus
cargo build --release -p sulcus
cp target/release/sulcus ~/.local/bin/
```

Requires Rust 1.75+ and an ONNX Runtime installation for embeddings.

## Local vs Cloud Feature Parity

The local sidecar covers the core memory lifecycle. Some features require a [sulcus.ca](https://sulcus.ca) cloud subscription:

| Feature | Local | Cloud |
|---------|-------|-------|
| Store / search / recall memories | ✅ | ✅ |
| Thermodynamic decay + heat | ✅ | ✅ |
| Triggers (reactive automation) | ✅ | ✅ |
| MCP stdio transport | ✅ | ✅ |
| HTTP control panel | ✅ | ✅ |
| SIVU quality gate on write | ❌ | ✅ |
| Knowledge graph (AGE) + entity expansion | ❌ | ✅ |
| Graph-hop recall enrichment | ❌ | ✅ |
| Batch heat-boost (single round-trip) | ❌ | ✅ |
| SIRU adaptive recall scoring | ❌ | ✅ |
| Multi-agent namespace mesh | ❌ | ✅ |
| Encrypted cloud sync | ❌ | ✅ |

## License

MIT — see [sulcus.ca](https://sulcus.ca) for cloud sync pricing.
