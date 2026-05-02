#!/bin/bash
# Sulcus hook: SessionStart — warm recall + boost related memories
# Input: JSON on stdin with session context

set -euo pipefail

SULCUS_URL="${SULCUS_SERVER_URL:-http://127.0.0.1:3000}"
SULCUS_KEY="${SULCUS_API_KEY:-}"
SULCUS_NS="${SULCUS_NAMESPACE:-default}"

if [ -z "$SULCUS_KEY" ]; then
  exit 0  # No API key configured, skip silently
fi

# Read session start context from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

# Record session start as episodic memory
curl -sf -X POST "${SULCUS_URL}/api/v1/agent/nodes" \
  -H "Authorization: Bearer ${SULCUS_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"label\":\"Session started: ${SESSION_ID} at $(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"memory_type\":\"episodic\",\"namespace\":\"${SULCUS_NS}\"}" \
  > /dev/null 2>&1 || true

exit 0
