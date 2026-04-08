#!/usr/bin/env bash
# Sulcus Memory — PreCompact hook
# Fires before Claude Code compacts the context window.
# Stores an episodic marker so Sulcus knows compaction occurred.
# Fire and forget — non-blocking.
# Supports cloud mode (SULCUS_API_KEY) and local mode (sulcus binary).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_sulcus-lib.sh
source "${SCRIPT_DIR}/_sulcus-lib.sh"

# Skip silently if not configured
if [ "$SULCUS_MODE" = "none" ]; then
  exit 0
fi

COMPACT_MSG='Session compaction occurred. Key context may have been truncated. Review recent memories for continuity.'

# ---------------------------------------------------------------------------
# Cloud mode — fire and forget via curl
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "cloud" ]; then
  curl -sf -X POST "${SULCUS_URL}/api/v1/agent/memory" \
    -H "Authorization: Bearer ${SULCUS_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"${COMPACT_MSG}\", \"memory_type\": \"episodic\", \"train\": false}" \
    > /dev/null 2>&1 &
fi

# ---------------------------------------------------------------------------
# Local mode — fire and forget via JSON-RPC stdio
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "local" ]; then
  ARGS=$(python3 -c "
import json
print(json.dumps({
    'content': '${COMPACT_MSG}',
    'memory_type': 'episodic'
}))
" 2>/dev/null)
  sulcus_local_call "record_memory" "$ARGS" > /dev/null 2>&1 &
fi

exit 0
