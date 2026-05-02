#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# Sulcus Release Binary Builder
# Built on Hephaestus (Forge VPS) — cross-compilation pipeline
#
# Builds prebuilt platform dylibs and uploads them to GitHub Releases.
# No GitHub Actions. No local cargo builds. All on the forge.
#
# Usage:
#   ./scripts/build-release.sh <version>
#   ./scripts/build-release.sh v3.5.5
#
# Platforms built:
#   - linux-x64    (native on Hephaestus)
#   - linux-arm64  (cross-compiled on Hephaestus)
#   - macos-x64    (requires local Intel Mac — NOT built here)
#   - macos-arm64  (requires Apple Silicon Mac — NOT built here)
#
# Prerequisites:
#   - SSH access to dforge-vps (see ~/.ssh/config)
#   - Docker on the VPS
#   - gh CLI authenticated with digitalforgeca/sulcus
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail

VERSION="${1:?Usage: $0 <version>}"
REPO="digitalforgeca/sulcus"
VPS="dforge-vps"
SULCUS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK="/tmp/sulcus-release-${VERSION}"

echo "🔨 Sulcus Release Builder — ${VERSION}"
echo "   Source: ${SULCUS_DIR}"
echo "   Target: ${REPO}"
echo ""

# ── Step 1: Archive crate sources ────────────────────────────────────────
echo "📦 Archiving crate sources..."
cd "${SULCUS_DIR}"
git archive --format=tar HEAD -- crates/ Cargo.toml Cargo.lock | gzip > /tmp/sulcus-crates.tar.gz
echo "   $(ls -lh /tmp/sulcus-crates.tar.gz | awk '{print $5}')"

# ── Step 2: Upload sources to VPS ────────────────────────────────────────
echo "🚀 Uploading to Hephaestus..."
scp /tmp/sulcus-crates.tar.gz "${VPS}:/tmp/sulcus-crates.tar.gz"

# ── Step 3: Build linux-x64 on VPS ──────────────────────────────────────
echo "🔧 Building linux-x64..."
ssh "${VPS}" "sudo rm -rf /tmp/sulcus-linux-x64 2>/dev/null; mkdir -p /tmp/sulcus-linux-x64 && \
docker run --rm \
  -v /tmp/sulcus-crates.tar.gz:/src/sulcus-crates.tar.gz:ro \
  -v /tmp/sulcus-linux-x64:/output \
  rust:1-bookworm bash -c '\
    apt-get update -qq && apt-get install -y -qq pkg-config libssl-dev > /dev/null 2>&1 && \
    mkdir -p /build && cd /build && \
    tar xzf /src/sulcus-crates.tar.gz && \
    cargo build --release -p sulcus-store -p sulcus-vectors 2>&1 | tail -3 && \
    cp target/release/libsulcus_store.so target/release/libsulcus_vectors.so /output/ && \
    ls -lh /output/ && echo DONE'"

# ── Step 4: Build linux-arm64 on VPS (cross-compile) ────────────────────
echo "🔧 Building linux-arm64 (cross-compile)..."
ssh "${VPS}" "sudo rm -rf /tmp/sulcus-linux-arm64 2>/dev/null; mkdir -p /tmp/sulcus-linux-arm64 && \
docker run --rm \
  -v /tmp/sulcus-crates.tar.gz:/src/sulcus-crates.tar.gz:ro \
  -v /tmp/sulcus-linux-arm64:/output \
  rust:1-bookworm bash -c '\
    dpkg --add-architecture arm64 && \
    apt-get update -qq && \
    apt-get install -y -qq gcc-aarch64-linux-gnu g++-aarch64-linux-gnu pkg-config libssl-dev libssl-dev:arm64 > /dev/null 2>&1 && \
    rustup target add aarch64-unknown-linux-gnu && \
    mkdir -p /build/.cargo && cd /build && \
    tar xzf /src/sulcus-crates.tar.gz && \
    cat > .cargo/config.toml << TOML
[target.aarch64-unknown-linux-gnu]
linker = \"aarch64-linux-gnu-gcc\"
TOML
    export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc && \
    export CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++ && \
    export PKG_CONFIG_ALLOW_CROSS=1 && \
    export OPENSSL_DIR=/usr && \
    export OPENSSL_LIB_DIR=/usr/lib/x86_64-linux-gnu && \
    export OPENSSL_INCLUDE_DIR=/usr/include && \
    export AARCH64_UNKNOWN_LINUX_GNU_OPENSSL_LIB_DIR=/usr/lib/aarch64-linux-gnu && \
    export AARCH64_UNKNOWN_LINUX_GNU_OPENSSL_INCLUDE_DIR=/usr/include && \
    export AARCH64_UNKNOWN_LINUX_GNU_OPENSSL_DIR=/usr && \
    cargo build --release --target aarch64-unknown-linux-gnu -p sulcus-store -p sulcus-vectors 2>&1 | tail -3 && \
    cp target/aarch64-unknown-linux-gnu/release/libsulcus_store.so target/aarch64-unknown-linux-gnu/release/libsulcus_vectors.so /output/ && \
    ls -lh /output/ && echo DONE'"

# ── Step 5: Pull binaries and package ────────────────────────────────────
echo "📥 Pulling binaries from Hephaestus..."
mkdir -p "${WORK}"
scp "${VPS}:/tmp/sulcus-linux-x64/libsulcus_store.so" "${WORK}/linux-x64-store.so"
scp "${VPS}:/tmp/sulcus-linux-x64/libsulcus_vectors.so" "${WORK}/linux-x64-vectors.so"
scp "${VPS}:/tmp/sulcus-linux-arm64/libsulcus_store.so" "${WORK}/linux-arm64-store.so"
scp "${VPS}:/tmp/sulcus-linux-arm64/libsulcus_vectors.so" "${WORK}/linux-arm64-vectors.so"

echo "📦 Packaging tarballs..."
cd "${WORK}"
mkdir -p linux-x64 linux-arm64
cp linux-x64-store.so linux-x64/libsulcus_store.so
cp linux-x64-vectors.so linux-x64/libsulcus_vectors.so
cp linux-arm64-store.so linux-arm64/libsulcus_store.so
cp linux-arm64-vectors.so linux-arm64/libsulcus_vectors.so

(cd linux-x64 && tar czf "${WORK}/sulcus-linux-x64.tar.gz" *.so)
(cd linux-arm64 && tar czf "${WORK}/sulcus-linux-arm64.tar.gz" *.so)

ls -lh "${WORK}"/*.tar.gz

# ── Step 6: Create GitHub Release ────────────────────────────────────────
echo "🚀 Creating GitHub Release ${VERSION}..."
gh release create "${VERSION}" \
  --repo "${REPO}" \
  --title "Sulcus ${VERSION}" \
  --generate-notes \
  "${WORK}/sulcus-linux-x64.tar.gz" \
  "${WORK}/sulcus-linux-arm64.tar.gz"

echo ""
echo "⚠️  macOS tarballs must be built on native macOS hardware and uploaded separately:"
echo "   gh release upload ${VERSION} --repo ${REPO} sulcus-macos-x64.tar.gz"
echo "   gh release upload ${VERSION} --repo ${REPO} sulcus-macos-arm64.tar.gz"
echo ""

# ── Step 7: Cleanup ─────────────────────────────────────────────────────
echo "🧹 Cleaning up..."
rm -rf "${WORK}" /tmp/sulcus-crates.tar.gz
ssh "${VPS}" "sudo rm -rf /tmp/sulcus-linux-x64 /tmp/sulcus-linux-arm64 /tmp/sulcus-crates.tar.gz 2>/dev/null"

echo "✅ Release ${VERSION} complete — https://github.com/${REPO}/releases/tag/${VERSION}"
