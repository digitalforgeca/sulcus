#!/usr/bin/env bash
# Sulcus Memory — Stop hook
# Fires on Claude Code session shutdown.
# Stores a brief episodic marker so Sulcus knows when sessions ended —
# useful for timeline reconstruction and heat decay accounting.
# Fire and forget — non-blocking.

SULCUS_URL="${SULCUS_SERVER_URL:-https://api.sulcus.ca}"
SULCUS_KEY="${SULCUS_API_KEY:-}"

# Skip silently if not configured
if [ -z "$SULCUS_KEY" ]; then
  exit 0
fi

# Fire and forget — store session end marker as episodic memory
curl -sf -X POST "${SULCUS_URL}/api/v1/agent/memory" \
  -H "Authorization: Bearer ${SULCUS_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"content": "Claude Code session ended.", "memory_type": "episodic", "train": false}' \
  > /dev/null 2>&1 &

exit 0
