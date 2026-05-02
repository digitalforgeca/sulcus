#!/bin/bash
# Sulcus hook: Stop — capture significant decisions/insights from the turn
# Input: JSON on stdin with agent response

set -euo pipefail

SULCUS_URL="${SULCUS_SERVER_URL:-http://127.0.0.1:3000}"
SULCUS_KEY="${SULCUS_API_KEY:-}"
SULCUS_NS="${SULCUS_NAMESPACE:-default}"

if [ -z "$SULCUS_KEY" ]; then
  exit 0
fi

INPUT=$(cat)

# Extract assistant's response text
RESPONSE=$(echo "$INPUT" | jq -r '.response // .message // .content // ""' 2>/dev/null || echo "")

if [ ${#RESPONSE} -lt 30 ]; then
  exit 0
fi

# Check if the response contains decisions/insights worth capturing
# (Simple pattern matching — SIU on the server will properly classify)
if echo "$RESPONSE" | grep -qiE '(decided|will use|our approach|preference|important|remember|lesson|key takeaway|going with)'; then
  CLEANED=$(echo "$RESPONSE" | head -c 2000)

  curl -sf -X POST "${SULCUS_URL}/api/v1/agent/nodes" \
    -H "Authorization: Bearer ${SULCUS_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg label "$CLEANED" --arg ns "$SULCUS_NS" '{
      label: $label,
      memory_type: "semantic",
      namespace: $ns
    }')" \
    > /dev/null 2>&1 || true
fi

exit 0
