#!/usr/bin/env bash
# Sulcus Memory — Stop hook
# Fires on Claude Code session shutdown.
# Stores a brief episodic marker so Sulcus knows when sessions ended.
# Fire and forget — non-blocking.
# Supports cloud mode (SULCUS_API_KEY) and local mode (sulcus binary).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_sulcus-lib.sh
source "${SCRIPT_DIR}/_sulcus-lib.sh"

# Skip silently if not configured
if [ "$SULCUS_MODE" = "none" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Cloud mode — fire and forget via curl
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "cloud" ]; then
  curl -sf -X POST "${SULCUS_URL}/api/v1/agent/memory" \
    -H "Authorization: Bearer ${SULCUS_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"content": "Claude Code session ended.", "memory_type": "episodic", "train": false}' \
    > /dev/null 2>&1 &
fi

# ---------------------------------------------------------------------------
# Local mode — fire and forget via JSON-RPC stdio
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "local" ]; then
  sulcus_local_call "record_memory" \
    '{"content":"Claude Code session ended.","memory_type":"episodic"}' \
    > /dev/null 2>&1 &
fi

exit 0
