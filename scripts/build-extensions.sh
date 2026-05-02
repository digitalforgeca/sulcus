#!/bin/bash
# build-extensions.sh — Build sulcus extension dylibs and stage on Forge VPS.
#
# Builds for available platforms, uploads to Forge VPS for delivery via
# /api/v1/extensions/{component}?platform={platform}
#
# Usage:
#   ./scripts/build-extensions.sh [version] [component...]
#   ./scripts/build-extensions.sh v0.1.0                  # all components
#   ./scripts/build-extensions.sh v0.1.0 siu sync         # specific components
#
# Components: siu, sync, embed, store
# Platforms: darwin-x86_64 (native), linux-x86_64 (Docker or VPS)
#
# The Forge VPS serves binaries at:
#   https://extensions.technocraftonline.com/{version}/{component}/{platform}/libsulcus_{component}.{ext}

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VPS="dforge-vps"
EXTENSION_BASE="/opt/forge/services/dionysus/sites/extensions"
VERSION="${1:-v0.1.0}"
shift 2>/dev/null || true

# Default: build all components
if [ $# -eq 0 ]; then
    COMPONENTS=(siu sync)
else
    COMPONENTS=("$@")
fi

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

# Component → crate / libname helpers (bash 3.2 compatible)
get_crate() {
    case "$1" in
        siu)  echo "sulcus-siu" ;;
        sync) echo "sulcus-sync" ;;
        *)    echo "" ;;
    esac
}
get_libname() {
    case "$1" in
        siu)  echo "libsulcus_siu" ;;
        sync) echo "libsulcus_sync" ;;
        *)    echo "" ;;
    esac
}

echo "=== Sulcus Extension Builder ==="
echo "Version:    $VERSION"
echo "Components: ${COMPONENTS[*]}"
echo ""

for component in "${COMPONENTS[@]}"; do
    crate="$(get_crate "$component")"
    libname="$(get_libname "$component")"

    if [ -z "$crate" ]; then
        echo "⚠ Unknown component: $component (skipping)"
        continue
    fi

    echo "━━━ Building $component ($crate) ━━━"

    # 1. Native build (darwin-x86_64 on this machine)
    echo "  [darwin-x86_64] Building..."
    cd "$REPO_ROOT"

    # sulcus-siu is excluded from workspace, needs special handling
    if [ "$component" = "siu" ]; then
        cd "$REPO_ROOT/crates/sulcus-siu"
        cargo build --release 2>&1 | tail -3
        NATIVE_DYLIB="$REPO_ROOT/crates/sulcus-siu/target/release/${libname}.dylib"
    else
        cargo build --release -p "$crate" 2>&1 | tail -3
        NATIVE_DYLIB="$REPO_ROOT/target/release/${libname}.dylib"
    fi

    if [ -f "$NATIVE_DYLIB" ]; then
        mkdir -p "$TMPDIR/$component/darwin-x86_64"
        cp "$NATIVE_DYLIB" "$TMPDIR/$component/darwin-x86_64/${libname}.dylib"
        echo "  [darwin-x86_64] ✓ $(du -h "$NATIVE_DYLIB" | cut -f1)"
    else
        echo "  [darwin-x86_64] ✗ build failed"
    fi

    # 2. Copy model files for SIU
    if [ "$component" = "siu" ]; then
        MODEL_DIR="$REPO_ROOT/crates/sulcus-siu/model"
        if [ -d "$MODEL_DIR" ]; then
            mkdir -p "$TMPDIR/$component/model"
            cp "$MODEL_DIR"/*.onnx "$TMPDIR/$component/model/" 2>/dev/null || true
            cp "$MODEL_DIR"/*.json "$TMPDIR/$component/model/" 2>/dev/null || true
            echo "  [model] ✓ $(ls "$TMPDIR/$component/model/" | wc -l | tr -d ' ') model files"
        fi
    fi

    echo ""
done

# 3. Build linux-x86_64 on Forge VPS via SSH
echo "━━━ Building linux-x86_64 on Forge VPS ━━━"
echo ""

# Create a minimal source tarball
echo "  Preparing build context..."
BUILD_CTX="$TMPDIR/build-ctx"
mkdir -p "$BUILD_CTX"
rsync -a --exclude='target' --exclude='packages' --exclude='sdks' \
    --exclude='marketing' --exclude='output' --exclude='vscode-sulcus' \
    --exclude='integrations' --exclude='.git' --exclude='.fastembed_cache' \
    --exclude='tests' --exclude='docker' --exclude='node_modules' \
    "$REPO_ROOT/" "$BUILD_CTX/"

TARBALL="$TMPDIR/sulcus-src.tar.gz"
tar -czf "$TARBALL" -C "$BUILD_CTX" .
echo "  Build context: $(du -h "$TARBALL" | cut -f1)"

# Upload and build on VPS
echo "  Uploading to VPS..."
scp -q "$TARBALL" "$VPS:/tmp/sulcus-ext-build.tar.gz"

for component in "${COMPONENTS[@]}"; do
    crate="$(get_crate "$component")"
    libname="$(get_libname "$component")"
    [ -z "$crate" ] && continue

    echo "  [linux-x86_64] Building $component..."

    REMOTE_LIB=$(ssh "$VPS" bash -s <<REMOTE_EOF
set -e
cd /tmp
rm -rf sulcus-ext-build 2>/dev/null || true
mkdir -p sulcus-ext-build
tar -xzf sulcus-ext-build.tar.gz -C sulcus-ext-build
cd sulcus-ext-build

source \$HOME/.cargo/env 2>/dev/null || true

if [ "$component" = "siu" ]; then
    cd crates/sulcus-siu
    cargo build --release 2>&1 >&2
    BUILT="target/release/${libname}.so"
else
    cargo build --release -p "$crate" 2>&1 >&2
    BUILT="target/release/${libname}.so"
fi

if [ -f "\$BUILT" ]; then
    cp "\$BUILT" /tmp/${libname}.so
    echo "/tmp/${libname}.so"
else
    echo "FAILED" >&2
    echo "FAILED"
fi
REMOTE_EOF
    )

    if [ "$REMOTE_LIB" = "FAILED" ] || [ -z "$REMOTE_LIB" ]; then
        echo "  [linux-x86_64] ✗ $component build failed"
    else
        mkdir -p "$TMPDIR/$component/linux-x86_64"
        scp -q "$VPS:$REMOTE_LIB" "$TMPDIR/$component/linux-x86_64/${libname}.so"
        echo "  [linux-x86_64] ✓ $(du -h "$TMPDIR/$component/linux-x86_64/${libname}.so" | cut -f1)"
    fi
done

# 4. Report
echo ""
echo "=== Build Summary ==="
for component in "${COMPONENTS[@]}"; do
    echo "  $component:"
    for platform_dir in "$TMPDIR/$component"/darwin-* "$TMPDIR/$component"/linux-*; do
        [ -d "$platform_dir" ] || continue
        platform=$(basename "$platform_dir")
        file=$(ls "$platform_dir"/*.dylib "$platform_dir"/*.so 2>/dev/null | head -1)
        if [ -n "$file" ]; then
            sha=$(shasum -a 256 "$file" | cut -d' ' -f1)
            echo "    $platform: $(du -h "$file" | cut -f1) — SHA-256: ${sha:0:16}..."
        fi
    done
done

# 5. Stage on Forge VPS
echo ""
echo "=== Staging on Forge VPS ==="

for component in "${COMPONENTS[@]}"; do
    for platform_dir in "$TMPDIR/$component"/darwin-* "$TMPDIR/$component"/linux-*; do
        [ -d "$platform_dir" ] || continue
        platform=$(basename "$platform_dir")
        remote_dir="$EXTENSION_BASE/$VERSION/$component/$platform"

        ssh "$VPS" "sudo mkdir -p $remote_dir"

        for lib in "$platform_dir"/*.dylib "$platform_dir"/*.so; do
            [ -f "$lib" ] || continue
            fname=$(basename "$lib")
            scp -q "$lib" "$VPS:/tmp/$fname"
            ssh "$VPS" "sudo mv /tmp/$fname $remote_dir/$fname && sudo chmod 644 $remote_dir/$fname"
            echo "  ✓ $component/$platform/$fname"
        done
    done

    # Stage model files for SIU
    if [ "$component" = "siu" ] && [ -d "$TMPDIR/$component/model" ]; then
        remote_model="$EXTENSION_BASE/$VERSION/$component/model"
        ssh "$VPS" "sudo mkdir -p $remote_model"
        for mf in "$TMPDIR/$component/model"/*; do
            [ -f "$mf" ] || continue
            fname=$(basename "$mf")
            scp -q "$mf" "$VPS:/tmp/$fname"
            ssh "$VPS" "sudo mv /tmp/$fname $remote_model/$fname && sudo chmod 644 $remote_model/$fname"
            echo "  ✓ $component/model/$fname"
        done
    fi
done

# 6. Update 'latest' symlink
echo ""
ssh "$VPS" "cd $EXTENSION_BASE && sudo ln -sfn $VERSION latest"
echo "✓ $EXTENSION_BASE/latest -> $VERSION"

echo ""
echo "=== Done ==="
echo "Binaries at: https://extensions.technocraftonline.com/$VERSION/"
