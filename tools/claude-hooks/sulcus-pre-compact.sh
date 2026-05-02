#!/bin/bash
# Sulcus hook: PreCompact — preserve important memories before compaction
# Input: JSON on stdin with conversation context

set -euo pipefail

SULCUS_URL="${SULCUS_SERVER_URL:-http://127.0.0.1:3000}"
SULCUS_KEY="${SULCUS_API_KEY:-}"
SULCUS_NS="${SULCUS_NAMESPACE:-default}"

if [ -z "$SULCUS_KEY" ]; then
  exit 0
fi

INPUT=$(cat)

# Extract the last few significant messages from the context being compacted
MESSAGES=$(echo "$INPUT" | jq -r '
  (.messages // .conversation // [])[-10:]
  | map(select(.content != null and (.content | length) > 30))
  | map(.content)
  | join("\n---\n")
' 2>/dev/null || echo "")

if [ ${#MESSAGES} -lt 30 ]; then
  exit 0
fi

# Store a compaction summary
SUMMARY="Pre-compaction capture: $(echo "$MESSAGES" | head -c 2000)"

curl -sf -X POST "${SULCUS_URL}/api/v1/agent/nodes" \
  -H "Authorization: Bearer ${SULCUS_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg label "$SUMMARY" --arg ns "$SULCUS_NS" '{
    label: $label,
    memory_type: "episodic",
    namespace: $ns
  }')" \
  > /dev/null 2>&1 || true

exit 0
