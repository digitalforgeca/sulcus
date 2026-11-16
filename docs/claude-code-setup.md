# Claude Code Setup

Give Claude Code persistent, reactive, thermodynamic memory in under a minute.

## Quick Connect

After installing the native `sulcus` binary (`curl -fsSL https://sulcus.ca/install.sh | bash` or Homebrew), wire Claude Code lifecycle hooks and the zero-lock MCP proxy automatically:

```bash
sulcus daemon start
sulcus connect claude-code
```

This registers `sulcus mcp-proxy` and `<15ms` pure-Rust `sulcus hook --harness claude` lifecycle handlers without writing raw API keys into git-tracked files.

## Homebrew Install

```bash
brew tap digitalforgeca/sulcus
brew install sulcus
```

### MCP Configuration

If configuring MCP manually (for `.mcp.json`, `~/.claude.json`, or Claude Desktop), always invoke `mcp-proxy` so multiple concurrent sessions share the local workstation daemon (`http://127.0.0.1:4203`) without database lock contention:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "sulcus",
      "args": ["mcp-proxy"]
    }
  }
}
```

Restart Claude Code after updating manual MCP settings.

## Lifecycle Plugin

Install the full Claude Code plugin from `plugins/sulcus-claude-code` in [digitalforgeca/sulcus](https://github.com/digitalforgeca/sulcus) (or run `sulcus connect claude-code`) to enable automatic session recall, System 1 VCR turn capture, context compaction recovery, Activity Ledger surgical undo, and `/sulcus-*` skills alongside MCP tools.

## Memory Tools

Once connected, Claude Code gains zero-secret MCP tools for persistent memory:

- **`store_memory`**: Save durable knowledge, classified by System 1 VCR as `episodic`, `semantic`, `preference`, `procedural`, or `fact`.
- **`search_memory`**: Hybrid semantic, keyword, entity, and System 1 VCR retrieval search across stored memories.
- **`expand_memory`**: Page full Territory details for a compact Map pointer (boosting recall heat).
- **`update_memory` / `forget_memory`**: Update, boost, pin, deprecate, or delete existing memories.
- **`build_context`**: Assemble a token-budgeted `<sulcus_context>` envelope for the active task.

## Decay Engine

Sulcus uses a **thermodynamic model** where memories carry heat (`0.0–1.0`):

- **New memories** start hot.
- **Heat decays** over time according to per-archetype half-lives.
- **Recalling** a memory boosts its heat and reinforces stability (spaced repetition).
- **Hot memories** surface in agent context while **cold memories** step back into archival storage.

## Cloud Sync

Local workstation mode is free and runs 100% offline. For encrypted multi-device sync and managed graph intelligence, authenticate via `sulcus login` (or configure `~/.config/sulcus/sulcus.ini`):

```ini
[sulcus]
server_url = https://api.sulcus.ca
server_api_key = your-api-key
```

The workstation daemon synchronizes local deltas automatically in the background.

## Local Configuration

All settings are optional; Sulcus runs zero-config out of the box (`~/.config/sulcus/sulcus.ini` or `~/.sulcus/sulcus.ini`):

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

**Health & Self-Repair**: Run `sulcus doctor --fix` at any time to verify daemon connectivity (`127.0.0.1:4203`), embedded PostgreSQL 17 health (`127.0.0.1:4201`), companion vector library resolution, and MCP wiring.

**MCP not connecting**: Verify `sulcus` is on your `PATH` (`which sulcus`) and `"args": ["mcp-proxy"]` is configured, then restart Claude Code.
