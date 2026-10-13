#!/usr/bin/env bash
# ==============================================================================
# Sulcus SDK Validation Suite
#
# Validates both Python and Node.js/TypeScript SDKs:
# 1. Type correctness & bundle generation
# 2. Automated test suites (Python pytest & Node.js native runner)
# 3. Security validation guardrails & credential masking
# 4. Terminology compliance & secret leak prevention
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Check for local Docker execution flag
if [[ "${1:-}" == "--docker" || "${1:-}" == "-d" ]]; then
  echo -e "${BOLD}${BLUE}======================================================================${NC}"
  echo -e "${BOLD}${BLUE}       LAUNCHING SULCUS SDK VALIDATION (LOCAL DOCKER RUNNER)          ${NC}"
  echo -e "${BOLD}${BLUE}======================================================================${NC}"
  docker build -t sulcus-sdk-validator -f "${REPO_ROOT}/sdks/Dockerfile.validate" "${REPO_ROOT}"
  docker run --rm \
    -v "${REPO_ROOT}:/workspace" \
    -v sulcus_linux_nodemodules:/workspace/sdks/node/node_modules \
    sulcus-sdk-validator /bin/bash -c "cd /workspace/sdks/node && npm install --silent && /workspace/scripts/validate_sdks.sh"
  exit $?
fi

echo -e "${BOLD}${BLUE}======================================================================${NC}"
echo -e "${BOLD}${BLUE}              SULCUS CLIENT SDK VALIDATION RUNNER                     ${NC}"
echo -e "${BOLD}${BLUE}======================================================================${NC}"
echo "Repository: ${REPO_ROOT}"
echo "Date:       $(date -u)"
echo ""

# ------------------------------------------------------------------------------
# 1. Python SDK Validation
# ------------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}>> [1/3] Validating Python SDK (sdks/python)...${NC}"

if command -v python3 >/dev/null 2>&1; then
  echo -e "   Checking Python syntax compilation..."
  python3 -m py_compile "${REPO_ROOT}/sdks/python/sulcus"/*.py
  echo -e "   ${GREEN}✓ Python syntax check passed.${NC}"

  echo -e "   Running pytest test suite..."
  PYTHONPATH="${REPO_ROOT}/sdks/python" python3 -m pytest "${REPO_ROOT}/sdks/python/tests" -v --tb=short
  echo -e "   ${GREEN}✓ Python automated test suite passed.${NC}"
else
  echo -e "   ${RED}✗ Python3 not found in PATH!${NC}"
  exit 1
fi

echo ""

# ------------------------------------------------------------------------------
# 2. Node.js / TypeScript SDK Validation
# ------------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}>> [2/3] Validating Node.js SDK (sdks/node)...${NC}"

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  echo -e "   Building CJS, ESM, and TypeScript declaration bundles..."
  (cd "${REPO_ROOT}/sdks/node" && npm run build)

  # Check that output artifacts exist and are non-empty
  for f in "${REPO_ROOT}/sdks/node/dist/index.js" "${REPO_ROOT}/sdks/node/dist/index.mjs" "${REPO_ROOT}/sdks/node/dist/index.d.ts"; do
    if [[ ! -s "$f" ]]; then
      echo -e "   ${RED}✗ Expected build artifact missing or empty: $f${NC}"
      exit 1
    fi
  done
  echo -e "   ${GREEN}✓ Bundle artifacts verified (CJS, ESM, DTS).${NC}"

  echo -e "   Running Node.js automated test suite..."
  (cd "${REPO_ROOT}/sdks/node" && npm test)
  echo -e "   ${GREEN}✓ Node.js automated test suite passed.${NC}"
else
  echo -e "   ${RED}✗ Node or npm not found in PATH!${NC}"
  exit 1
fi

echo ""

# ------------------------------------------------------------------------------
# 3. Compliance & Security Audit
# ------------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}>> [3/3] Running Compliance & Security Leak Audit...${NC}"

# Check for forbidden SOTA buzzword
if grep -rnI -i --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=test --exclude-dir=tests --exclude-dir=__pycache__ "SOTA" "${REPO_ROOT}/sdks/" >/dev/null 2>&1; then
  echo -e "   ${RED}✗ Forbidden buzzword found in SDK files!${NC}"
  grep -rnI -i --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=test --exclude-dir=tests --exclude-dir=__pycache__ "SOTA" "${REPO_ROOT}/sdks/"
  exit 1
else
  echo -e "   ${GREEN}✓ Clean terminology verified.${NC}"
fi

# Check for live unmasked keys or tokens accidentally committed
if grep -rnI --exclude-dir=test --exclude-dir=tests --exclude-dir=dist --exclude-dir=__pycache__ --exclude-dir=node_modules "sk-live_[0-9a-zA-Z]\{20,\}" "${REPO_ROOT}/sdks/" >/dev/null 2>&1; then
  echo -e "   ${RED}✗ Potential live API key pattern found in non-test source files!${NC}"
  exit 1
else
  echo -e "   ${GREEN}✓ No live credentials detected in source trees.${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}======================================================================${NC}"
echo -e "${BOLD}${GREEN}        ALL SDK VALIDATION SUITES & SECURITY CHECKS PASSED!           ${NC}"
echo -e "${BOLD}${GREEN}======================================================================${NC}"
