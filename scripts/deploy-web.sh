#!/bin/bash
# deploy-web.sh — Build and deploy sulcus-web to Azure Static Web Apps
#
# Ensures NEXT_PUBLIC_* env vars are correctly baked into the static export.
# Includes post-build verification to catch stale URL issues before deploy.
#
# Usage:
#   ./scripts/deploy-web.sh
#   SKIP_BUILD=1 ./scripts/deploy-web.sh   # deploy existing out/ without rebuilding

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$REPO_ROOT/packages/sulcus-web"
DEPLOY_TOKEN="${SWA_DEPLOY_TOKEN:-3f20a855208aa741874053149a6c9822acc1b03ce7706e5fa1f4249d8bdf363f04-8a84b551-8732-4864-a4d5-e15bbc6786fd01e21160863ba31e}"

# ─── Required URLs (these MUST appear in the build) ───
REQUIRED_URL="api.sulcus.ca"

# ─── Banned URLs (these MUST NOT appear in the build) ───
BANNED_PATTERNS=(
  "sulcus-server.calmstone"
  "sulcus-server.*azurecontainerapps.io"
)

echo "=== Sulcus Web Deploy ==="
echo "Web dir: $WEB_DIR"
echo ""

# ─── Step 1: Build ───
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "--- Building (next build with static export) ---"
  cd "$WEB_DIR"

  # Verify .env.production exists and has correct URL
  if ! grep -q "$REQUIRED_URL" .env.production 2>/dev/null; then
    echo "ERROR: .env.production missing or doesn't contain $REQUIRED_URL"
    echo "Expected: NEXT_PUBLIC_SULCUS_SERVER_URL=https://$REQUIRED_URL"
    exit 1
  fi

  # Force clean build
  rm -rf .next out

  # Build with explicit env to be safe
  NEXT_PUBLIC_SULCUS_SERVER_URL="https://api.sulcus.ca" npm run build 2>&1 | tail -5

  if [ ! -f out/index.html ]; then
    echo "ERROR: Build failed — out/index.html not found"
    exit 1
  fi
  echo "  ✓ Build complete"
else
  echo "--- Skipping build (SKIP_BUILD=1) ---"
  if [ ! -f "$WEB_DIR/out/index.html" ]; then
    echo "ERROR: out/index.html not found — cannot deploy without a build"
    exit 1
  fi
fi

# ─── Step 2: Verify build output ───
echo ""
echo "--- Verifying build output ---"

# Check required URL is present
required_count=$(grep -r "$REQUIRED_URL" "$WEB_DIR/out/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$required_count" -eq 0 ]; then
  echo "ERROR: Build output does NOT contain $REQUIRED_URL"
  echo "The API URL was not baked into the build. Check NEXT_PUBLIC_SULCUS_SERVER_URL."
  exit 1
fi
echo "  ✓ Found $REQUIRED_URL in $required_count files"

# Check banned URLs are absent
for pattern in "${BANNED_PATTERNS[@]}"; do
  banned_count=$(grep -rE "$pattern" "$WEB_DIR/out/" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$banned_count" -gt 0 ]; then
    echo "ERROR: Build output contains BANNED URL pattern: $pattern ($banned_count occurrences)"
    echo "This means the env var wasn't baked correctly. Stale build artifacts?"
    echo "Try: rm -rf .next out && rebuild"
    exit 1
  fi
  echo "  ✓ No banned pattern: $pattern"
done

echo "  ✓ All verifications passed"

# ─── Step 3: Deploy ───
echo ""
echo "--- Deploying to Azure Static Web Apps ---"
cd "$WEB_DIR"
swa deploy out --deployment-token "$DEPLOY_TOKEN" --env production 2>&1 | tail -5

echo ""
echo "=== Deploy complete ==="
echo "Verify: https://sulcus.ca/dashboard/memories"
