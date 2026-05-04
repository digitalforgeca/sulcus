#!/bin/bash
# =============================================================================
# Sulcus Industry Benchmark Runner
# =============================================================================
# Runs LoCoMo and LongMemEval benchmarks against Sulcus production server.
#
# Modes:
#   predict-only  — Ingest + search only. No LLM cost. (~2-5 min)
#   full          — Ingest + search + answer + judge. Needs OPENAI_API_KEY. (~15-30 min)
#
# Usage:
#   ./run_benchmarks.sh [predict-only|full] [locomo|longmemeval|all]
#
# Environment:
#   SULCUS_API_KEY    — Required (auto-read from OpenClaw config if not set)
#   OPENAI_API_KEY    — Required for full mode
#   SULCUS_BASE_URL   — Optional (default: https://api.sulcus.ca)
# =============================================================================

set -euo pipefail

MODE="${1:-predict-only}"
BENCHMARKS="${2:-all}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="/tmp/bench-venv"
UPSTREAM_DIR="/tmp/mem0-benchmarks"
RESULTS_DIR="${SCRIPT_DIR}/results"
TIMESTAMP=$(date +%s)

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[bench]${NC} $*"; }
warn() { echo -e "${YELLOW}[bench]${NC} $*"; }
err()  { echo -e "${RED}[bench]${NC} $*" >&2; }

# ── Auto-detect SULCUS_API_KEY from OpenClaw config ─────────────────────────
if [ -z "${SULCUS_API_KEY:-}" ]; then
    SULCUS_API_KEY=$(python3 -c "
import json, sys
try:
    with open('/mnt/forge/agents/daedalus/openclaw.json') as f:
        cfg = json.load(f)
    key = cfg.get('plugins',{}).get('entries',{}).get('openclaw-sulcus',{}).get('config',{}).get('apiKey','')
    print(key)
except: pass
" 2>/dev/null || true)
    if [ -n "${SULCUS_API_KEY}" ]; then
        export SULCUS_API_KEY
        log "Auto-detected SULCUS_API_KEY from OpenClaw config"
    else
        err "SULCUS_API_KEY not set and not found in OpenClaw config"
        exit 1
    fi
fi

export SULCUS_BASE_URL="${SULCUS_BASE_URL:-https://api.sulcus.ca}"

# ── Ensure venv + deps ──────────────────────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    log "Creating Python venv at $VENV_DIR..."
    python3 -m venv "$VENV_DIR" 2>/dev/null || {
        apt-get install -y -qq python3.11-venv 2>/dev/null
        python3 -m venv "$VENV_DIR"
    }
    . "$VENV_DIR/bin/activate"
    pip install -q aiolimiter aiohttp openai tqdm pydantic python-dotenv requests
else
    . "$VENV_DIR/bin/activate"
fi

# ── Ensure upstream harness is cloned ────────────────────────────────────────
if [ ! -d "$UPSTREAM_DIR/benchmarks/locomo" ]; then
    log "Cloning mem0ai/memory-benchmarks..."
    git clone --depth 1 https://github.com/mem0ai/memory-benchmarks.git "$UPSTREAM_DIR" 2>/dev/null
fi

# ── Copy our Sulcus adapter files into the upstream clone ────────────────────
cp -f "$SCRIPT_DIR/benchmarks/common/sulcus_client.py" "$UPSTREAM_DIR/benchmarks/common/"
cp -f "$SCRIPT_DIR/benchmarks/locomo/run_sulcus.py" "$UPSTREAM_DIR/benchmarks/locomo/"
cp -f "$SCRIPT_DIR/benchmarks/longmemeval/run_sulcus.py" "$UPSTREAM_DIR/benchmarks/longmemeval/"

mkdir -p "$RESULTS_DIR"

# ── Build common args ───────────────────────────────────────────────────────
PREDICT_FLAG=""
if [ "$MODE" = "predict-only" ]; then
    PREDICT_FLAG="--predict-only"
fi

# ── Run LoCoMo ──────────────────────────────────────────────────────────────
run_locomo() {
    local project="sulcus-locomo-${TIMESTAMP}"
    local output_dir="$RESULTS_DIR/locomo"
    mkdir -p "$output_dir"

    log "Running LoCoMo benchmark (mode=$MODE)..."
    cd "$UPSTREAM_DIR"

    python3 -m benchmarks.locomo.run_sulcus \
        --project-name "$project" \
        --sulcus-api-key "$SULCUS_API_KEY" \
        --output-dir "$output_dir" \
        --max-workers 2 \
        --rpm 60 \
        $PREDICT_FLAG \
        2>&1 | tee "$output_dir/run_${TIMESTAMP}.log"

    local exit_code=$?
    if [ $exit_code -eq 0 ]; then
        log "LoCoMo completed. Results in $output_dir"
    else
        warn "LoCoMo exited with code $exit_code"
    fi
    return $exit_code
}

# ── Run LongMemEval ─────────────────────────────────────────────────────────
run_longmemeval() {
    local project="sulcus-longmemeval-${TIMESTAMP}"
    local output_dir="$RESULTS_DIR/longmemeval"
    mkdir -p "$output_dir"

    log "Running LongMemEval benchmark (mode=$MODE)..."
    cd "$UPSTREAM_DIR"

    python3 -m benchmarks.longmemeval.run_sulcus \
        --project-name "$project" \
        --sulcus-api-key "$SULCUS_API_KEY" \
        --output-dir "$output_dir" \
        --max-workers 2 \
        --rpm 60 \
        $PREDICT_FLAG \
        2>&1 | tee "$output_dir/run_${TIMESTAMP}.log"

    local exit_code=$?
    if [ $exit_code -eq 0 ]; then
        log "LongMemEval completed. Results in $output_dir"
    else
        warn "LongMemEval exited with code $exit_code"
    fi
    return $exit_code
}

# ── Main ─────────────────────────────────────────────────────────────────────
log "Sulcus Industry Benchmark Runner"
log "Mode: $MODE | Benchmarks: $BENCHMARKS"
log "API: $SULCUS_BASE_URL"

LOCOMO_EXIT=0
LONGMEMEVAL_EXIT=0

if [ "$BENCHMARKS" = "all" ] || [ "$BENCHMARKS" = "locomo" ]; then
    run_locomo || LOCOMO_EXIT=$?
fi

if [ "$BENCHMARKS" = "all" ] || [ "$BENCHMARKS" = "longmemeval" ]; then
    run_longmemeval || LONGMEMEVAL_EXIT=$?
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
log "═══════════════════════════════════════"
log "Benchmark run complete"
[ "$BENCHMARKS" != "longmemeval" ] && log "  LoCoMo:      $([ $LOCOMO_EXIT -eq 0 ] && echo '✅' || echo '❌')"
[ "$BENCHMARKS" != "locomo" ]      && log "  LongMemEval: $([ $LONGMEMEVAL_EXIT -eq 0 ] && echo '✅' || echo '❌')"
log "  Results:     $RESULTS_DIR"
log "═══════════════════════════════════════"

exit $(( LOCOMO_EXIT + LONGMEMEVAL_EXIT ))
