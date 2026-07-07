# hermes-sulcus

Sulcus Memory Provider plugin for [Hermes Agent](https://hermes-agent.nousresearch.com). Gives Hermes persistent cross-session memory via [Sulcus Cloud](https://sulcus.ca).

## What it does

- **Automatic recall**: Before each turn, queries Sulcus for semantically relevant context
- **Automatic storage**: After each turn, stores conversation as episodic memory (verbatim — no lossy extraction)
- **Memory classification**: Pattern-matches user turns to preference/decision/fact/episodic types for correct heat weighting
- **Turn mirroring**: Mirrors built-in Hermes `memory` tool writes to Sulcus
- **Session lifecycle**: Extracts facts at session end, rescues context before compression
- **Delegation tracking**: Stores subagent task/result pairs as procedural memory
- **Manual tools**: `sulcus_recall`, `sulcus_store`, `sulcus_get`, `sulcus_pin`, `sulcus_consolidate`

## Quick Start

```bash
# Install
./scripts/install.sh

# Set env vars (prompted if missing)
# Then enable the provider:
hermes config set memory.provider sulcus

# Verify everything works
./scripts/validate.sh
```

## Installation

### 1. Copy plugin files

```bash
./scripts/install.sh                     # Copy to ~/.hermes/plugins/sulcus/
./scripts/install.sh --symlink           # Symlink instead (for development)
./scripts/install.sh /custom/hermes/home # Custom HERMES_HOME
```

### 2. Environment variables

Add to `~/.hermes/.env`:

```bash
SULCUS_API_KEY=sk-your-key-here
SULCUS_SERVER_URL=https://api.sulcus.ca
SULCUS_NAMESPACE=your-agent-name
```

### 3. Config

```bash
hermes config set memory.provider sulcus
```

### 4. Verify

```bash
./scripts/validate.sh    # Full validation
./scripts/health.sh      # Quick API ping
```

## Scripts Toolkit

All scripts live in `scripts/` and are self-contained bash with no dependencies beyond Python 3 and curl.

### `install.sh` — Install / Deploy

Copies (or symlinks) the plugin into a Hermes Agent profile. Checks for missing env vars and config.

```bash
./scripts/install.sh                  # Install to default ~/.hermes
./scripts/install.sh /opt/data        # Install to custom HERMES_HOME
./scripts/install.sh --symlink        # Symlink for development
```

### `test.sh` — Test Suite

Runs 12 unit tests and 3 integration tests. Unit tests mock the Hermes MemoryProvider base class so they work without Hermes installed. Integration tests hit the live Sulcus API.

```bash
./scripts/test.sh                     # Run all tests (15 total)
./scripts/test.sh --unit              # Unit tests only (no API calls)
./scripts/test.sh --integration       # Integration tests only
./scripts/test.sh --verbose           # Show failure details
```

**Test coverage:**
- Module imports, provider name, tool schemas, config schema
- `_node_label` prefers `pointer_summary` over `label`
- `_node_heat` uses `current_heat` over `heat`
- Memory classification: preferences, facts, episodic fallback
- `is_available()` behavior without env vars
- Uninitialized provider returns safe defaults
- API: search, hot_nodes, store + recall round-trip

### `validate.sh` — Validate Installation

Full diagnostic of an existing installation — checks files, env vars, config, API connectivity, memory count, and plugin loading.

```bash
./scripts/validate.sh                 # Check default ~/.hermes
./scripts/validate.sh /opt/data       # Check custom HERMES_HOME
```

Output:
```
Files        ✓ __init__.py exists, ✓ plugin.yaml exists
Environment  ✓ SULCUS_API_KEY, ✓ SERVER_URL, ✓ NAMESPACE
Config       ✓ memory.provider = sulcus
API          ✓ HTTP 200, ✓ 74 memories
Plugin Load  ✓ name=sulcus available=True tools=5
```

### `health.sh` — Health Check

Quick API probe. Use in monitoring, cron, or CI. Exit 0 = healthy, exit 1 = unhealthy.

```bash
./scripts/health.sh                   # Human-readable output
./scripts/health.sh --json            # JSON output for monitoring
./scripts/health.sh --quiet           # Exit code only
```

JSON output:
```json
{"status":"healthy","http_code":200,"latency_ms":101,"api_url":"https://api.sulcus.ca","namespace":"odysseus"}
```

### `admin.sh` — Administration CLI

Direct operations against the Sulcus API from the command line.

```bash
./scripts/admin.sh stats              # Memory statistics (count, types, avg heat)
./scripts/admin.sh search "query"     # Semantic search
./scripts/admin.sh hot [limit]        # Show hottest nodes
./scripts/admin.sh get <node_id>      # Get full node details
./scripts/admin.sh store "text" [type] # Store a memory
./scripts/admin.sh export [file]      # Export all memories to JSON
```

### `uninstall.sh` — Clean Removal

Removes plugin files and optionally cleans env vars.

```bash
./scripts/uninstall.sh                # Full removal
./scripts/uninstall.sh --keep-config  # Remove plugin, keep env vars
```

## Plugin Structure

```
hermes-sulcus/
├── __init__.py        # MemoryProvider implementation + plugin registration
├── plugin.yaml        # Plugin manifest
├── README.md          # This file
└── scripts/
    ├── install.sh     # Install plugin into Hermes
    ├── test.sh        # Test suite (12 unit + 3 integration)
    ├── validate.sh    # Validate existing installation
    ├── health.sh      # API health check (monitoring/CI)
    ├── admin.sh       # Admin CLI (stats, search, export)
    └── uninstall.sh   # Clean removal
```

## Implements

Full Hermes `MemoryProvider` lifecycle:

| Hook | Purpose |
|------|---------|
| `is_available()` | Check env vars (parses .env file as fallback) |
| `initialize()` | Connect to Sulcus API |
| `system_prompt_block()` | Inject Sulcus usage instructions |
| `prefetch()` / `queue_prefetch()` | Background recall before each turn |
| `sync_turn()` | Store turn pairs after each turn |
| `on_session_end()` | Extract facts at session boundary |
| `on_session_switch()` | Handle session ID changes |
| `on_pre_compress()` | Rescue context before compression |
| `on_memory_write()` | Mirror built-in memory writes |
| `on_delegation()` | Store subagent results |
| `get_config_schema()` | Support `hermes memory setup` wizard |

## Key Techniques

1. **Verbatim storage** — store actual user words, not LLM-extracted summaries (MemPalace philosophy: verbatim beats extraction 2:1 on recall benchmarks)
2. **Memory classification** — 13 regex patterns classify turns into preference/decision/fact/episodic
3. **tier: "all"** on every search — prevents heat decay from hiding old nodes
4. **Assistant turn storage** — `[asst]` tagged at 0.5 base_utility
5. **Quality gate detection** — surfaces rejected stores as errors instead of silent failures

## MemBench Scores

| Category       | Score  | Ceiling |
|----------------|--------|---------|
| Overall        | 43.9%  | 63.7%   |
| Recall         | 25%    | 100%    |
| Temporal       | 59.4%  | 75%     |
| Contradiction  | 75%    | 100%    |
| Multi-Session  | 50%    | 0%*     |
| Efficiency     | 10%    | 43.8%   |

\* Sulcus **beats the ceiling** in multi-session — in-context memory scores 0% because it can't persist across sessions.

## License

MIT — see [LICENSE](../../LICENSE)
