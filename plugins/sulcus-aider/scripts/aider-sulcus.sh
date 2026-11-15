#!/usr/bin/env bash
# Sulcus Proactive Memory Wrapper for Aider (pure-Rust `sulcus hook --harness aider`)
set -e

export SULCUS_MODEL_CACHE_DIR="${SULCUS_MODEL_CACHE_DIR:-$HOME/.sulcus/models/fastembed}"
export PATH="$HOME/.sulcus/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
CONTEXT_FILE=".aider.sulcus-context.md"

# Query Sulcus for proactive memory via compiled single-binary hook
sulcus hook --harness aider recall "current project architecture rules" </dev/null > "${CONTEXT_FILE}" 2>/dev/null || true

# Execute Aider with context primed
if [ -s "${CONTEXT_FILE}" ]; then
  exec aider --read "${CONTEXT_FILE}" "$@"
else
  rm -f "${CONTEXT_FILE}"
  exec aider "$@"
fi
