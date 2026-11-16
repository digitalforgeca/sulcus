#!/usr/bin/env bash
#
# ╔═══════════════════════════════════════════════════════════════════╗
# ║        SULCUS: Autonomous Episodic Memory for AI Agents           ║
# ║                   Native Rust System Installer                    ║
# ╚═══════════════════════════════════════════════════════════════════╝
#
# One-command installer:
#   curl -fsSL https://sulcus.ca/install.sh | bash
#
# Repository:
#   https://github.com/digitalforgeca/sulcus
#
set -euo pipefail

# ─── Colors & Output ───────────────────────────────────────────────
BOLD="$(tput bold 2>/dev/null || printf '')"
CYAN="$(tput setaf 6 2>/dev/null || printf '')"
GREEN="$(tput setaf 2 2>/dev/null || printf '')"
YELLOW="$(tput setaf 3 2>/dev/null || printf '')"
RED="$(tput setaf 1 2>/dev/null || printf '')"
RESET="$(tput sgr0 2>/dev/null || printf '')"

info()    { echo "${CYAN}▸${RESET} $*"; }
ok()      { echo "${GREEN}✓${RESET} $*"; }
warn()    { echo "${YELLOW}⚠${RESET} $*"; }
err()     { echo "${RED}✗${RESET} $*" >&2; }
heading() { echo ""; echo "${BOLD}${CYAN}$*${RESET}"; }

# ─── Defaults & CLI Args ───────────────────────────────────────────
AUTO_CONFIGURE_MCP=true
BUILD_FROM_SOURCE=false
CUSTOM_PREFIX=""
PINNED_VERSION=""
GITHUB_REPO="digitalforgeca/sulcus"
CHANNEL="${SULCUS_CHANNEL:-${CHANNEL:-stable}}"
SULCUS_MANIFEST_URL="${SULCUS_MANIFEST_URL:-https://github.com/digitalforgeca/sulcus/releases/latest/download/manifest.json}"

usage() {
  cat <<EOF
Sulcus Native System Installer

Usage:
  install.sh [options]
  curl -fsSL https://sulcus.ca/install.sh | bash -s -- [options]

Options:
  --prefix <dir>       Install sulcus binary to <dir> (default: ~/.sulcus/bin)
  --version <ver>      Pin a specific GitHub release version (e.g. 3.1.0 or v3.1.0)
  --channel <name>     Release channel when using a channel-aware manifest URL (default: stable)
  --no-mcp             Skip automatic MCP & workstation setup (sulcus doctor --fix)
  --build              Compile locally via Cargo (requires local Rust workspace)
  --help, -h           Show this help message
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      if [[ $# -lt 2 ]]; then
        err "--prefix requires a directory argument"
        exit 1
      fi
      CUSTOM_PREFIX="$2"
      shift 2
      ;;
    --version)
      if [[ $# -lt 2 ]]; then
        err "--version requires a version argument"
        exit 1
      fi
      PINNED_VERSION="$2"
      shift 2
      ;;
    --channel)
      if [[ $# -lt 2 ]]; then
        err "--channel requires a channel name"
        exit 1
      fi
      CHANNEL="$2"
      shift 2
      ;;
    --no-mcp)
      AUTO_CONFIGURE_MCP=false
      shift
      ;;
    --build)
      BUILD_FROM_SOURCE=true
      shift
      ;;
    --help|-h)
      usage
      ;;
    *)
      err "Unknown option: $1"
      usage
      ;;
  esac
done

# ─── Input Sanitization ─────────────────────────────────────────────
validate_safe_path() {
  local label="$1"
  local val="$2"
  local nl=$'\n'
  local cr=$'\r'
  case "$val" in
    *\"*|*\'*|*\$*|*\`*|*\\*|*\;*|*:*|*"$nl"*|*"$cr"*)
      err "Invalid ${label}: unsafe shell characters (quotes, \$, backticks, backslashes, semicolons, colons, or newlines) are not allowed."
      exit 1
      ;;
  esac
}

validate_slug_token() {
  local label="$1"
  local val="$2"
  local nl=$'\n'
  local cr=$'\r'
  case "$val" in
    *"$nl"*|*"$cr"*)
      err "Invalid ${label}: newlines are not allowed."
      exit 1
      ;;
  esac
  if [[ ! "$val" =~ ^[A-Za-z0-9._-]+$ ]]; then
    err "Invalid ${label} '${val}': must match ^[A-Za-z0-9._-]+$"
    exit 1
  fi
}

if [ -n "$CUSTOM_PREFIX" ]; then
  validate_safe_path "--prefix" "$CUSTOM_PREFIX"
fi
if [ -n "$PINNED_VERSION" ]; then
  validate_slug_token "--version" "$PINNED_VERSION"
fi
validate_slug_token "--channel" "$CHANNEL"

# ─── Banner ─────────────────────────────────────────────────────────
echo "${CYAN}"
cat << 'EOF'
  ____  _   _ _     ____ _   _ ____  
 / ___|| | | | |   / ___| | | / ___| 
 \___ \| | | | |  | |   | | | \___ \ 
  ___) | |_| | |__| |___| |_| |___) |
 |____/ \___/|_____\____|\___/|____/ 
EOF
echo "${RESET}"
echo "${BOLD}Autonomous Episodic Memory for AI Agents (Native Rust Engine)${RESET}"
echo "------------------------------------------------------------"

# ─── Platform Detection ─────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64|aarch64)
        DISTRO_TARGET="macos-arm64"
        RUST_TRIPLE="aarch64-apple-darwin"
        ;;
      x86_64)
        DISTRO_TARGET="macos-x64"
        RUST_TRIPLE="x86_64-apple-darwin"
        ;;
      *)
        err "Unsupported macOS architecture: $ARCH"
        exit 1
        ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64|amd64)
        DISTRO_TARGET="linux-x64"
        RUST_TRIPLE="x86_64-unknown-linux-gnu"
        ;;
      aarch64|arm64)
        DISTRO_TARGET="linux-arm64"
        RUST_TRIPLE="aarch64-unknown-linux-gnu"
        ;;
      *)
        err "Unsupported Linux architecture: $ARCH"
        exit 1
        ;;
    esac
    ;;
  *)
    err "Unsupported operating system: $OS"
    err "Sulcus runs natively on macOS and Linux (including WSL2)."
    exit 1
    ;;
esac

info "Detected platform: ${BOLD}$OS ($ARCH) [${DISTRO_TARGET} / ${RUST_TRIPLE}]${RESET}"

# ─── Target Paths ───────────────────────────────────────────────────
SULCUS_HOME="${SULCUS_HOME:-$HOME/.sulcus}"
validate_safe_path "SULCUS_HOME" "$SULCUS_HOME"
BIN_DIR="${CUSTOM_PREFIX:-$SULCUS_HOME/bin}"
validate_safe_path "BIN_DIR" "$BIN_DIR"
LOCAL_BIN="$HOME/.local/bin"
validate_safe_path "LOCAL_BIN" "$LOCAL_BIN"
DATA_DIR="$SULCUS_HOME/data"

mkdir -p "$BIN_DIR" "$DATA_DIR"

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'sulcus-install')"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ─── Helpers ────────────────────────────────────────────────────────
verify_file_sha256() {
  local file_path="$1"
  local expected_sha="$2"
  local actual_sha=""
  if command -v sha256sum >/dev/null 2>&1; then
    actual_sha="$(sha256sum "$file_path" | awk '{print tolower($1)}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual_sha="$(shasum -a 256 "$file_path" | awk '{print tolower($1)}')"
  elif command -v openssl >/dev/null 2>&1; then
    actual_sha="$(openssl dgst -sha256 "$file_path" | awk '{print tolower($NF)}')"
  else
    err "Neither sha256sum, shasum, nor openssl found to verify release checksum."
    return 1
  fi
  local clean_expected
  clean_expected="$(printf '%s' "$expected_sha" | tr '[:upper:]' '[:lower:]')"
  if [ "$actual_sha" != "$clean_expected" ]; then
    err "SHA-256 verification failed! Expected $clean_expected, got $actual_sha"
    return 1
  fi
  return 0
}

# Parse release manifest JSON into newline-delimited: version, download_url, sha256
parse_release_manifest() {
  local manifest_file="$1"
  local target_slug="$2"

  if command -v jq >/dev/null 2>&1; then
    jq -r --arg t "$target_slug" '
      (.data // .) as $m |
      (($m.artifacts // $m.platforms // {})[$t] // {}) as $a |
      ($m.version // ""),
      ($a.download_url // $a.url // ""),
      ($a.sha256 // "")
    ' "$manifest_file" 2>/dev/null && return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$manifest_file" "$target_slug" <<'PYEOF' 2>/dev/null && return 0
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    doc = json.load(f)
data = doc.get("data") if isinstance(doc.get("data"), dict) else doc
arts = data.get("artifacts") or data.get("platforms") or {}
art = arts.get(sys.argv[2]) or {}
print(data.get("version") or "")
print(art.get("download_url") or art.get("url") or "")
print(art.get("sha256") or "")
PYEOF
  fi

  # Zero-dependency POSIX sed/awk fallback scoped to the target artifact object
  local flat target_block ver dl_url sha
  flat="$(tr -d '\n\r' < "$manifest_file")"
  ver="$(printf '%s' "$flat" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  target_block="$(printf '%s' "$flat" | sed -n "s/.*\"${target_slug}\"[[:space:]]*:[[:space:]]*{\([^}]*\)}.*/\1/p")"
  dl_url=""
  sha=""
  if [ -n "$target_block" ]; then
    dl_url="$(printf '%s' "$target_block" | sed -n 's/.*"download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    if [ -z "$dl_url" ]; then
      dl_url="$(printf '%s' "$target_block" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    fi
    sha="$(printf '%s' "$target_block" | sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  fi
  printf '%s\n%s\n%s\n' "$ver" "$dl_url" "$sha"
}

extract_installed_archive() {
  local archive_path="$1"
  local extract_dir="$TMP_DIR/extracted-$$-$RANDOM"
  mkdir -p "$extract_dir"
  tar -xzf "$archive_path" -C "$extract_dir"

  local found_bin=""
  if [ -f "$extract_dir/sulcus" ]; then
    found_bin="$extract_dir/sulcus"
  elif [ -f "$extract_dir/$ARCH/sulcus" ]; then
    found_bin="$extract_dir/$ARCH/sulcus"
  else
    found_bin="$(find "$extract_dir" -type f -name sulcus | head -n 1)"
  fi

  if [ -z "$found_bin" ] || [ ! -f "$found_bin" ]; then
    err "Failed to locate extracted 'sulcus' binary in archive."
    exit 1
  fi

  mv -f "$found_bin" "$BIN_DIR/sulcus"
  chmod +x "$BIN_DIR/sulcus"

  # Extract companion libsulcus_vectors (.dylib / .so) alongside sulcus in $BIN_DIR
  while IFS= read -r vec_lib; do
    if [ -n "$vec_lib" ] && [ -f "$vec_lib" ]; then
      local vec_name
      vec_name="$(basename "$vec_lib")"
      mv -f "$vec_lib" "$BIN_DIR/$vec_name"
      chmod 755 "$BIN_DIR/$vec_name"
      ok "Installed companion library to $BIN_DIR/$vec_name"
    fi
  done <<EOF
$(find "$extract_dir" -type f \( -name "libsulcus_vectors.dylib" -o -name "libsulcus_vectors.so" -o -name "libsulcus_vectors.*.dylib" -o -name "libsulcus_vectors.so.*" \) 2>/dev/null || true)
EOF

  rm -rf "$extract_dir"
  ok "Installed native Rust binary to $BIN_DIR/sulcus"
}

try_github_release_tag() {
  local tag="$1"
  local ver_no_v="${tag#v}"
  local base_url="https://github.com/${GITHUB_REPO}/releases/download/${tag}"
  local candidates=(
    "sulcus-${ver_no_v}-${DISTRO_TARGET}.tar.gz"
    "sulcus-${DISTRO_TARGET}.tar.gz"
    "sulcus-${RUST_TRIPLE}.tar.gz"
  )

  local sums_file="$TMP_DIR/SHA256SUMS-${tag}.txt"
  local has_sums=false
  if curl -fsSL --max-time 10 "${base_url}/SHA256SUMS.txt" -o "$sums_file" 2>/dev/null; then
    has_sums=true
  fi

  local asset
  for asset in "${candidates[@]}"; do
    local url="${base_url}/${asset}"
    local dest="$TMP_DIR/${tag}-${asset}"
    if curl -fsSL --max-time 180 -o "$dest" "$url" 2>/dev/null; then
      local expected_sha=""
      if [ "$has_sums" = true ]; then
        expected_sha="$(awk -v a="$asset" '$2 == a || $2 == ("*" a) { print $1; exit }' "$sums_file")"
      fi
      if [ -z "$expected_sha" ] && curl -fsSL --max-time 10 "${url}.sha256" -o "${dest}.sha256" 2>/dev/null; then
        expected_sha="$(awk '{print $1; exit}' "${dest}.sha256")"
      fi

      if ! printf '%s' "$expected_sha" | grep -Eq '^[0-9a-fA-F]{64}$'; then
        err "Missing or invalid SHA-256 digest for ${url}; refusing to extract unverified archive."
        rm -f "$dest" "${dest}.sha256"
        return 1
      fi
      if ! verify_file_sha256 "$dest" "$expected_sha"; then
        err "Checksum mismatch for ${url}; refusing to extract archive."
        rm -f "$dest" "${dest}.sha256"
        return 1
      fi
      ok "Verified SHA-256 checksum ($expected_sha)"

      info "Downloaded GitHub release asset: ${CYAN}${url}${RESET}"
      extract_installed_archive "$dest"
      return 0
    fi
  done

  return 1
}

# ─── 1. Binary Installation ─────────────────────────────────────────
heading "1. Installing Sulcus Binary & Companion Libraries"

if [ "$BUILD_FROM_SOURCE" = true ]; then
  if [ ! -f "./crates/sulcus/Cargo.toml" ]; then
    err "Cannot run '--build': './crates/sulcus/Cargo.toml' was not found in $(pwd)."
    err "Prebuilt signed Sulcus binaries are distributed via GitHub Releases"
    err "without '--build':"
    err "  curl -fsSL https://sulcus.ca/install.sh | bash"
    err "Or via Homebrew:"
    err "  brew tap digitalforgeca/sulcus && brew install sulcus"
    exit 1
  fi
  if ! command -v cargo >/dev/null 2>&1; then
    err "Rust toolchain ('cargo') is required for --build but was not found."
    err "Install Rust first via: https://rustup.rs"
    exit 1
  fi
  info "Compiling Sulcus from local Rust workspace (cargo build --release -p sulcus)..."
  cargo build --release -p sulcus
  cp -f "./target/release/sulcus" "$BIN_DIR/sulcus"
  chmod +x "$BIN_DIR/sulcus"
  for vec_lib in ./target/release/libsulcus_vectors.dylib ./target/release/libsulcus_vectors.so; do
    if [ -f "$vec_lib" ]; then
      cp -f "$vec_lib" "$BIN_DIR/$(basename "$vec_lib")"
      chmod 755 "$BIN_DIR/$(basename "$vec_lib")"
      ok "Installed companion library to $BIN_DIR/$(basename "$vec_lib")"
    fi
  done
  ok "Built and installed Sulcus to $BIN_DIR/sulcus"
else
  INSTALLED=false

  # Primary path: signed release manifest (unless --version pins a specific GitHub tag)
  if [ -z "$PINNED_VERSION" ]; then
    MANIFEST_URL="$SULCUS_MANIFEST_URL"
    if [[ "$MANIFEST_URL" != *.json ]] && [[ "$MANIFEST_URL" != *"channel="* ]]; then
      if [[ "$MANIFEST_URL" == *"?"* ]]; then
        MANIFEST_URL="${MANIFEST_URL}&channel=${CHANNEL}"
      else
        MANIFEST_URL="${MANIFEST_URL}?channel=${CHANNEL}"
      fi
    fi
    info "Checking Sulcus release manifest (${MANIFEST_URL})..."

    if curl -fsSL --max-time 10 "$MANIFEST_URL" -o "$TMP_DIR/manifest.json" 2>/dev/null; then
      PARSED_MANIFEST="$(parse_release_manifest "$TMP_DIR/manifest.json" "$DISTRO_TARGET" || true)"
      MANIFEST_VER="$(printf '%s\n' "$PARSED_MANIFEST" | sed -n '1p')"
      MANIFEST_DL_URL="$(printf '%s\n' "$PARSED_MANIFEST" | sed -n '2p')"
      MANIFEST_SHA256="$(printf '%s\n' "$PARSED_MANIFEST" | sed -n '3p')"

      if [ -n "$MANIFEST_DL_URL" ]; then
        if [[ "$MANIFEST_DL_URL" != https://* ]] || [[ "$MANIFEST_DL_URL" == *[[:space:]\"\']* ]]; then
          warn "Rejected non-HTTPS download_url from manifest; falling back to GitHub Releases."
        elif ! printf '%s' "$MANIFEST_SHA256" | grep -Eq '^[0-9a-fA-F]{64}$'; then
          warn "Manifest entry for '${DISTRO_TARGET}' is missing a valid 64-hex SHA-256 digest; falling back to GitHub Releases."
        else
          info "Downloading verified Sulcus ${MANIFEST_VER:+v${MANIFEST_VER#v} }release bundle..."
          if curl -fsSL --max-time 180 -o "$TMP_DIR/release-bundle.tar.gz" "$MANIFEST_DL_URL"; then
            if verify_file_sha256 "$TMP_DIR/release-bundle.tar.gz" "$MANIFEST_SHA256"; then
              ok "Verified SHA-256 checksum ($MANIFEST_SHA256)"
              extract_installed_archive "$TMP_DIR/release-bundle.tar.gz"
              INSTALLED=true
            else
              warn "Release bundle checksum mismatch; falling back to GitHub Releases."
            fi
          else
            warn "Release bundle download failed; falling back to GitHub Releases."
          fi
        fi
      else
        info "Target '${DISTRO_TARGET}' not listed in manifest; checking GitHub Releases..."
      fi
    else
      info "Release manifest unavailable; falling back to GitHub Releases..."
    fi
  fi

  # Fallback (or pinned --version) path: GitHub Releases on digitalforgeca/sulcus
  if [ "$INSTALLED" = false ]; then
    if [ -n "$PINNED_VERSION" ]; then
      PINNED_TAG="v${PINNED_VERSION#v}"
      info "Downloading pinned release ${PINNED_TAG} from GitHub (${GITHUB_REPO})..."
      if try_github_release_tag "$PINNED_TAG" || { [ "$PINNED_TAG" != "$PINNED_VERSION" ] && try_github_release_tag "$PINNED_VERSION"; }; then
        INSTALLED=true
      else
        err "Could not find prebuilt archive for ${DISTRO_TARGET} (${RUST_TRIPLE}) under release '${PINNED_VERSION}'."
        err "Check available tags at: https://github.com/${GITHUB_REPO}/releases"
        exit 1
      fi
    else
      info "Resolving prebuilt binary from GitHub Releases (${GITHUB_REPO})..."
      LATEST_GH_TAG=""
      if curl -fsSL --max-time 6 "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" -o "$TMP_DIR/gh-latest.json" 2>/dev/null; then
        LATEST_GH_TAG="$(tr -d '\n\r' < "$TMP_DIR/gh-latest.json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      fi

      if [ -n "$LATEST_GH_TAG" ] && [[ "$LATEST_GH_TAG" =~ ^[A-Za-z0-9._-]+$ ]] && [ "$LATEST_GH_TAG" != "v3.0.0" ] && try_github_release_tag "$LATEST_GH_TAG"; then
        INSTALLED=true
      elif try_github_release_tag "v3.1.0"; then
        INSTALLED=true
      elif try_github_release_tag "v3.0.0"; then
        INSTALLED=true
      fi

      if [ "$INSTALLED" = false ]; then
        err "Could not download a prebuilt Sulcus binary for ${DISTRO_TARGET} (${RUST_TRIPLE})."
        err "Verify network access to https://github.com/${GITHUB_REPO}/releases,"
        err "or install via Homebrew: brew tap digitalforgeca/sulcus && brew install sulcus"
        exit 1
      fi
    fi
  fi
fi

# Symlink to ~/.local/bin/sulcus when installing to default prefix
if [ -z "$CUSTOM_PREFIX" ]; then
  mkdir -p "$LOCAL_BIN" 2>/dev/null || true
  if [ -d "$LOCAL_BIN" ] && [ -w "$LOCAL_BIN" ] && [ "$BIN_DIR" != "$LOCAL_BIN" ]; then
    ln -sf "$BIN_DIR/sulcus" "$LOCAL_BIN/sulcus"
    ok "Symlinked to $LOCAL_BIN/sulcus"
  fi
fi

# ─── 2. Smoke Verification & PATH ───────────────────────────────────
heading "2. Verifying Binary Integrity"

if SMOKE_OUT="$("$BIN_DIR/sulcus" --verify-self 2>&1)"; then
  ok "Self-verification passed: ${BOLD}$(printf '%s\n' "$SMOKE_OUT" | head -n 1)${RESET}"
elif SMOKE_OUT="$("$BIN_DIR/sulcus" --version 2>&1)"; then
  ok "Verified binary: ${BOLD}$(printf '%s\n' "$SMOKE_OUT" | head -n 1)${RESET}"
else
  err "Installed binary at $BIN_DIR/sulcus failed smoke verification."
  exit 1
fi

PATH_RESOLVED=false
case ":$PATH:" in
  *":$BIN_DIR:"*|*":$LOCAL_BIN:"*) PATH_RESOLVED=true ;;
esac
if command -v sulcus >/dev/null 2>&1; then
  PATH_RESOLVED=true
fi

if [ "$PATH_RESOLVED" = false ]; then
  warn "$BIN_DIR is not currently in your system PATH."
  DETECTED_SHELL="$(basename "${SHELL:-bash}")"
  SHELL_RC=""
  case "$DETECTED_SHELL" in
    zsh)  SHELL_RC="$HOME/.zshrc" ;;
    bash) SHELL_RC="$HOME/.bashrc" ;;
    fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
  esac

  if [ -n "$SHELL_RC" ] && [ -f "$SHELL_RC" ]; then
    if ! grep -Fq "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
      info "Adding $BIN_DIR to $SHELL_RC..."
      if [ "$DETECTED_SHELL" = "fish" ]; then
        printf "\nfish_add_path %s\n" "$BIN_DIR" >> "$SHELL_RC"
      else
        printf "\n# Sulcus binary PATH\nexport PATH=\"%s:%s:\$PATH\"\n" "$BIN_DIR" "$LOCAL_BIN" >> "$SHELL_RC"
      fi
      ok "Updated $SHELL_RC (reload shell or run: source $SHELL_RC)"
    fi
  else
    info "To use 'sulcus' anywhere, add this to your shell profile:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
  fi
fi

# ─── 3. Zero-Lock MCP & Workstation Setup ───────────────────────────
heading "3. Workstation & Zero-Lock MCP Setup"

if [ "$AUTO_CONFIGURE_MCP" = true ]; then
  if "$BIN_DIR/sulcus" doctor --fix; then
    ok "Workstation diagnostics & self-repair complete"
    if "$BIN_DIR/sulcus" connect all --global >/dev/null 2>&1; then
      ok "Configured zero-lock MCP (mcp-proxy) across global agent harnesses"
    fi
  elif "$BIN_DIR/sulcus" connect all --global 2>/dev/null || "$BIN_DIR/sulcus" connect all 2>/dev/null; then
    ok "Configured zero-lock MCP (mcp-proxy) across agent harnesses"
  else
    warn "Automatic workstation wiring skipped (run 'sulcus connect' in your project)."
    info "Manual zero-lock MCP configuration:"
    echo '  {"mcpServers":{"sulcus":{"command":"sulcus","args":["mcp-proxy"]}}}'
  fi
else
  info "Skipped automatic MCP wiring (--no-mcp)."
  info "Run '${CYAN}sulcus doctor --fix${RESET}' or '${CYAN}sulcus connect${RESET}' anytime to wire zero-lock MCP (mcp-proxy)."
fi

# ─── Success Banner ─────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ${GREEN}${BOLD}Sulcus Installation Complete!${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ${BOLD}Binary Location:${RESET}   $BIN_DIR/sulcus"
echo "  ${BOLD}Sulcus Home:${RESET}       $SULCUS_HOME"
echo "  ${BOLD}Platform:${RESET}          $OS/$ARCH ($DISTRO_TARGET)"
echo "  ${BOLD}MCP Transport:${RESET}     Zero-lock bridge (sulcus mcp-proxy)"
echo ""
echo "  ${BOLD}Next Steps:${RESET}"
echo "    • Check workstation health: ${CYAN}sulcus status${RESET}"
echo "    • Authenticate Cloud / VPC: ${CYAN}sulcus login${RESET}"
echo "    • Wire project harnesses:   ${CYAN}sulcus connect${RESET}"
echo "    • Start local sidecar UI:   ${CYAN}sulcus daemon start${RESET}  -> ${CYAN}http://127.0.0.1:4203${RESET}"
echo ""
echo "  ${BOLD}Documentation & Releases:${RESET}"
echo "    Docs:   ${CYAN}https://sulcus.ca/docs${RESET}"
echo "    GitHub: ${CYAN}https://github.com/digitalforgeca/sulcus${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
