#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hermes-sulcus — Health check
# Quick probe of the Sulcus API. Use in monitoring, cron, or CI.
# Exit 0 = healthy, Exit 1 = unhealthy
# Usage:
#   ./scripts/health.sh              # Uses env vars
#   ./scripts/health.sh --json       # Output JSON
#   ./scripts/health.sh --quiet      # Exit code only
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

JSON=false
QUIET=false

for arg in "$@"; do
  case "$arg" in
    --json) JSON=true ;;
    --quiet|-q) QUIET=true ;;
    --help|-h)
      echo "Usage: $0 [--json|--quiet]"
      exit 0 ;;
  esac
done

# Load env
if [[ -f /opt/data/.env ]]; then
  source /opt/data/.env 2>/dev/null || true
elif [[ -f ~/.hermes/.env ]]; then
  source ~/.hermes/.env 2>/dev/null || true
fi

API_URL="${SULCUS_SERVER_URL:-https://api.sulcus.ca}"
API_KEY="${SULCUS_API_KEY:-}"
NAMESPACE="${SULCUS_NAMESPACE:-}"

if [[ -z "$API_KEY" || -z "$NAMESPACE" ]]; then
  if $JSON; then
    echo '{"status":"error","message":"SULCUS_API_KEY or SULCUS_NAMESPACE not set"}'
  elif ! $QUIET; then
    echo "Error: SULCUS_API_KEY or SULCUS_NAMESPACE not set"
  fi
  exit 1
fi

START_MS=$(($(date +%s%N) / 1000000))

RESPONSE=$(curl -s -w "\n%{http_code}"   -H "Authorization: Bearer $API_KEY"   -H "X-Namespace: $NAMESPACE"   "${API_URL}/api/v1/agent/hot_nodes?namespace=${NAMESPACE}&limit=1"   --connect-timeout 5 --max-time 10 2>/dev/null) || RESPONSE=$'\n000'

END_MS=$(($(date +%s%N) / 1000000))
LATENCY_MS=$((END_MS - START_MS))

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [[ "$HTTP_CODE" == "200" ]]; then
  STATUS="healthy"
  EXIT=0
else
  STATUS="unhealthy"
  EXIT=1
fi

if $JSON; then
  printf '{"status":"%s","http_code":%s,"latency_ms":%s,"api_url":"%s","namespace":"%s"}\n' \
    "$STATUS" "$HTTP_CODE" "$LATENCY_MS" "$API_URL" "$NAMESPACE"
elif ! $QUIET; then
  if [[ $EXIT -eq 0 ]]; then
    echo "✓ Sulcus API healthy (HTTP $HTTP_CODE, ${LATENCY_MS}ms, namespace=$NAMESPACE)"
  else
    echo "✗ Sulcus API unhealthy (HTTP $HTTP_CODE, ${LATENCY_MS}ms)"
  fi
fi

exit $EXIT
