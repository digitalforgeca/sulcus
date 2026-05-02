#!/bin/bash
# Sulcus hook: SessionEnd — record session end, cool stale memories
# Input: JSON on stdin with session context

set -euo pipefail

SULCUS_URL="${SULCUS_SERVER_URL:-http://127.0.0.1:3000}"
SULCUS_KEY="${SULCUS_API_KEY:-}"
SULCUS_NS="${SULCUS_NAMESPACE:-default}"

if [ -z "$SULCUS_KEY" ]; then
  exit 0
fi

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

# Record session end
curl -sf -X POST "${SULCUS_URL}/api/v1/agent/nodes" \
  -H "Authorization: Bearer ${SULCUS_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"label\":\"Session ended: ${SESSION_ID} at $(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"memory_type\":\"episodic\",\"namespace\":\"${SULCUS_NS}\"}" \
  > /dev/null 2>&1 || true

exit 0
