#!/bin/bash
set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>  (e.g. $0 0.1.0)" >&2
  exit 1
fi

# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be in semver format X.Y.Z (got '$VERSION')" >&2
  exit 1
fi

TAG="v${VERSION}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "==> Creating GitHub release $TAG"
gh release create "$TAG" \
  --title "Sulcus $TAG" \
  --generate-notes \
  --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo '')"

echo "==> Release $TAG created."

# Deploy hook
if [[ "${DEPLOY:-0}" == "1" ]]; then
  echo "==> DEPLOY=1 detected — running update_azure.sh"
  bash "${REPO_ROOT}/update_azure.sh"
  echo "==> Azure deployment complete."
else
  echo "==> Skipping deployment (set DEPLOY=1 to deploy to Azure)."
fi
