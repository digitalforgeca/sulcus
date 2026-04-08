#!/usr/bin/env bash
# Sulcus Memory — TaskCompleted hook
# Fires when Claude Code completes a task.
# Stores a procedural memory summarizing what was accomplished.
# Fire and forget — non-blocking.
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

# Extract task summary from the hook payload
TASK_SUMMARY=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    summary = (
        data.get('task_description') or
        data.get('result') or
        data.get('message') or
        data.get('description') or
        'Task completed'
    )
    print(str(summary)[:500])
except:
    print('Task completed')
" 2>/dev/null)

# ---------------------------------------------------------------------------
# Cloud mode — fire and forget via curl
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "cloud" ]; then
  echo "$TASK_SUMMARY" | python3 -c "
import json, sys
summary = sys.stdin.read().strip()
print(json.dumps({
    'content': 'Completed task: ' + summary,
    'memory_type': 'procedural',
    'train': False
}))
" 2>/dev/null | curl -sf -X POST "${SULCUS_URL}/api/v1/agent/memory" \
    -H "Authorization: Bearer ${SULCUS_KEY}" \
    -H "Content-Type: application/json" \
    -d @- \
    > /dev/null 2>&1 &
fi

# ---------------------------------------------------------------------------
# Local mode — fire and forget via JSON-RPC stdio
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "local" ]; then
  ARGS=$(echo "$TASK_SUMMARY" | python3 -c "
import json, sys
summary = sys.stdin.read().strip()
print(json.dumps({
    'content': 'Completed task: ' + summary,
    'memory_type': 'procedural'
}))
" 2>/dev/null)
  sulcus_local_call "record_memory" "$ARGS" > /dev/null 2>&1 &
fi

exit 0
