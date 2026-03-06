#!/usr/bin/env bash
# create_public.sh
# Creates the public `digitalforgeca/sulcus` GitHub repo, extracts
# crates/sulcus-core and crates/sulcus-local into a clean workspace,
# injects a CI workflow, and pushes.

set -euo pipefail

REPO_SLUG="digitalforgeca/sulcus"
SRC_ROOT="$(cd "$(dirname "$0")" && pwd)"   # monorepo root
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[1/7] Checking prerequisites..."
command -v gh  >/dev/null 2>&1 || { echo "ERROR: 'gh' CLI not found."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "ERROR: 'git' not found."; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "ERROR: 'cargo' not found."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: Not authenticated. Run: gh auth login"; exit 1; }

echo "[2/7] Creating public repository $REPO_SLUG..."
if gh repo view "$REPO_SLUG" >/dev/null 2>&1; then
  echo "  Repo already exists, skipping creation."
else
  gh repo create "$REPO_SLUG" \
    --public \
    --description "SULCUS — local-first AI agent memory (vMMU). LWW-CRDT, thermodynamic decay, pgvector, rkyv zero-copy." \
    --homepage "https://github.com/digitalforgeca/sulcus"
fi

echo "[3/7] Extracting crates to $TMP_DIR..."
PUBLIC_ROOT="$TMP_DIR/sulcus"
mkdir -p "$PUBLIC_ROOT/crates"
cp -r "$SRC_ROOT/crates/sulcus-core"  "$PUBLIC_ROOT/crates/sulcus-core"
rsync -a --exclude='.fastembed_cache' "$SRC_ROOT/crates/sulcus-local/" "$PUBLIC_ROOT/crates/sulcus-local/"
for f in LICENSE-MIT Cargo.lock README.md; do
  [ -f "$SRC_ROOT/$f" ] && cp "$SRC_ROOT/$f" "$PUBLIC_ROOT/$f" || true
done

echo "[4/7] Writing workspace Cargo.toml..."
cat > "$PUBLIC_ROOT/Cargo.toml" <<'TOML'
[workspace]
resolver = "2"
members = ["crates/sulcus-core", "crates/sulcus-local"]
default-members = ["crates/sulcus-core", "crates/sulcus-local"]

[workspace.dependencies]
tokio   = { version = "1.36", features = ["full"] }
serde   = { version = "1.0",  features = ["derive"] }
sqlx    = { version = "0.7",  features = ["runtime-tokio-rustls", "postgres", "uuid", "chrono", "macros"] }
axum    = "0.7"
tracing = "0.1"
uuid    = { version = "1.7",  features = ["v4", "v7", "serde"] }
TOML

echo "[5/7] Writing .github/workflows/ci.yml..."
mkdir -p "$PUBLIC_ROOT/.github/workflows"
cat > "$PUBLIC_ROOT/.github/workflows/ci.yml" <<'YAML'
name: CI
on:
  push:
    branches: ["master", "main"]
  pull_request:
    branches: ["master", "main"]

env:
  CARGO_TERM_COLOR: always
  ORT_STRATEGY: download

jobs:
  fmt:
    name: cargo fmt
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt
      - run: cargo fmt --all -- --check

  test:
    name: cargo test
    runs-on: ubuntu-latest
    needs: fmt
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
      - run: cargo build --workspace
      - run: cargo test --workspace

  clippy:
    name: cargo clippy
    runs-on: ubuntu-latest
    needs: fmt
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
          key: ${{ runner.os }}-clippy-${{ hashFiles('**/Cargo.lock') }}
      - run: cargo clippy --workspace --all-targets -- -D warnings
YAML

echo "[6/7] Initialising clean git history..."
cd "$PUBLIC_ROOT"
git init -b master
git config user.name  "Digital Forge"
git config user.email "noreply@digitalforge.ca"
git add -A
git commit -m "chore(release): initial public release of sulcus-core and sulcus-local"

echo "[7/7] Pushing to git@github.com:$REPO_SLUG.git ..."
git remote add origin "git@github.com:$REPO_SLUG.git"
git push -u origin master
echo "Done: https://github.com/$REPO_SLUG"
