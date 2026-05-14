/**
 * Context-window throttling for Sulcus Claude Code plugin.
 *
 * Claude Code hooks don't receive context window size or token counts.
 * We estimate usage by tracking:
 * - Turn count (UserPromptSubmit invocations)
 * - Prompt lengths (the text we see)
 * - Estimated response size (heuristic: ~1.5x prompt length, capped)
 * - Recall injection sizes (what we add)
 *
 * Throttle levels scale the recall budget down as context fills up,
 * eventually muting recall entirely to preserve context for actual work.
 *
 * State persisted to disk because hooks run as separate processes.
 *
 * Configuration:
 *   SULCUS_CONTEXT_WINDOW=200000    # Total context window in tokens (default: 200k)
 *   SULCUS_THROTTLE_ENABLED=true    # Enable/disable throttling (default: true)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATE_DIR = path.join(os.homedir(), '.sulcus-claude');
const STATE_FILE = path.join(STATE_DIR, 'context-state.json');

const CHARS_PER_TOKEN = 4; // rough heuristic

// Default context window: 200k tokens (Claude Sonnet 4/Opus 4)
const CONTEXT_WINDOW_TOKENS = parseInt(process.env.SULCUS_CONTEXT_WINDOW || '200000', 10);
const THROTTLE_ENABLED = (process.env.SULCUS_THROTTLE_ENABLED || 'true') === 'true';

// Throttle thresholds (fraction of context window)
const THRESHOLD_REDUCED = 0.60; // Scale recall budget to 50%
const THRESHOLD_MUTED   = 0.80; // Skip recall entirely (hot memories only)
const THRESHOLD_SILENT  = 0.90; // No Sulcus injection at all

// Estimated overhead per turn (system prompt fragments, tool schemas, etc.)
const PER_TURN_OVERHEAD_TOKENS = 200;

// Average response length when we don't know (conservative estimate)
const DEFAULT_RESPONSE_TOKENS = 800;

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch { /* corrupted — start fresh */ }
  return freshState();
}

function saveState(state) {
  ensureStateDir();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* best-effort */ }
}

function freshState() {
  return {
    turnCount: 0,
    estimatedTokensUsed: 0,
    recallTokensInjected: 0,
    sessionStartedAt: Date.now(),
    compactionCount: 0,
    lastTurnAt: null,
  };
}

// ---------------------------------------------------------------------------
// Turn tracking
// ---------------------------------------------------------------------------

/**
 * Record a new user turn. Call at the start of UserPromptSubmit.
 *
 * @param {number} promptLength - Character length of the user prompt
 * @param {number} [recallInjectionChars] - Characters of recall context injected this turn
 * @returns {Object} Updated state
 */
function recordTurn(promptLength, recallInjectionChars = 0) {
  const state = loadState();

  state.turnCount += 1;
  state.lastTurnAt = Date.now();

  // Estimate tokens for this turn
  const promptTokens = Math.ceil(promptLength / CHARS_PER_TOKEN);
  const recallTokens = Math.ceil(recallInjectionChars / CHARS_PER_TOKEN);
  // Estimate response: roughly 1.5x prompt but capped at 4k tokens
  const responseEstimate = Math.min(Math.ceil(promptTokens * 1.5), 4000) || DEFAULT_RESPONSE_TOKENS;

  state.estimatedTokensUsed += promptTokens + responseEstimate + PER_TURN_OVERHEAD_TOKENS;
  state.recallTokensInjected += recallTokens;

  saveState(state);
  return state;
}

/**
 * Record the actual size of recall injection (call after building recall output).
 * More accurate than the estimate in recordTurn.
 *
 * @param {number} injectionChars - Characters of recall context injected
 */
function recordRecallInjection(injectionChars) {
  const state = loadState();
  state.recallTokensInjected += Math.ceil(injectionChars / CHARS_PER_TOKEN);
  state.estimatedTokensUsed += Math.ceil(injectionChars / CHARS_PER_TOKEN);
  saveState(state);
}

// ---------------------------------------------------------------------------
// Throttle level
// ---------------------------------------------------------------------------

/**
 * Get current throttle level based on estimated context usage.
 *
 * @returns {Object} {
 *   level: "normal" | "reduced" | "muted" | "silent",
 *   budgetScale: 0.0-1.0,        // multiply recall token budget by this
 *   estimatedFill: 0.0-1.0,      // estimated fraction of context used
 *   estimatedTokensUsed: number,
 *   turnCount: number,
 *   contextWindowTokens: number,
 *   reason: string,               // human-readable explanation
 * }
 */
function getThrottleLevel() {
  if (!THROTTLE_ENABLED) {
    return {
      level: 'normal',
      budgetScale: 1.0,
      estimatedFill: 0,
      estimatedTokensUsed: 0,
      turnCount: 0,
      contextWindowTokens: CONTEXT_WINDOW_TOKENS,
      reason: 'Throttling disabled',
    };
  }

  const state = loadState();
  const fill = state.estimatedTokensUsed / CONTEXT_WINDOW_TOKENS;

  let level, budgetScale, reason;

  if (fill >= THRESHOLD_SILENT) {
    level = 'silent';
    budgetScale = 0.0;
    reason = `Context ~${(fill * 100).toFixed(0)}% full (>${THRESHOLD_SILENT * 100}%) — Sulcus recall suppressed entirely to preserve context`;
  } else if (fill >= THRESHOLD_MUTED) {
    level = 'muted';
    budgetScale = 0.15; // Just enough for 1-2 critical hot memories
    reason = `Context ~${(fill * 100).toFixed(0)}% full (>${THRESHOLD_MUTED * 100}%) — recall reduced to critical hot memories only`;
  } else if (fill >= THRESHOLD_REDUCED) {
    level = 'reduced';
    budgetScale = 0.50;
    reason = `Context ~${(fill * 100).toFixed(0)}% full (>${THRESHOLD_REDUCED * 100}%) — recall budget halved`;
  } else {
    level = 'normal';
    budgetScale = 1.0;
    reason = `Context ~${(fill * 100).toFixed(0)}% full — normal recall`;
  }

  return {
    level,
    budgetScale,
    estimatedFill: Math.min(fill, 1.0),
    estimatedTokensUsed: state.estimatedTokensUsed,
    turnCount: state.turnCount,
    contextWindowTokens: CONTEXT_WINDOW_TOKENS,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Reset state on session start. Call from SessionStart hook.
 * Also catches stale state from crashed sessions (>4h old).
 */
function resetOnSessionStart() {
  const state = loadState();
  const fourHours = 4 * 60 * 60 * 1000;

  // Always reset on explicit session start, or if state is stale
  if (!state.sessionStartedAt || (Date.now() - state.sessionStartedAt > fourHours)) {
    saveState(freshState());
    return;
  }

  // Fresh session — reset
  saveState(freshState());
}

/**
 * Reset estimates after compaction. The context window is now mostly empty
 * (just the compaction summary + system prompt), so we reduce the estimate
 * dramatically but don't zero it (compaction summary uses ~2-4k tokens).
 */
function resetOnCompact() {
  const state = loadState();
  state.compactionCount += 1;
  // After compaction, context is ~5% full (summary + system prompt)
  state.estimatedTokensUsed = Math.ceil(CONTEXT_WINDOW_TOKENS * 0.05);
  state.recallTokensInjected = 0;
  // Don't reset turnCount — it's useful for session-level tracking
  saveState(state);
}

module.exports = {
  recordTurn,
  recordRecallInjection,
  getThrottleLevel,
  resetOnSessionStart,
  resetOnCompact,
  CONTEXT_WINDOW_TOKENS,
  CHARS_PER_TOKEN,
};
