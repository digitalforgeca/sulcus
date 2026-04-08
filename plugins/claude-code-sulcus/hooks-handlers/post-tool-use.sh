#!/usr/bin/env bash
# Sulcus Memory — PostToolUse hook (Edit/Write)
# Tracks significant file changes as episodic memories.
# Fire and forget — non-blocking.
# Supports cloud mode (SULCUS_API_KEY) and local mode (sulcus binary).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_sulcus-lib.sh
source "${SCRIPT_DIR}/_sulcus-lib.sh"

# Skip silently if not configured
if [ "$SULCUS_MODE" = "none" ]; then
  exit 0
fi

# Read tool use info from stdin
INPUT=$(cat)

# Extract file path from the tool input
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tool_input = data.get('tool_input', data.get('input', {}))
    path = tool_input.get('file_path', tool_input.get('path', ''))
    print(path)
except:
    print('')
" 2>/dev/null)

# Only track if we got a file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Cloud mode — fire and forget via curl
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "cloud" ]; then
  echo "$FILE_PATH" | python3 -c "
import json, sys
fpath = sys.stdin.read().strip()
print(json.dumps({
    'content': 'Modified file: ' + fpath,
    'memory_type': 'episodic',
    'train': False
}))
" 2>/dev/null | curl -sf -X POST "${SULCUS_URL}/api/v1/agent/memory" \
    -H "Authorization: Bearer ${SULCUS_KEY}" \
    -H "Content-Type: application/json" \
    -d @- > /dev/null 2>&1 &
fi

# ---------------------------------------------------------------------------
# Local mode — fire and forget via JSON-RPC stdio
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "local" ]; then
  ARGS=$(echo "$FILE_PATH" | python3 -c "
import json, sys
fpath = sys.stdin.read().strip()
print(json.dumps({
    'content': 'Modified file: ' + fpath,
    'memory_type': 'episodic'
}))
" 2>/dev/null)
  sulcus_local_call "record_memory" "$ARGS" > /dev/null 2>&1 &
fi

exit 0
