#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hermes-sulcus — Validate installation
# Checks: files exist, env vars set, config correct, API reachable, plugin loads
# Usage:
#   ./scripts/validate.sh               # Check default ~/.hermes
#   ./scripts/validate.sh /opt/data     # Check custom HERMES_HOME
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
HERMES_HOME="${1:-${HERMES_HOME:-$HOME/.hermes}}"
ERRORS=0

echo -e "${CYAN}hermes-sulcus validation${NC}"
echo "HERMES_HOME: $HERMES_HOME"
echo ""

check() {
  local label="$1"
  local result="$2"
  if [[ "$result" == "ok" ]]; then
    echo -e "  ${GREEN}✓${NC} $label"
  elif [[ "$result" == "warn" ]]; then
    echo -e "  ${YELLOW}⚠${NC} $label"
  else
    echo -e "  ${RED}✗${NC} $label — $result"
    ((ERRORS++))
  fi
}

# ── File checks ───────────────────────────────────────────────────────────────
echo -e "${CYAN}Files${NC}"
PLUGIN_DIR="$HERMES_HOME/plugins/sulcus"

if [[ -f "$PLUGIN_DIR/__init__.py" ]]; then
  check "__init__.py exists" "ok"
else
  check "__init__.py exists" "not found at $PLUGIN_DIR/__init__.py"
fi

if [[ -f "$PLUGIN_DIR/plugin.yaml" ]]; then
  check "plugin.yaml exists" "ok"
else
  check "plugin.yaml exists" "not found"
fi

# ── Environment ───────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Environment${NC}"

ENV_FILE="$HERMES_HOME/.env"
if [[ -f "$ENV_FILE" ]]; then
  source "$ENV_FILE" 2>/dev/null || true
fi

for var in SULCUS_API_KEY SULCUS_SERVER_URL SULCUS_NAMESPACE; do
  val="${!var:-}"
  if [[ -n "$val" ]]; then
    # Mask the value
    if [[ "$var" == "SULCUS_API_KEY" ]]; then
      display="${val:0:4}..."
    else
      display="$val"
    fi
    check "$var = $display" "ok"
  else
    check "$var" "not set"
  fi
done

# ── Config ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Config${NC}"

CONFIG="$HERMES_HOME/config.yaml"
if [[ -f "$CONFIG" ]]; then
  if grep -q "provider:.*sulcus" "$CONFIG" 2>/dev/null; then
    check "memory.provider = sulcus" "ok"
  else
    check "memory.provider" "not set to sulcus in $CONFIG"
  fi
else
  check "config.yaml" "not found at $CONFIG"
fi

# ── API connectivity ──────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}API${NC}"

if [[ -n "${SULCUS_SERVER_URL:-}" && -n "${SULCUS_API_KEY:-}" && -n "${SULCUS_NAMESPACE:-}" ]]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}"     -H "Authorization: Bearer $SULCUS_API_KEY"     -H "X-Namespace: $SULCUS_NAMESPACE"     "${SULCUS_SERVER_URL}/api/v1/agent/hot_nodes?namespace=${SULCUS_NAMESPACE}&limit=1"     --connect-timeout 5 --max-time 10 2>/dev/null || echo "000")
  
  case "$HTTP_CODE" in
    200) check "API reachable (HTTP $HTTP_CODE)" "ok" ;;
    401) check "API reachable" "HTTP 401 — bad API key" ;;
    403) check "API reachable" "HTTP 403 — namespace not authorized" ;;
    000) check "API reachable" "connection failed to $SULCUS_SERVER_URL" ;;
    *)   check "API reachable" "HTTP $HTTP_CODE" ;;
  esac
  
  # Count memories
  COUNT=$(curl -s     -H "Authorization: Bearer $SULCUS_API_KEY"     -H "X-Namespace: $SULCUS_NAMESPACE"     "${SULCUS_SERVER_URL}/api/v1/agent/hot_nodes?namespace=${SULCUS_NAMESPACE}&limit=50"     --connect-timeout 5 --max-time 10 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        print(len(data))
    else:
        print(len(data.get('nodes', data.get('results', []))))
except: print('?')
" 2>/dev/null || echo "?")
  
  check "Memories in namespace: $COUNT" "ok"
else
  check "API connectivity" "skipped — missing env vars"
fi

# ── Plugin load test ──────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Plugin Load${NC}"

PYTHON=""
for candidate in /opt/hermes/.venv/bin/python3 python3; do
  if command -v "$candidate" &>/dev/null; then
    PYTHON="$candidate"
    break
  fi
done

if [[ -n "$PYTHON" && -d "/opt/hermes" ]]; then
  LOAD_RESULT=$($PYTHON -c "
import sys
sys.path.insert(0, '/opt/hermes')
from plugins.memory import load_memory_provider
p = load_memory_provider('sulcus')
if p:
    print(f'name={p.name} available={p.is_available()} tools={len(p.get_tool_schemas())}')
else:
    print('NOTFOUND')
" 2>&1) || LOAD_RESULT="FAILED: $LOAD_RESULT"
  
  if [[ "$LOAD_RESULT" == *"name=sulcus"* ]]; then
    check "Plugin loads: $LOAD_RESULT" "ok"
  elif [[ "$LOAD_RESULT" == "NOTFOUND" ]]; then
    check "Plugin loads" "provider not found by Hermes plugin loader"
  else
    check "Plugin loads" "$LOAD_RESULT"
  fi
else
  check "Plugin load test" "skipped — Hermes not found at /opt/hermes"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [[ $ERRORS -eq 0 ]]; then
  echo -e "${GREEN}All checks passed ✓${NC}"
else
  echo -e "${RED}$ERRORS check(s) failed${NC}"
  exit 1
fi
