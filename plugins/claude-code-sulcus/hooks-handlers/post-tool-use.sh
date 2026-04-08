#!/usr/bin/env bash
# Sulcus Memory — PostToolUse hook (Edit/Write)
# Tracks significant file changes as episodic memories.
# This is a lightweight hook — only fires on Edit/Write tool uses.

SULCUS_URL="${SULCUS_SERVER_URL:-https://api.sulcus.ca}"
SULCUS_KEY="${SULCUS_API_KEY:-}"

# Skip if not configured
if [ -z "$SULCUS_KEY" ]; then
  exit 0
fi

# Read tool use info from stdin (Claude Code passes JSON)
INPUT=$(cat)

# Extract file path from the tool input
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tool_input = data.get('tool_input', data.get('input', {}))
    # Edit tool uses 'file_path' or 'path', Write uses 'file_path'
    path = tool_input.get('file_path', tool_input.get('path', ''))
    print(path)
except:
    print('')
" 2>/dev/null)

# Only track if we got a file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Store as episodic memory (fire and forget, non-blocking, pipe via stdin)
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

exit 0
