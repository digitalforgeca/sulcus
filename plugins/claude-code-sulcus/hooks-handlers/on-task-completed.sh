#!/usr/bin/env bash
# Sulcus Memory — TaskCompleted hook
# Fires when Claude Code completes a task.
# Stores a procedural memory summarizing what was accomplished so future
# sessions can reference completed work without re-reading full context.
# Fire and forget — non-blocking.

SULCUS_URL="${SULCUS_SERVER_URL:-https://api.sulcus.ca}"
SULCUS_KEY="${SULCUS_API_KEY:-}"

# Skip silently if not configured
if [ -z "$SULCUS_KEY" ]; then
  exit 0
fi

# Read the hook input from stdin
INPUT=$(cat)

# Extract task summary from the hook payload
TASK_SUMMARY=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    # TaskCompleted may provide task description, result, or completion message
    summary = (
        data.get('task_description') or
        data.get('result') or
        data.get('message') or
        data.get('description') or
        'Task completed'
    )
    # Truncate to keep memory concise
    print(str(summary)[:500])
except:
    print('Task completed')
" 2>/dev/null)

# Build and store the procedural memory (fire and forget, pipe via stdin to avoid injection)
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

exit 0
