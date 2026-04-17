#!/usr/bin/env bash
# Sulcus Memory — SessionStart hook
# Injects persistent memory context into Claude Code on every session start.
# Uses hot-context for initial context + status for stats.
# Supports cloud mode (SULCUS_API_KEY) and local mode (sulcus binary).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_sulcus-lib.sh
source "${SCRIPT_DIR}/_sulcus-lib.sh"

# ---------------------------------------------------------------------------
# Not configured at all
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "none" ]; then
  cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "## Sulcus Memory (⚠️ Not Configured)\n\nSulcus persistent memory is available but not configured. Either:\n- Set SULCUS_API_KEY (and optionally SULCUS_SERVER_URL) for cloud mode\n- Install the sulcus binary locally for local mode\n\nGet started at https://sulcus.ca"
  }
}
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# Cloud mode
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "cloud" ]; then
  # Get hot nodes for initial context
  HOT_CONTEXT=$(curl -sf "${SULCUS_URL}/api/v1/agent/hot_nodes?limit=10" \
    -H "Authorization: Bearer ${SULCUS_KEY}" 2>/dev/null)

  # Fallback to search if hot_nodes fails
  if [ -z "$HOT_CONTEXT" ] || [ "$HOT_CONTEXT" = "null" ]; then
    HOT_CONTEXT=$(curl -sf -X POST "${SULCUS_URL}/api/v1/agent/search" \
      -H "Authorization: Bearer ${SULCUS_KEY}" \
      -H "Content-Type: application/json" \
      -d '{"query": "recent work and decisions", "limit": 5}' 2>/dev/null)
  fi

  # Get status for stats
  STATS=$(curl -sf "${SULCUS_URL}/api/v1/status" \
    -H "Authorization: Bearer ${SULCUS_KEY}" 2>/dev/null)

  TOTAL_NODES=$(echo "$STATS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('graph',{}).get('total_nodes', '?'))" 2>/dev/null || echo "?")
  HOT_NODES=$(echo "$STATS"   | python3 -c "import sys,json; print(json.load(sys.stdin).get('graph',{}).get('hot_nodes', '?'))"  2>/dev/null || echo "?")

  MEMORY_CONTEXT=$(echo "$HOT_CONTEXT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    nodes = data.get('hot_nodes', data.get('nodes', data.get('results', [])))
    if isinstance(data, list):
        nodes = data
    parts = []
    for n in nodes[:10]:
        content = n.get('pointer_summary', n.get('content', n.get('label', '')))
        mtype = n.get('memory_type', 'unknown')
        heat = n.get('current_heat', n.get('heat', 0))
        if content:
            band = 'high' if heat > 0.7 else 'mid' if heat > 0.3 else 'low'
            parts.append(f'- [{band}|{mtype}] {content[:200]}')
    print('\n'.join(parts))
except:
    print('')
" 2>/dev/null)

  # Get SIRU weights status
  WEIGHTS=$(curl -sf "${SULCUS_URL}/api/v1/agent/recall-weights" \
    -H "Authorization: Bearer ${SULCUS_KEY}" 2>/dev/null)
  SIRU_STATUS=$(echo "$WEIGHTS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    w = data.get('weights', {})
    src = w.get('source', 'default')
    ver = w.get('model_version', 0)
    if src == 'learned':
        print(f'SIRU v{ver} (learned weights active)')
    else:
        print('SIRU (default weights, accumulating data)')
except:
    print('SIRU (status unavailable)')
" 2>/dev/null)
fi

# ---------------------------------------------------------------------------
# Local mode
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "local" ]; then
  METRICS_RAW=$(sulcus_local_call "metrics" "{}")
  TOTAL_NODES=$(echo "$METRICS_RAW" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print(data.get('num_nodes', data.get('total_nodes', '?')))
except:
    print('?')
" 2>/dev/null || echo "?")
  HOT_NODES="?"

  CONTEXT_RAW=$(sulcus_local_call "build_context" '{"budget_chars":2000,"min_heat":0.1}')
  if [ -z "$CONTEXT_RAW" ]; then
    CONTEXT_RAW=$(sulcus_local_call "list_hot_nodes" '{"limit":10}')
  fi
  MEMORY_CONTEXT="$CONTEXT_RAW"
  SIRU_STATUS="SIRU (local mode — cloud training not available)"
fi

# ---------------------------------------------------------------------------
# Shared: escape and emit JSON
# ---------------------------------------------------------------------------
ESCAPED_CONTEXT=$(printf '%s' "$MEMORY_CONTEXT" | python3 -c "
import sys, json
text = sys.stdin.read()
print(json.dumps(text)[1:-1])
" 2>/dev/null)

TOTAL_NODES="${TOTAL_NODES:-?}"
HOT_NODES="${HOT_NODES:-?}"
SIRU_STATUS="${SIRU_STATUS:-SIRU (unknown)}"

cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "## Sulcus — Persistent Memory\\n\\nYou have access to Sulcus, a persistent thermodynamic memory system with a knowledge graph. Memories survive across sessions with heat-based decay. The SIU v2 pipeline auto-classifies every memory.\\n\\n**Stats:** ${TOTAL_NODES} total memories, ${HOT_NODES} hot (active) | ${SIRU_STATUS}\\n\\n**MCP Tools Available:**\\n- \`search_memory\` — Semantic search across all memories\\n- \`record_memory\` — Store new memories (types: episodic, semantic, preference, procedural, fact)\\n- \`memory_boost\` / \`memory_deprecate\` — Adjust memory importance\\n- \`create_trigger\` / \`list_triggers\` — Reactive rules that fire on memory events\\n- \`configure_thermodynamics\` — View/adjust decay and heat settings\\n- \`list_hot_nodes\` — See most active memories\\n- \`build_context\` — Get a budget-constrained context block\\n\\n**When to store:** Decisions made, lessons learned, user preferences, important facts, procedures.\\n**When to search:** Questions about past work, incomplete context, references to prior conversations.\\n\\n**Memory types:** episodic (fast decay) · semantic (slow) · preference (slower) · procedural (slowest) · fact (slow)\\n\\n### Active Context\\n${ESCAPED_CONTEXT}"
  }
}
EOF

exit 0
