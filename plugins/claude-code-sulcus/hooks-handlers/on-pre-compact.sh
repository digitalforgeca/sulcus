#!/usr/bin/env bash
# Sulcus Memory — PreCompact hook
# Fires before Claude Code compacts the context window.
# Stores an episodic marker so Sulcus knows compaction occurred.
# Fire and forget — non-blocking.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_sulcus-lib.sh
source "${SCRIPT_DIR}/_sulcus-lib.sh"

if [ "$SULCUS_MODE" = "none" ]; then
  exit 0
fi

sulcus_store "Session compaction occurred. Key context may have been truncated. Review recent memories for continuity." "episodic" &
exit 0
