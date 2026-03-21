#!/bin/bash
# stage-sync-extensions.sh — Download sulcus-sync artifacts from GitHub Releases
# and deploy them to the Forge VPS extension directory.
#
# Usage:
#   ./scripts/stage-sync-extensions.sh [version]
#   ./scripts/stage-sync-extensions.sh sync-v0.1.0
#
# The script:
# 1. Downloads all libsulcus_sync artifacts from the GitHub release
# 2. Extracts platform-specific dylibs
# 3. Uploads them to the server at /opt/sulcus/extensions/{version}/{platform}/
#
# Requires: gh CLI (authenticated), ssh access to the Forge VPS

set -euo pipefail

REPO="digitalforgeca/sulcus"
VPS_HOST="66.209.181.97"
VPS_USER="root"
EXTENSION_BASE="/opt/sulcus/extensions"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version-tag>  (e.g. sync-v0.1.0)"
    exit 1
fi

# Strip 'sync-' prefix for the extension version directory
EXT_VERSION="${VERSION#sync-}"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "=== Downloading sulcus-sync artifacts for $VERSION ==="

PLATFORMS=("darwin-arm64" "darwin-x86_64" "linux-x86_64" "linux-aarch64")

for platform in "${PLATFORMS[@]}"; do
    asset="libsulcus_sync-${platform}.tar.gz"
    echo "  Fetching $asset..."
    if gh release download "$VERSION" --repo "$REPO" --pattern "$asset" --dir "$TMPDIR" 2>/dev/null; then
        mkdir -p "$TMPDIR/$platform"
        tar xzf "$TMPDIR/$asset" -C "$TMPDIR/$platform"
        echo "    ✓ $platform"
    else
        echo "    ⚠ $platform — artifact not found (skipping)"
    fi
done

echo ""
echo "=== Staging extensions on VPS ($VPS_HOST) ==="

for platform in "${PLATFORMS[@]}"; do
    if [ -d "$TMPDIR/$platform" ]; then
        remote_dir="$EXTENSION_BASE/$EXT_VERSION/$platform"
        echo "  Creating $remote_dir on VPS..."
        ssh "$VPS_USER@$VPS_HOST" "mkdir -p $remote_dir"
        
        # Determine expected filename
        if [[ "$platform" == darwin-* ]]; then
            lib_name="libsulcus_sync.dylib"
        else
            lib_name="libsulcus_sync.so"
        fi
        
        if [ -f "$TMPDIR/$platform/$lib_name" ]; then
            echo "  Uploading $lib_name to $remote_dir/"
            scp "$TMPDIR/$platform/$lib_name" "$VPS_USER@$VPS_HOST:$remote_dir/$lib_name"
            ssh "$VPS_USER@$VPS_HOST" "chmod 644 $remote_dir/$lib_name"
            echo "    ✓ $platform staged"
        else
            echo "    ⚠ $platform — $lib_name not found in archive"
        fi
    fi
done

# Create/update 'latest' symlink
echo ""
echo "=== Updating 'latest' symlink ==="
ssh "$VPS_USER@$VPS_HOST" "cd $EXTENSION_BASE && ln -sfn $EXT_VERSION latest"
echo "  ✓ $EXTENSION_BASE/latest -> $EXT_VERSION"

echo ""
echo "=== Done ==="
echo "Extensions staged at: $VPS_HOST:$EXTENSION_BASE/$EXT_VERSION/"
echo ""
echo "Verify with:"
echo "  ssh $VPS_USER@$VPS_HOST 'find $EXTENSION_BASE/$EXT_VERSION -type f -exec ls -la {} \\;'"
echo ""
echo "Set SULCUS_EXTENSION_VERSION=$EXT_VERSION on the server (or leave as 'latest')."
