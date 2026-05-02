#!/usr/bin/env bash
# Release the openclaw-sulcus-skill.
# Usage: ./scripts/release-skill.sh <version> [--dry-run]
#
# Creates a git tag `skill-v<version>` and pushes it.
# The GitHub Actions workflow handles ClawHub + GH release.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <version> [--dry-run]"
  echo "Example: $0 1.0.0"
  exit 1
fi

VERSION="$1"
DRY_RUN=false
if [[ "${2:-}" == "--dry-run" ]]; then DRY_RUN=true; fi

cd "$(git rev-parse --show-toplevel)"

TAG="skill-v${VERSION}"

echo "📦 openclaw-sulcus-skill v${VERSION}"
echo "🏷️  Tag: ${TAG}"

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "❌ Tag $TAG already exists."
  exit 1
fi

# Check SKILL.md exists
if [[ ! -f "skills/openclaw-sulcus-skill/SKILL.md" ]]; then
  echo "❌ skills/openclaw-sulcus-skill/SKILL.md not found"
  exit 1
fi

if $DRY_RUN; then
  echo "🏁 Dry run — would create and push tag: $TAG"
  exit 0
fi

git tag -a "$TAG" -m "release: openclaw-sulcus-skill v${VERSION}"
git push origin "$TAG"

echo "✅ Tag $TAG pushed. GitHub Actions will handle ClawHub + GH Release."
echo "   Watch: https://github.com/digitalforgeca/sulcus/actions"
