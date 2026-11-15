# Using Sulcus with Claude Code

Give Claude Code persistent, reactive, thermodynamic memory in under a minute.

## Option 1: One-Command Wiring (`sulcus connect`)

After installing the free-forever native `sulcus` binary (`curl -fsSL https://sulcus.ca/install.sh | bash` or Homebrew), wire Claude Code hooks and zero-secret MCP proxy automatically:

```bash
sulcus daemon start
sulcus connect claude-code
```

This registers `sulcus mcp-proxy` and `<15ms` pure-Rust `sulcus hook` lifecycle handlers without writing raw API keys into project files.

## Option 2: Standalone Stdio MCP (`sulcus stdio`)

No external database step required. Works on macOS (Intel + Apple Silicon) and Linux (x86_64 + ARM64).

```bash
sulcus stdio
```

### Claude Code MCP Config

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "npx",
      "args": ["-y", "sulcus", "stdio"]
    }
  }
}
```

Restart Claude Code. Done.

## Option 2: Homebrew (macOS/Linux)

```bash
brew tap digitalforgeca/sulcus
brew install sulcus
```

Then add to MCP config:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "sulcus",
      "args": ["stdio"]
    }
  }
}
```

## Option 3: Claude Code Plugin (Lifecycle Hooks + Skills)

Install the full Claude Code plugin from `plugins/sulcus-claude-code` in the [digitalforgeca/sulcus](https://github.com/digitalforgeca/sulcus) repository to enable automatic session recall, context compaction recovery, and `/sulcus-*` slash skills alongside MCP tools.

## What Happens

Once connected, Claude Code gets MCP tools for persistent memory:

- **`remember`**: Save durable knowledge. Auto-classifies as episodic, semantic, preference, procedural, or fact.
- **`search_memory`**: Hybrid semantic, keyword, entity, and temporal search across stored memories.
- **`expand_memory`**: Page full territory details for a compact memory pointer (boosts recall heat).
- **`update_memory` / `forget_memory`**: Update, pin, reclassify, or retire existing memories.
- **`memory_context`**: Assemble a token-budgeted working context payload for the active task.

## How Memory Works

Sulcus uses a **thermodynamic model** where memories have heat (0.0–1.0):

- **New memories** start hot (1.0).
- **Heat decays** over time based on configurable half-lives per memory type.
- **Recalling** a memory boosts its heat and increases stability (spaced repetition).
- **Hot memories** surface in agent context. **Cold memories** fade to storage.

This means Claude Code naturally remembers things you use often and gradually forgets noise; just like human memory.

## Cloud Sync (Optional)

Local-only mode is free and fully functional. For cloud sync across devices and managed graph intelligence, subscribe at [sulcus.ca](https://sulcus.ca) and authenticate via `sulcus auth login` (or configure `~/.config/sulcus/sulcus.ini`):

```ini
[sulcus]
server_url = https://api.sulcus.ca
server_api_key = your-api-key
```

The built-in cloud sync worker synchronizes local deltas automatically while the workstation daemon is running.

## Configuration

All optional. Sulcus works zero-config.

`~/.sulcus/sulcus.ini`:

```ini
[sulcus]
# Decay tick interval (ms)
therm_interval_ms = 1000

# Default decay rate (overridden by per-type half-lives)
decay = 0.85

# Max active memories in context
active_limit = 50
```

## Troubleshooting

**"ONNX Runtime not found"**: Sulcus uses FastEmbed for local semantic search. Install ONNX Runtime:

```bash
# macOS
brew install onnxruntime

# Linux
curl -sL https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-linux-x64-1.23.2.tgz | sudo tar xz -C /usr/local
sudo ldconfig
```

**"Database connection failed"**: Sulcus runs an embedded PostgreSQL 17 instance (via `pg-embed` bound to `127.0.0.1:4201` in `~/.sulcus/local`) by default. No external database is needed; if you see this error, check `sulcus doctor --fix` to repair stale lock files cleanly.

**MCP not connecting**: Verify your config path. Claude Code reads from `~/.claude/claude_desktop_config.json`. Restart Claude Code after changes.
