#!/usr/bin/env bash
# Sulcus Memory — SessionStart hook
# Injects persistent memory context into Claude Code on every session start.
# Requires: SULCUS_SERVER_URL, SULCUS_API_KEY environment variables.

SULCUS_URL="${SULCUS_SERVER_URL:-https://api.sulcus.ca}"
SULCUS_KEY="${SULCUS_API_KEY:-}"

if [ -z "$SULCUS_KEY" ]; then
  cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "## Sulcus Memory (⚠️ Not Configured)\n\nSulcus persistent memory is available but not configured. Set SULCUS_SERVER_URL and SULCUS_API_KEY environment variables to enable cross-session memory.\n\nGet an API key at https://sulcus.ca"
  }
}
EOF
  exit 0
fi

# Fetch hot context from Sulcus (top memories by heat)
CONTEXT=$(curl -sf "${SULCUS_URL}/api/v1/agent/context" \
  -H "Authorization: Bearer ${SULCUS_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"budget_chars": 2000, "min_heat": 0.1}' 2>/dev/null)

if [ $? -ne 0 ] || [ -z "$CONTEXT" ]; then
  # Fallback: try search for recent memories
  CONTEXT=$(curl -sf -X POST "${SULCUS_URL}/api/v1/agent/search" \
    -H "Authorization: Bearer ${SULCUS_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"query": "recent work and decisions", "limit": 5}' 2>/dev/null)
fi

# Get memory stats from /api/v1/status
STATS=$(curl -sf "${SULCUS_URL}/api/v1/status" \
  -H "Authorization: Bearer ${SULCUS_KEY}" 2>/dev/null)

TOTAL_NODES=$(echo "$STATS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('graph',{}).get('total_nodes', '?'))" 2>/dev/null || echo "?")
HOT_NODES=$(echo "$STATS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('graph',{}).get('hot_nodes', '?'))" 2>/dev/null || echo "?")

# Build context string from search results
MEMORY_CONTEXT=""
if [ -n "$CONTEXT" ]; then
  MEMORY_CONTEXT=$(echo "$CONTEXT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    # Handle both context endpoint and search endpoint responses
    nodes = data.get('nodes', data.get('results', []))
    parts = []
    for n in nodes[:10]:
        content = n.get('pointer_summary', n.get('content', n.get('label', '')))
        mtype = n.get('memory_type', 'unknown')
        heat = n.get('current_heat', n.get('heat', 0))
        if content:
            parts.append(f'[{mtype} heat={heat:.2f}] {content[:200]}')
    print('\n'.join(parts))
except:
    print('')
" 2>/dev/null)
fi

# Escape for JSON
ESCAPED_CONTEXT=$(echo "$MEMORY_CONTEXT" | python3 -c "
import sys, json
text = sys.stdin.read()
print(json.dumps(text)[1:-1])  # strip outer quotes
" 2>/dev/null)

cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "## Sulcus — Persistent Memory\\n\\nYou have access to Sulcus, a persistent thermodynamic memory system. Memories survive across sessions with heat-based decay.\\n\\n**Stats:** ${TOTAL_NODES} total memories, ${HOT_NODES} hot (active)\\n\\n**MCP Tools Available:**\\n- \`search_memory\` — Semantic search across all memories\\n- \`record_memory\` — Store new memories (types: episodic, semantic, preference, procedural, fact)\\n- \`memory_boost\` / \`memory_deprecate\` — Adjust memory importance\\n- \`create_trigger\` / \`list_triggers\` — Reactive rules that fire on memory events\\n- \`configure_thermodynamics\` — View/adjust decay and heat settings\\n- \`list_hot_nodes\` — See most active memories\\n- \`build_context\` — Get a budget-constrained context block\\n\\n**When to store:** Decisions made, lessons learned, user preferences, important facts, procedures.\\n**When to search:** Questions about past work, incomplete context, references to prior conversations.\\n\\n**Memory types:** episodic (fast decay) · semantic (slow) · preference (slower) · procedural (slowest) · fact (slow)\\n\\n### Active Context\\n${ESCAPED_CONTEXT}"
  }
}
EOF

exit 0
