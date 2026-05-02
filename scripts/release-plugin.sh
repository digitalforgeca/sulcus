#!/usr/bin/env bash
# Release the openclaw-sulcus plugin.
# Usage: ./scripts/release-plugin.sh [--dry-run]
#
# Reads version from packages/openclaw-sulcus/package.json,
# creates a git tag `plugin-v<version>`, and pushes it.
# The GitHub Actions workflow handles npm + ClawHub + GH release.
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=true; fi

cd "$(git rev-parse --show-toplevel)"

VERSION=$(node -p "require('./packages/openclaw-sulcus/package.json').version")
TAG="plugin-v${VERSION}"

echo "📦 openclaw-sulcus v${VERSION}"
echo "🏷️  Tag: ${TAG}"

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "❌ Tag $TAG already exists. Bump version in package.json first."
  exit 1
fi

# Check working tree is clean
if [[ -n "$(git status --porcelain packages/openclaw-sulcus/)" ]]; then
  echo "⚠️  Uncommitted changes in packages/openclaw-sulcus/. Commit first."
  exit 1
fi

if $DRY_RUN; then
  echo "🏁 Dry run — would create and push tag: $TAG"
  exit 0
fi

git tag -a "$TAG" -m "release: openclaw-sulcus v${VERSION}"
git push origin "$TAG"

echo "✅ Tag $TAG pushed. GitHub Actions will handle npm + ClawHub + GH Release."
echo "   Watch: https://github.com/digitalforgeca/sulcus/actions"
