#!/usr/bin/env bash
# Sulcus Memory — PostToolUse hook (Edit/Write/Bash)
# Tracks significant file changes as episodic memories.
# Fire and forget — non-blocking.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_sulcus-lib.sh
source "${SCRIPT_DIR}/_sulcus-lib.sh"

if [ "$SULCUS_MODE" = "none" ]; then
  exit 0
fi

INPUT=$(cat)

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

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

sulcus_store "Modified file: ${FILE_PATH}" "episodic" &
exit 0
