#!/usr/bin/env bash
# Sulcus Memory — PreToolUse hook (Write/Edit)
# Guards against Claude directly writing to Sulcus memory paths.
# Claude should always use Sulcus MCP tools to manage memory, not raw file writes.

# Read the hook input from stdin
INPUT=$(cat)

# Extract the file path from the tool input
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

# If we can't determine the path, allow by default
if [ -z "$FILE_PATH" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Check if the path targets Sulcus-managed memory locations
if echo "$FILE_PATH" | grep -qE '(^|/)(\.(sulcus)|MEMORY\.md|memory/)'; then
  cat << 'EOF'
{
  "decision": "block",
  "reason": "Use Sulcus MCP tools to manage memory, not direct file writes. Available tools: record_memory, search_memory, memory_boost, memory_deprecate, forget_memory."
}
EOF
  exit 0
fi

echo '{"decision": "allow"}'
exit 0
