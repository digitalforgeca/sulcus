#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hermes-sulcus — Install plugin into a Hermes Agent profile
# Usage:
#   ./scripts/install.sh                    # Install to default ~/.hermes
#   ./scripts/install.sh /path/to/hermes    # Install to custom HERMES_HOME
#   ./scripts/install.sh --symlink          # Symlink instead of copy (dev)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SYMLINK=false
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"

for arg in "$@"; do
  case "$arg" in
    --symlink) SYMLINK=true ;;
    --help|-h)
      echo "Usage: $0 [--symlink] [HERMES_HOME]"
      echo "  --symlink    Symlink instead of copy (for development)"
      echo "  HERMES_HOME  Target Hermes home directory (default: ~/.hermes)"
      exit 0 ;;
    *) HERMES_HOME="$arg" ;;
  esac
done

DEST="$HERMES_HOME/plugins/sulcus"

echo -e "${GREEN}hermes-sulcus installer${NC}"
echo "Source:  $PLUGIN_DIR"
echo "Target:  $DEST"
echo ""

# Check Hermes home exists
if [[ ! -d "$HERMES_HOME" ]]; then
  echo -e "${RED}Error: HERMES_HOME not found at $HERMES_HOME${NC}"
  echo "Is Hermes Agent installed? Try: pip install hermes-agent"
  exit 1
fi

# Remove old installation
if [[ -e "$DEST" ]]; then
  echo -e "${YELLOW}Removing existing installation...${NC}"
  rm -rf "$DEST"
fi

# Install
mkdir -p "$(dirname "$DEST")"
if $SYMLINK; then
  ln -s "$PLUGIN_DIR" "$DEST"
  echo -e "${GREEN}✓ Symlinked${NC} $PLUGIN_DIR → $DEST"
else
  cp -r "$PLUGIN_DIR" "$DEST"
  # Don't copy scripts/ dir into the plugin install
  rm -rf "$DEST/scripts"
  echo -e "${GREEN}✓ Copied${NC} plugin files to $DEST"
fi

# Check env vars
ENV_FILE="$HERMES_HOME/.env"
MISSING=()
for var in SULCUS_API_KEY SULCUS_SERVER_URL SULCUS_NAMESPACE; do
  if ! grep -q "^$var=" "$ENV_FILE" 2>/dev/null; then
    MISSING+=("$var")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo ""
  echo -e "${YELLOW}⚠ Missing environment variables in $ENV_FILE:${NC}"
  for var in "${MISSING[@]}"; do
    echo "  $var"
  done
  echo ""
  echo "Add them to $ENV_FILE:"
  echo "  SULCUS_API_KEY=sk-your-key-here"
  echo "  SULCUS_SERVER_URL=https://api.sulcus.ca"
  echo "  SULCUS_NAMESPACE=your-agent-name"
fi

# Check config
if grep -q "provider: sulcus" "$HERMES_HOME/config.yaml" 2>/dev/null; then
  echo -e "${GREEN}✓ memory.provider already set to sulcus${NC}"
else
  echo ""
  echo -e "${YELLOW}⚠ Set memory provider:${NC}"
  echo "  hermes config set memory.provider sulcus"
fi

echo ""
echo -e "${GREEN}Done!${NC} Restart Hermes to activate."
