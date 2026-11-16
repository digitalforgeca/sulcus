# Claude Code Hooks

Shell-based lifecycle hooks that integrate Sulcus memory with Claude Code sessions.

## Setup

1. Copy hook scripts to your project:

```bash
mkdir -p .claude/hooks
cp tools/claude-hooks/sulcus-*.sh .claude/hooks/
chmod +x .claude/hooks/sulcus-*.sh
```

2. Add to your `.claude/settings.json` (merge with existing hooks):

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "\".claude/hooks/sulcus-session-start.sh\"" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "\".claude/hooks/sulcus-recall.sh\"" }] }],
    "PreCompact": [{ "hooks": [{ "type": "command", "command": "\".claude/hooks/sulcus-pre-compact.sh\"" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "\".claude/hooks/sulcus-capture.sh\"" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "\".claude/hooks/sulcus-session-end.sh\"" }] }]
  }
}
```

3. Set environment variables:

```bash
export SULCUS_API_KEY="your-api-key"
export SULCUS_SERVER_URL="https://api.sulcus.ca"  # or http://127.0.0.1:4203 for local daemon
export SULCUS_NAMESPACE="my-agent"
export SULCUS_RECALL_MAX=5  # optional, default 5
```

## Hook Events

| Hook | Event | Action |
|------|-------|--------|
| `sulcus-session-start.sh` | `SessionStart` | Records session start as episodic memory |
| `sulcus-recall.sh` | `UserPromptSubmit` | Searches for relevant memories, injects into context, boosts recalled heat |
| `sulcus-pre-compact.sh` | `PreCompact` | Preserves important messages before compaction loses them |
| `sulcus-capture.sh` | `Stop` | Captures decisions/insights from the agent's response |
| `sulcus-session-end.sh` | `SessionEnd` | Records session end |

## Dependencies

- `jq` (for JSON parsing)
- `curl` (for Sulcus API calls)

## OpenClaw Comparison

The OpenClaw plugin (`openclaw-sulcus`) uses in-process TypeScript hooks.
These shell scripts provide equivalent lifecycle wiring for Claude Code's external hook system.

| Feature | OpenClaw Plugin | Claude Code Hooks |
|---------|----------------|-------------------|
| Auto-recall | `before_prompt_build` | `UserPromptSubmit` |
| Pre-compaction save | `before_compaction` | `PreCompact` |
| Capture decisions | `llm_output` + `agent_end` | `Stop` |
| Session tracking | `session_start/end` | `SessionStart/End` |
| Boost on recall | Inline in recall hook | Background curl in recall |
| System 1 VCR gate | Server-side (transparent) | Server-side (transparent) |

Both use the same Sulcus API. System 1 VCR value gating and archetype classification run transparently regardless of client.

## MCP Tools

Claude Code can also use Sulcus via zero-lock MCP (`sulcus mcp-proxy`, exposing `search_memory`,
`record_memory`, `memory_boost`, `page_in`, and more). The hooks provide **automatic** behavior;
MCP tools provide **explicit** control. Both work together.

See `tools/manifests/claude_mcp.json` or [`plugins/sulcus-claude-code`](../../plugins/sulcus-claude-code) for MCP configuration.
