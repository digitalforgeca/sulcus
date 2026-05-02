#!/usr/bin/env bash
# setup-local.sh — One-command local Sulcus setup
# Builds native dylibs + installs ONNX Runtime + copies to ~/.sulcus/lib/
#
# Usage:
#   ./scripts/setup-local.sh          # build + install everything
#   ./scripts/setup-local.sh --check  # just verify what's installed
set -euo pipefail

LIB_DIR="${SULCUS_LIB_DIR:-$HOME/.sulcus/lib}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ─── Colors ───
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }

# ─── Platform detection ───
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin)
    STORE_LIB="libsulcus_store.dylib"
    VECTORS_LIB="libsulcus_vectors.dylib"
    ONNX_LIB="libonnxruntime.dylib"
    ;;
  Linux)
    STORE_LIB="libsulcus_store.so"
    VECTORS_LIB="libsulcus_vectors.so"
    ONNX_LIB="libonnxruntime.so"
    ;;
  *)
    fail "Unsupported OS: $OS"
    exit 1
    ;;
esac

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Sulcus Local Setup  ($OS/$ARCH)"
echo "  Target: $LIB_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── Check mode ───
if [[ "${1:-}" == "--check" ]]; then
  echo "Checking local Sulcus installation..."
  echo ""

  # ONNX Runtime
  if ldconfig -p 2>/dev/null | grep -q libonnxruntime || \
     [ -f "/usr/local/lib/$ONNX_LIB" ] || \
     (command -v brew &>/dev/null && brew list onnxruntime &>/dev/null); then
    ok "ONNX Runtime installed"
  else
    fail "ONNX Runtime not found"
  fi

  # Store dylib
  if [ -f "$LIB_DIR/$STORE_LIB" ]; then
    ok "sulcus-store dylib: $LIB_DIR/$STORE_LIB"
  else
    fail "sulcus-store dylib not found"
  fi

  # Vectors dylib
  if [ -f "$LIB_DIR/$VECTORS_LIB" ]; then
    ok "sulcus-vectors dylib: $LIB_DIR/$VECTORS_LIB"
  else
    fail "sulcus-vectors dylib not found"
  fi

  # Rust toolchain
  if command -v cargo &>/dev/null; then
    ok "Rust toolchain: $(cargo --version)"
  else
    fail "Rust toolchain not found"
  fi

  echo ""
  exit 0
fi

# ─── Step 1: ONNX Runtime ───
echo "Step 1/4: ONNX Runtime"
ONNX_INSTALLED=false

if [ "$OS" = "Darwin" ]; then
  if command -v brew &>/dev/null && brew list onnxruntime &>/dev/null; then
    ok "Already installed via Homebrew"
    ONNX_INSTALLED=true
  else
    echo "  Installing via Homebrew..."
    if command -v brew &>/dev/null; then
      brew install onnxruntime
      ok "Installed via Homebrew"
      ONNX_INSTALLED=true
    else
      fail "Homebrew not found. Install ONNX Runtime manually:"
      echo "  https://github.com/microsoft/onnxruntime/releases"
      exit 1
    fi
  fi
elif [ "$OS" = "Linux" ]; then
  if ldconfig -p 2>/dev/null | grep -q libonnxruntime || [ -f "/usr/local/lib/$ONNX_LIB" ]; then
    ok "Already installed"
    ONNX_INSTALLED=true
  else
    ONNX_VERSION="1.23.2"
    echo "  Installing ONNX Runtime $ONNX_VERSION..."
    ONNX_ARCH="x64"
    [[ "$ARCH" == "aarch64" ]] && ONNX_ARCH="aarch64"
    curl -sL "https://github.com/microsoft/onnxruntime/releases/download/v${ONNX_VERSION}/onnxruntime-linux-${ONNX_ARCH}-${ONNX_VERSION}.tgz" \
      | tar xz -C /tmp
    sudo cp /tmp/onnxruntime-linux-${ONNX_ARCH}-${ONNX_VERSION}/lib/libonnxruntime.so.${ONNX_VERSION} /usr/local/lib/
    sudo ln -sf libonnxruntime.so.${ONNX_VERSION} /usr/local/lib/libonnxruntime.so.1
    sudo ln -sf libonnxruntime.so.1 /usr/local/lib/libonnxruntime.so
    sudo ldconfig
    rm -rf /tmp/onnxruntime-*
    ok "Installed to /usr/local/lib/"
    ONNX_INSTALLED=true
  fi
fi
echo ""

# ─── Step 2: Check Rust ───
echo "Step 2/4: Rust toolchain"
if ! command -v cargo &>/dev/null; then
  fail "Rust not found. Install: https://rustup.rs"
  exit 1
fi
ok "$(cargo --version)"
echo ""

# ─── Step 3: Build dylibs ───
echo "Step 3/4: Building native dylibs (this may take a few minutes)..."
cd "$REPO_ROOT"

echo "  Building sulcus-store..."
cargo build --release -p sulcus-store 2>&1 | tail -1
ok "sulcus-store built"

echo "  Building sulcus-vectors..."
cargo build --release -p sulcus-vectors 2>&1 | tail -1
ok "sulcus-vectors built"
echo ""

# ─── Step 4: Install to ~/.sulcus/lib/ ───
echo "Step 4/4: Installing to $LIB_DIR"
mkdir -p "$LIB_DIR"

cp "target/release/$STORE_LIB" "$LIB_DIR/"
ok "$STORE_LIB → $LIB_DIR/"

cp "target/release/$VECTORS_LIB" "$LIB_DIR/"
ok "$VECTORS_LIB → $LIB_DIR/"

# Clean up old renamed dylib if present
if [ -f "$LIB_DIR/libsulcus_embed.dylib" ] || [ -f "$LIB_DIR/libsulcus_embed.so" ]; then
  rm -f "$LIB_DIR/libsulcus_embed.dylib" "$LIB_DIR/libsulcus_embed.so"
  warn "Removed old libsulcus_embed (renamed to sulcus-vectors)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}Setup complete!${NC}"
echo ""
echo "  Library dir:  $LIB_DIR"
echo "  Store:        $LIB_DIR/$STORE_LIB"
echo "  Vectors:      $LIB_DIR/$VECTORS_LIB"
echo ""
echo "  The openclaw-sulcus plugin will auto-detect these"
echo "  dylibs at startup. No config needed."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
