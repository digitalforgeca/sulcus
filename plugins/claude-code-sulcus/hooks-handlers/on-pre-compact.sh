#!/usr/bin/env bash
# Sulcus Memory — PreCompact hook
# Fires before Claude Code compacts the context window.
# Stores an episodic marker so Sulcus knows compaction occurred and
# future sessions can account for potential context truncation.
# Fire and forget — non-blocking.

SULCUS_URL="${SULCUS_SERVER_URL:-https://api.sulcus.ca}"
SULCUS_KEY="${SULCUS_API_KEY:-}"

# Skip silently if not configured
if [ -z "$SULCUS_KEY" ]; then
  exit 0
fi

# Fire and forget — store a compaction marker as episodic memory
curl -sf -X POST "${SULCUS_URL}/api/v1/agent/memory" \
  -H "Authorization: Bearer ${SULCUS_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"content": "Session compaction occurred. Key context may have been truncated. Review recent memories for continuity.", "memory_type": "episodic", "train": false}' \
  > /dev/null 2>&1 &

exit 0
