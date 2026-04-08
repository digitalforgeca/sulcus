#!/usr/bin/env bash
# Sulcus Memory — UserPromptSubmit hook
# Performs a semantic search against Sulcus for every user prompt and injects
# relevant memories as additionalContext so Claude has targeted recall.
# Supports cloud mode (SULCUS_API_KEY) and local mode (sulcus binary).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_sulcus-lib.sh
source "${SCRIPT_DIR}/_sulcus-lib.sh"

# Skip silently if not configured
if [ "$SULCUS_MODE" = "none" ]; then
  exit 0
fi

# Read the hook input from stdin
INPUT=$(cat)

# Extract the user's prompt text
PROMPT=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('prompt', ''))
except:
    print('')
" 2>/dev/null)

# Nothing to search on empty prompt
if [ -z "$PROMPT" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Cloud mode
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "cloud" ]; then
  RESULTS=$(echo "$PROMPT" | python3 -c "
import json, sys
q = sys.stdin.read().strip()
print(json.dumps({'query': q, 'limit': 5}))
" 2>/dev/null | curl -sf -X POST "${SULCUS_URL}/api/v1/agent/search" \
    -H "Authorization: Bearer ${SULCUS_KEY}" \
    -H "Content-Type: application/json" \
    -d @- 2>/dev/null)

  if [ $? -ne 0 ] || [ -z "$RESULTS" ]; then
    exit 0
  fi

  MEMORY_BLOCK=$(echo "$RESULTS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    nodes = data.get('results', data.get('nodes', []))
    if not nodes:
        print('')
        sys.exit(0)
    parts = []
    for n in nodes:
        content = n.get('pointer_summary', n.get('content', n.get('label', '')))
        mtype = n.get('memory_type', 'unknown')
        heat = n.get('current_heat', n.get('heat', 0))
        if content:
            parts.append(f'[{mtype} heat={heat:.2f}] {content[:300]}')
    print('\n'.join(parts))
except:
    print('')
" 2>/dev/null)
fi

# ---------------------------------------------------------------------------
# Local mode
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "local" ]; then
  # Build safe JSON args — pipe prompt through python to avoid injection
  SEARCH_ARGS=$(echo "$PROMPT" | python3 -c "
import sys, json
q = sys.stdin.read().strip()
print(json.dumps({'query': q, 'limit': 5}))
" 2>/dev/null)

  RAW=$(sulcus_local_call "search_memory" "$SEARCH_ARGS")
  MEMORY_BLOCK="$RAW"
fi

# Nothing relevant found — exit cleanly
if [ -z "$MEMORY_BLOCK" ]; then
  exit 0
fi

# Escape for JSON embedding
ESCAPED=$(printf '%s' "$MEMORY_BLOCK" | python3 -c "
import sys, json
text = sys.stdin.read().rstrip()
print(json.dumps(text)[1:-1])  # strip outer quotes
" 2>/dev/null)

cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "## Sulcus — Relevant Memories\\n\\n${ESCAPED}"
  }
}
EOF

exit 0
