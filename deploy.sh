#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Sulcus Server — Build & Deploy
# Usage:
#   ./deploy.sh              # Build + deploy at current version
#   ./deploy.sh --bump patch # Bump patch (2.9.0 → 2.9.1), build, deploy
#   ./deploy.sh --bump minor # Bump minor (2.9.0 → 2.10.0), build, deploy
#   ./deploy.sh --bump major # Bump major (2.9.0 → 3.0.0), build, deploy
#   ./deploy.sh --set 3.0.0  # Set explicit version, build, deploy
#   ./deploy.sh --build-only # Build without deploying
#   ./deploy.sh --dry-run    # Show what would happen without doing it
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_TOML="$REPO_ROOT/crates/sulcus-server/Cargo.toml"

# Read deploy config from [package.metadata.deploy] in Cargo.toml
read_toml() {
  grep "^$1" "$SERVER_TOML" | head -1 | sed 's/.*= *"\(.*\)"/\1/'
}

ACR_REGISTRY=$(read_toml acr_registry)
ACR_IMAGE=$(read_toml acr_image)
CONTAINER_APP=$(read_toml container_app)
RESOURCE_GROUP=$(read_toml resource_group)
API_URL=$(read_toml api_url)
DOCKERFILE=$(read_toml dockerfile)

# Validate required config
for var in ACR_REGISTRY ACR_IMAGE CONTAINER_APP RESOURCE_GROUP API_URL DOCKERFILE; do
  if [[ -z "${!var}" ]]; then
    echo "Error: $var not found in [package.metadata.deploy] of $SERVER_TOML" >&2
    exit 1
  fi
done

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()  { echo -e "${CYAN}[deploy]${NC} $*"; }
ok()   { echo -e "${GREEN}[  ok  ]${NC} $*"; }
warn() { echo -e "${YELLOW}[ warn ]${NC} $*"; }
err()  { echo -e "${RED}[error ]${NC} $*" >&2; }

# ── Parse current version from Cargo.toml ─────────────────────────────────────
get_version() {
  grep '^version' "$SERVER_TOML" | head -1 | sed 's/.*"\(.*\)"/\1/'
}

# ── Set version in Cargo.toml ─────────────────────────────────────────────────
set_version() {
  local new_ver="$1"
  sed -i '' "s/^version = \".*\"/version = \"$new_ver\"/" "$SERVER_TOML"
  ok "Version set to $new_ver in $(basename "$SERVER_TOML")"
}

# ── Bump version ──────────────────────────────────────────────────────────────
bump_version() {
  local cur="$1" part="$2"
  IFS='.' read -r major minor patch <<< "$cur"
  case "$part" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    patch) echo "$major.$minor.$((patch + 1))" ;;
    *) err "Unknown bump type: $part (use major|minor|patch)"; exit 1 ;;
  esac
}

# ── Parse args ────────────────────────────────────────────────────────────────
BUMP=""
SET_VER=""
BUILD_ONLY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)    BUMP="$2"; shift 2 ;;
    --set)     SET_VER="$2"; shift 2 ;;
    --build-only) BUILD_ONLY=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: ./deploy.sh [--bump patch|minor|major] [--set X.Y.Z] [--build-only] [--dry-run]"
      exit 0
      ;;
    *) err "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Main ──────────────────────────────────────────────────────────────────────
cd "$REPO_ROOT"

CURRENT_VER=$(get_version)
log "Current version: $CURRENT_VER"

# Apply version change
if [[ -n "$SET_VER" ]]; then
  NEW_VER="$SET_VER"
elif [[ -n "$BUMP" ]]; then
  NEW_VER=$(bump_version "$CURRENT_VER" "$BUMP")
else
  NEW_VER="$CURRENT_VER"
fi

if [[ "$NEW_VER" != "$CURRENT_VER" ]]; then
  if $DRY_RUN; then
    log "[dry-run] Would bump $CURRENT_VER → $NEW_VER"
  else
    set_version "$NEW_VER"
  fi
else
  log "No version change — deploying $CURRENT_VER"
fi

# Cargo check
log "Running cargo check..."
if $DRY_RUN; then
  log "[dry-run] Would run: cargo check --package sulcus-server"
else
  cargo check --package sulcus-server 2>&1 | tail -3
  ok "Cargo check passed"
fi

# ACR Build
REVISION_SUFFIX="v${NEW_VER//\./-}-$(date +%s)"
log "Building image: $ACR_REGISTRY.azurecr.io/$ACR_IMAGE (revision: $REVISION_SUFFIX)"

if $DRY_RUN; then
  log "[dry-run] Would run: az acr build --registry $ACR_REGISTRY --image $ACR_IMAGE --file $DOCKERFILE ."
else
  az acr build \
    --registry "$ACR_REGISTRY" \
    --image "$ACR_IMAGE" \
    --file "$DOCKERFILE" \
    . 2>&1 | grep -E "^Step|Successfully|digest|error" || true

  # Verify build succeeded
  BUILD_STATUS=$(az acr task list-runs --registry "$ACR_REGISTRY" --top 1 --query '[0].status' -o tsv 2>/dev/null)
  if [[ "$BUILD_STATUS" != "Succeeded" ]]; then
    err "ACR build failed (status: $BUILD_STATUS)"
    err "Check: az acr task list-runs --registry $ACR_REGISTRY --top 1"
    exit 1
  fi
  ok "ACR build succeeded"
fi

# Deploy
if $BUILD_ONLY; then
  ok "Build-only mode — skipping deploy"
  exit 0
fi

log "Deploying to Container Apps..."
if $DRY_RUN; then
  log "[dry-run] Would run: az containerapp update --name $CONTAINER_APP --resource-group $RESOURCE_GROUP --image $ACR_REGISTRY.azurecr.io/$ACR_IMAGE --revision-suffix $REVISION_SUFFIX"
else
  az containerapp update \
    --name "$CONTAINER_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --image "$ACR_REGISTRY.azurecr.io/$ACR_IMAGE" \
    --revision-suffix "$REVISION_SUFFIX" \
    2>&1 | grep -E "provisioningState|revisionSuffix" | head -5

  ok "Revision $REVISION_SUFFIX deployed"
fi

# Deactivate old revisions (keep only the new one)
if ! $DRY_RUN; then
  log "Cleaning up old revisions..."
  OLD_REVISIONS=$(az containerapp revision list \
    --name "$CONTAINER_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --query "[?properties.trafficWeight==\`0\` && properties.active==\`true\`].name" \
    -o tsv 2>/dev/null)

  for rev in $OLD_REVISIONS; do
    az containerapp revision deactivate \
      --name "$CONTAINER_APP" \
      --resource-group "$RESOURCE_GROUP" \
      --revision "$rev" 2>/dev/null && log "Deactivated: $rev" || true
  done
fi

# Health check
log "Waiting for server to respond..."
if ! $DRY_RUN; then
  for i in $(seq 1 20); do
    RESP=$(curl -s --max-time 5 "$API_URL/" 2>/dev/null || echo "")
    if echo "$RESP" | grep -q "SULCUS Server Active"; then
      LIVE_VER=$(echo "$RESP" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+')
      ok "Server live: $RESP"
      if [[ "$LIVE_VER" == "v$NEW_VER" ]]; then
        ok "Version verified: $LIVE_VER ✅"
      else
        warn "Version mismatch! Expected v$NEW_VER, got $LIVE_VER"
      fi
      break
    fi
    sleep 3
  done
fi

# Git commit (if version changed)
if [[ "$NEW_VER" != "$CURRENT_VER" ]] && ! $DRY_RUN; then
  log "Committing version bump..."
  git add "$SERVER_TOML"
  git commit -m "chore(server): bump version to $NEW_VER" --no-verify 2>/dev/null || true
  ok "Committed version $NEW_VER"
fi

echo ""
ok "Deploy complete: sulcus-server v$NEW_VER 🚀"
