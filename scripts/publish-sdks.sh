#!/bin/bash
# publish-sdks.sh — Publish Node and Python SDKs if version has changed
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Node SDK ────────────────────────────────────────
echo "=== Node SDK ==="
cd "$REPO_ROOT/sdks/node"

LOCAL_VERSION=$(node -p "require('./package.json').version")
PKG_NAME=$(node -p "require('./package.json').name")
REMOTE_VERSION=$(npm view "$PKG_NAME" version 2>/dev/null || echo "0.0.0")

if [ "$LOCAL_VERSION" != "$REMOTE_VERSION" ]; then
  echo "Publishing $PKG_NAME@$LOCAL_VERSION (remote: $REMOTE_VERSION)"
  npm publish --access public
  echo "✅ Node SDK published: $PKG_NAME@$LOCAL_VERSION"
else
  echo "Node SDK $PKG_NAME@$LOCAL_VERSION already published, skipping."
fi

# ── Python SDK ──────────────────────────────────────
echo ""
echo "=== Python SDK ==="
cd "$REPO_ROOT/sdks/python"

LOCAL_PY_VERSION=$(grep '^version' pyproject.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
REMOTE_PY_VERSION=$(pip index versions sulcus 2>/dev/null | head -1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1 || echo "0.0.0")

if [ "$LOCAL_PY_VERSION" != "$REMOTE_PY_VERSION" ]; then
  echo "Publishing sulcus@$LOCAL_PY_VERSION (remote: $REMOTE_PY_VERSION)"
  python3 -m build 2>/dev/null || pip install build && python3 -m build
  python3 -m twine upload dist/* 2>/dev/null || pip install twine && python3 -m twine upload dist/*
  echo "✅ Python SDK published: sulcus@$LOCAL_PY_VERSION"
else
  echo "Python SDK sulcus@$LOCAL_PY_VERSION already published, skipping."
fi

echo ""
echo "Done."
