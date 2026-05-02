#!/usr/bin/env bash
# build-wasm.sh — Build sulcus-wasm → packages/sulcus-mem
#
# Prerequisites (one-time setup):
#   curl https://sh.rustup.rs -sSf | sh
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-pack

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${SCRIPT_DIR}/packages/sulcus-mem"

echo "==> Building sulcus-wasm for wasm32-unknown-unknown..."
wasm-pack build \
  "${SCRIPT_DIR}/crates/sulcus-wasm" \
  --target web \
  --out-dir "${OUT_DIR}" \
  --release

echo ""
echo "==> Build complete. Output: ${OUT_DIR}/"
echo "    To publish: cd packages/sulcus-mem && npm publish"
echo ""
echo "==> Quick usage in a browser:"
echo "    import init, { SulcusMem } from '${OUT_DIR}/sulcus_wasm.js';"
