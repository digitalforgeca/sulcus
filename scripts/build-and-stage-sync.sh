#!/bin/bash
# build-and-stage-sync.sh — Build sulcus-sync cdylib and stage on Forge VPS.
#
# Builds for available platforms (native + Docker), uploads to Forge VPS,
# and configures nginx to serve the binaries.
#
# Usage:
#   ./scripts/build-and-stage-sync.sh [version]
#   ./scripts/build-and-stage-sync.sh v0.1.0
#
# The Forge VPS serves binaries at:
#   https://extensions.technocraftonline.com/{version}/{platform}/libsulcus_sync.{ext}
#
# Requires: cargo, docker, ssh access to Forge VPS (via dforge-vps alias)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VPS="dforge-vps"  # SSH config alias (user: technocraft)
EXTENSION_BASE="/opt/forge/services/dionysus/sites/extensions"
VERSION="${1:-v0.1.0}"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "=== Building sulcus-sync cdylib (version: $VERSION) ==="
echo ""

# 1. Native build (current platform — darwin-x86_64 on this machine)
echo "--- Native build (darwin-x86_64) ---"
cd "$REPO_ROOT"
cargo build --release -p sulcus-sync 2>&1 | tail -3

NATIVE_DYLIB="$REPO_ROOT/target/release/libsulcus_sync.dylib"
if [ -f "$NATIVE_DYLIB" ]; then
    mkdir -p "$TMPDIR/darwin-x86_64"
    cp "$NATIVE_DYLIB" "$TMPDIR/darwin-x86_64/libsulcus_sync.dylib"
    echo "  ✓ darwin-x86_64: $(du -h "$NATIVE_DYLIB" | cut -f1)"
else
    echo "  ✗ darwin-x86_64: build failed"
fi

# 2. Docker build for linux-x86_64
echo ""
echo "--- Docker build (linux-x86_64) ---"

# Prepare minimal build context (exclude target/, packages/, sdks/ to keep upload small)
BUILD_CTX="$TMPDIR/build-ctx"
mkdir -p "$BUILD_CTX"
rsync -a --exclude='target' --exclude='packages' --exclude='sdks' \
    --exclude='marketing' --exclude='output' --exclude='vscode-sulcus' \
    --exclude='integrations' --exclude='.git' --exclude='.fastembed_cache' \
    --exclude='tests' --exclude='tools' --exclude='docker' \
    "$REPO_ROOT/" "$BUILD_CTX/"

# Check if Docker is available
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    cd "$BUILD_CTX"
    docker build -f Dockerfile.release-sync -t sulcus-sync-build \
        --build-arg CACHE_BUST="$(date +%s)" . 2>&1 | tail -10

    # Extract the binary
    docker rm -f sync-extract 2>/dev/null || true
    docker create --name sync-extract sulcus-sync-build
    mkdir -p "$TMPDIR/linux-x86_64"
    docker cp sync-extract:/release/libsulcus_sync.so "$TMPDIR/linux-x86_64/libsulcus_sync.so"
    docker rm sync-extract
    echo "  ✓ linux-x86_64: $(du -h "$TMPDIR/linux-x86_64/libsulcus_sync.so" | cut -f1)"
else
    echo "  ⚠ Docker not available — skipping linux-x86_64 build"
fi

cd "$REPO_ROOT"

# 3. Report what we built
echo ""
echo "=== Build summary ==="
for platform_dir in "$TMPDIR"/darwin-* "$TMPDIR"/linux-*; do
    if [ -d "$platform_dir" ]; then
        platform=$(basename "$platform_dir")
        file=$(ls "$platform_dir"/libsulcus_sync.* 2>/dev/null | head -1)
        if [ -n "$file" ]; then
            sha=$(shasum -a 256 "$file" | cut -d' ' -f1)
            echo "  $platform: $(du -h "$file" | cut -f1) — SHA-256: ${sha:0:16}..."
        fi
    fi
done

# 4. Upload to Forge VPS
echo ""
echo "=== Staging on Forge VPS ($VPS) ==="

for platform_dir in "$TMPDIR"/darwin-* "$TMPDIR"/linux-*; do
    if [ -d "$platform_dir" ]; then
        platform=$(basename "$platform_dir")
        remote_dir="$EXTENSION_BASE/$VERSION/$platform"

        echo "  Uploading $platform..."
        ssh "$VPS" "sudo mkdir -p $remote_dir"

        for lib in "$platform_dir"/libsulcus_sync.*; do
            if [ -f "$lib" ]; then
                scp "$lib" "$VPS:/tmp/$(basename "$lib")"
                ssh "$VPS" "sudo mv /tmp/$(basename "$lib") $remote_dir/$(basename "$lib") && sudo chmod 644 $remote_dir/$(basename "$lib")"
                echo "    ✓ $(basename "$lib")"
            fi
        done
    fi
done

# 5. Create/update 'latest' symlink
echo ""
echo "--- Updating 'latest' symlink ---"
ssh "$VPS" "cd $EXTENSION_BASE && sudo ln -sfn $VERSION latest"
echo "  ✓ $EXTENSION_BASE/latest -> $VERSION"

echo ""
echo "=== Done ==="
echo ""
echo "Extension binaries staged at:"
echo "  https://extensions.technocraftonline.com/$VERSION/"
echo ""
echo "Verify:"
echo "  curl -I https://extensions.technocraftonline.com/$VERSION/darwin-x86_64/libsulcus_sync.dylib"
