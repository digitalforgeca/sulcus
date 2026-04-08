# @digitalforgestudios/sulcus

**Persistent, intelligent memory sidecar for AI agents.** Local-first, zero-config MCP server that gives Claude Code, OpenClaw, and any LLM agent persistent memory with reactive triggers.

Memories gain heat when used and decay over time — just like human recall. Hot memories surface in context; cold ones fade to storage.

## Quick Start

```bash
# Install globally
npm install -g @digitalforgestudios/sulcus

# Or run directly
npx @digitalforgestudios/sulcus serve
```

## Claude Code Setup

### Recommended: Plugin (Hooks + MCP)

Use the Claude Code plugin at [`plugins/claude-code-sulcus/`](../../plugins/claude-code-sulcus/) for full integration including lifecycle hooks.

### MCP Only

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
| `memory_store` | Store a new memory (auto-classifies as episodic/semantic/preference/procedural/fact) |
| `memory_search` | Semantic search across all memories |
| `memory_recall` | Recall a specific memory by ID (boosts heat) |
| `memory_boost` | Manually increase a memory's heat |
| `memory_deprecate` | Lower a memory's priority |
| `memory_relate` | Create edges between related memories |
| `memory_reclassify` | Change a memory's type |
| `memory_pin` | Pin a memory (prevents decay) |
| `memory_unpin` | Unpin a memory |
| `list_triggers` | List programmable memory triggers |
| `create_trigger` | Create a reactive trigger (fires on memory events) |
| `sync_now` | Force cloud sync (requires sulcus-sync subscription) |

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

- **Local Postgres** — Runs an embedded PostgreSQL (pg-embed) instance. Zero external dependencies.
- **Heat-based decay** — Memories lose heat over time based on configurable half-lives per type.
- **Spaced repetition** — Each recall boosts heat and increases stability (longer effective half-life).
- **Semantic search** — FastEmbed vectors for similarity matching, no API calls.
- **SIU classification** — Automatic memory type detection.
- **Triggers** — Programmable rules that fire when memories change, cross thresholds, or match patterns.
- **Cloud sync** — Optional paid tier adds encrypted cloud sync, multi-agent mesh, remote DB. [sulcus.ca](https://sulcus.ca)

## Configuration

Create `~/.sulcus/sulcus.ini`:

```ini
[sulcus]
# Decay tick interval (ms)
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

## License

MIT — see [sulcus.ca](https://sulcus.ca) for cloud sync pricing.
