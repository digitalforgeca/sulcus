# Using Sulcus with Claude Code

Give Claude Code persistent, reactive, thermodynamic memory in under a minute.

## Option 1: NPX (Recommended)

No build step. Works on macOS (Intel + Apple Silicon) and Linux (x86_64 + ARM64).

```bash
npx @digitalforgestudios/sulcus stdio
```

### Claude Code MCP Config

Add to `~/.claude/claude_desktop_config.json`:

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

## Option 3: Build from Source

```bash
git clone https://github.com/digitalforgeca/sulcus.git
cd sulcus
cargo build --release -p sulcus
cp target/release/sulcus ~/.local/bin/
```

Then point MCP config at the binary path.

## What Happens

Once connected, Claude Code gets MCP tools for persistent memory:

- **`memory_store`** — Save important information. Auto-classifies as episodic, semantic, preference, procedural, or fact.
- **`memory_search`** — Semantic search across all stored memories.
- **`memory_recall`** — Retrieve a specific memory (boosts its heat).
- **`memory_boost` / `memory_deprecate`** — Manually adjust importance.
- **`memory_relate`** — Create connections between related memories.
- **`create_trigger`** — Set up reactive rules (e.g., "notify me when a memory about X decays below 0.3").

## How Memory Works

Sulcus uses a **thermodynamic model** where memories have heat (0.0–1.0):

- **New memories** start hot (1.0).
- **Heat decays** over time based on configurable half-lives per memory type.
- **Recalling** a memory boosts its heat and increases stability (spaced repetition).
- **Hot memories** surface in agent context. **Cold memories** fade to storage.
- **Triggers** fire when memories cross thresholds or match patterns.

This means Claude Code naturally remembers things you use often and gradually forgets noise — just like human memory.

## Cloud Sync (Optional)

Local-only mode is free and fully functional. For cloud sync, multi-agent memory mesh, and remote database support, subscribe at [sulcus.ca](https://sulcus.ca).

Create `~/.sulcus/sulcus.ini`:

```ini
[sulcus]
server_url = https://api.sulcus.ca
server_api_key = your-api-key
```

The sync plugin downloads and installs automatically on startup.

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

**"ONNX Runtime not found"** — Sulcus uses FastEmbed for local semantic search. Install ONNX Runtime:

```bash
# macOS
brew install onnxruntime

# Linux
curl -sL https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-linux-x64-1.23.2.tgz | sudo tar xz -C /usr/local
sudo ldconfig
```

**"Database connection failed"** — Sulcus runs an embedded Postgres instance (via pg-embed) by default. No external database needed — if you see this error, check that no stale lock files exist in `~/.sulcus/data/`. Removing that directory and restarting will reinitialize cleanly.

**MCP not connecting** — Verify your config path. Claude Code reads from `~/.claude/claude_desktop_config.json`. Restart Claude Code after changes.
