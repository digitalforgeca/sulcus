#!/usr/bin/env bash
# Sulcus Memory — Stop hook
# Fires on Claude Code session shutdown.
# Stores a brief episodic marker so Sulcus knows when sessions ended.
# Fire and forget — non-blocking.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_sulcus-lib.sh
source "${SCRIPT_DIR}/_sulcus-lib.sh"

if [ "$SULCUS_MODE" = "none" ]; then
  exit 0
fi

sulcus_store "Claude Code session ended." "episodic" &
exit 0
