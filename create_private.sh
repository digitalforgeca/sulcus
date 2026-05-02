#!/usr/bin/env bash
# create_private.sh
# Creates the private `digitalforgeca/sulcus-enterprise` GitHub repo and pushes the full monorepo.

set -euo pipefail

REPO_SLUG="digitalforgeca/sulcus-enterprise"
SRC_ROOT="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[1/7] Checking prerequisites..."
command -v gh  >/dev/null 2>&1 || { echo "ERROR: 'gh' CLI not found."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "ERROR: 'git' not found."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: Not authenticated. Run: gh auth login"; exit 1; }

echo "[2/7] Creating private repository $REPO_SLUG..."
if gh repo view "$REPO_SLUG" >/dev/null 2>&1; then
  echo "  Repo already exists, skipping creation."
else
  gh repo create "$REPO_SLUG" \
    --private \
    --description "SULCUS Enterprise — private monorepo including web dashboard, billing, and server sync."
fi

echo "[3/7] Staging monorepo (excluding targets/node_modules/secrets)..."
PRIVATE_ROOT="$TMP_DIR/sulcus-enterprise"
mkdir -p "$PRIVATE_ROOT"

# Copy exactly what's tracked in git to avoid accidentally including .env files
cd "$SRC_ROOT"
git archive HEAD | tar -x -C "$PRIVATE_ROOT"

echo "[4/7] Writing .github/workflows/ci.yml..."
mkdir -p "$PRIVATE_ROOT/.github/workflows"
cat > "$PRIVATE_ROOT/.github/workflows/ci.yml" <<'YAML'
name: CI
on:
  push:
    branches: ["master", "main"]
  pull_request:
    branches: ["master", "main"]

jobs:
  web-build:
    name: Build Next.js
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: 'packages/sulcus-web/package-lock.json'
      - run: cd packages/sulcus-web && npm ci
      # Provide dummy env vars for build time since NEXT_PUBLIC requires them
      - run: cd packages/sulcus-web && NEXT_PUBLIC_SULCUS_SERVER_URL=http://localhost:3000 NEXT_PUBLIC_SULCUS_API_KEY=test npm run build

  server-check:
    name: Rust Check & Clippy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy
      - uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: ${{ runner.os }}-cargo-server-${{ hashFiles('**/Cargo.lock') }}
      - run: cargo check --workspace --exclude sulcus-wasm
      - run: cargo clippy --workspace --exclude sulcus-wasm --all-targets -- -D warnings
YAML

echo "[6/7] Initialising clean git history..."
cd "$PRIVATE_ROOT"
git init -b master
git config user.name  "Digital Forge"
git config user.email "noreply@digitalforge.ca"
git add -A
git commit -m "chore: initial enterprise monorepo commit"

echo "[7/7] Pushing to git@github.com:$REPO_SLUG.git ..."
git remote add origin "git@github.com:$REPO_SLUG.git"
git push -u origin master --force
echo "Done: https://github.com/$REPO_SLUG"
