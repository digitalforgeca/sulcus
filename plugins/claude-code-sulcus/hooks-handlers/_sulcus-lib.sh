#!/usr/bin/env bash
# Sulcus hook library — detects local vs cloud mode.
# Source this at the top of every hook that needs Sulcus access.

# ---------------------------------------------------------------------------
# Binary discovery
# ---------------------------------------------------------------------------
find_sulcus_binary() {
  if command -v sulcus &>/dev/null; then
    echo "sulcus"
  elif [ -x "$HOME/.local/bin/sulcus" ]; then
    echo "$HOME/.local/bin/sulcus"
  elif [ -x "$HOME/.local/bin/sulcus-local" ]; then
    echo "$HOME/.local/bin/sulcus-local"
  else
    echo ""
  fi
}

SULCUS_URL="${SULCUS_SERVER_URL:-}"
SULCUS_KEY="${SULCUS_API_KEY:-}"
SULCUS_BIN=$(find_sulcus_binary)
SULCUS_MODE="none"

if [ -n "$SULCUS_KEY" ]; then
  SULCUS_MODE="cloud"
  SULCUS_URL="${SULCUS_URL:-https://api.sulcus.ca}"
elif [ -n "$SULCUS_BIN" ]; then
  SULCUS_MODE="local"
fi

# ---------------------------------------------------------------------------
# sulcus_local_call <tool_name> <json_args>
# Calls a tool on the local sulcus binary via JSON-RPC over stdio.
# Prints the first text content item from the result, or nothing on failure.
# ---------------------------------------------------------------------------
sulcus_local_call() {
  local tool_name="$1"
  local _empty_obj='{}'
  local args="${2:-$_empty_obj}"
  # Use a heredoc to ensure proper line-by-line delivery to the binary.
  # The binary reads JSON-RPC messages one per line.
  local raw
  raw=$("$SULCUS_BIN" stdio 2>/dev/null <<JSONRPC
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hook","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"${tool_name}","arguments":${args}}}
JSONRPC
  )
  # Extract the text content from the last JSON-RPC response
  echo "$raw" | tail -1 | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    content = data.get('result', {}).get('content', [])
    for c in content:
        if c.get('type') == 'text':
            print(c['text'])
            break
except:
    pass
" 2>/dev/null
}

# ---------------------------------------------------------------------------
# sulcus_cloud_post <path> <json_body>
# POST to the cloud API. Returns curl output (may be empty on error).
# ---------------------------------------------------------------------------
sulcus_cloud_post() {
  curl -sf -X POST "${SULCUS_URL}${1}" \
    -H "Authorization: Bearer ${SULCUS_KEY}" \
    -H "Content-Type: application/json" \
    -d "$2" 2>/dev/null
}
