#!/usr/bin/env bash
# Sulcus Memory — TaskCompleted hook
# Fires when Claude Code completes a task.
# Stores a procedural memory summarizing what was accomplished.
# Fire and forget — non-blocking.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_sulcus-lib.sh
source "${SCRIPT_DIR}/_sulcus-lib.sh"

if [ "$SULCUS_MODE" = "none" ]; then
  exit 0
fi

INPUT=$(cat)

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

sulcus_store "Completed task: ${TASK_SUMMARY}" "procedural" &
exit 0
