#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hermes-sulcus — Uninstall
# Usage:
#   ./scripts/uninstall.sh                    # Uninstall from default ~/.hermes
#   ./scripts/uninstall.sh /path/to/hermes    # Uninstall from custom location
#   ./scripts/uninstall.sh --keep-config      # Remove plugin but keep env vars
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
KEEP_CONFIG=false

for arg in "$@"; do
  case "$arg" in
    --keep-config) KEEP_CONFIG=true ;;
    --help|-h)
      echo "Usage: $0 [--keep-config] [HERMES_HOME]"
      exit 0 ;;
    *) HERMES_HOME="$arg" ;;
  esac
done

DEST="$HERMES_HOME/plugins/sulcus"

echo -e "${YELLOW}hermes-sulcus uninstaller${NC}"
echo "HERMES_HOME: $HERMES_HOME"
echo ""

if [[ ! -e "$DEST" ]]; then
  echo -e "${YELLOW}Plugin not found at $DEST — nothing to remove${NC}"
  exit 0
fi

# Remove plugin
rm -rf "$DEST"
echo -e "${GREEN}✓${NC} Removed $DEST"

if ! $KEEP_CONFIG; then
  # Remove env vars from .env
  ENV_FILE="$HERMES_HOME/.env"
  if [[ -f "$ENV_FILE" ]]; then
    REMOVED=0
    for var in SULCUS_API_KEY SULCUS_SERVER_URL SULCUS_NAMESPACE; do
      if grep -q "^$var=" "$ENV_FILE"; then
        sed -i "/^$var=/d" "$ENV_FILE"
        ((REMOVED++))
      fi
    done
    if [[ $REMOVED -gt 0 ]]; then
      echo -e "${GREEN}✓${NC} Removed $REMOVED env var(s) from $ENV_FILE"
    fi
  fi
fi

echo ""
echo -e "${GREEN}Done.${NC} Run 'hermes config set memory.provider ""' to clear the memory provider config."
