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

## Installation

### 1. Copy plugin files

```bash
cp -r packages/hermes-sulcus/ ~/.hermes/plugins/sulcus/
```

Or symlink:

```bash
ln -s $(pwd)/packages/hermes-sulcus ~/.hermes/plugins/sulcus
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

Or add to `~/.hermes/config.yaml`:

```yaml
memory:
  provider: sulcus
```

### 4. Verify

```bash
hermes  # Start a session
# Then ask: "Do you have Sulcus memory?"
```

## Plugin Structure

```
hermes-sulcus/
├── __init__.py     # MemoryProvider implementation + plugin registration
├── plugin.yaml     # Plugin manifest
└── README.md       # This file
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
