/**
 * Capture utilities for Sulcus auto-capture in Claude Code hooks.
 *
 * Provides:
 * - Junk filtering (system blobs, credentials, noise)
 * - File-based dedup (hooks run as separate processes, can't share memory)
 * - Correction detection with related memory heat-boosting
 * - Generic acknowledgment detection (for assistant output capture)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATE_DIR = path.join(os.homedir(), '.sulcus-claude');
const DEDUP_FILE = path.join(STATE_DIR, 'capture-dedup.json');
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ---- Junk patterns (ported from OpenClaw plugin) ----------------------------
// Content matching these is system noise / credentials / metadata — never store.

const JUNK_PATTERNS = [
  /^(HEARTBEAT_OK|NO_REPLY|NOOP)$/i,
  /^\s*$/,
  /^system:\s/i,
  /^(Gateway restart|Plugin .* updated|Discord inbound)/i,
  /^\[?(message_id|sender_id|conversation_label|schema)[\]":]/i,
  /^```json\s*\{?\s*"(message_id|sender_id|schema|chat_id)/i,
  /^Conversation info \(untrusted/i,
  /^Sender \(untrusted/i,
  /^UNTRUSTED (channel|Discord)/i,
  /^<<<EXTERNAL_UNTRUSTED_CONTENT/i,
  /^Runtime:/i,
  /^\{"tool_calls":/i,
  /^<function_calls>\s*<invoke/i,
  /\[Inter-session message\]\s*sourceSession=/i,
  /<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>/,
  /<<<END_UNTRUSTED_CHILD_RESULT>>>/,
  /\[Internal task completion event\]/i,
  /^source:\s*subagent/im,
  /session_key:\s*agent:main:subagent:/i,
  /^Sulcus validation cycle\./i,
  /^Heartbeat prompt:/i,
  /OpenClaw runtime context \(internal\)/i,
  // Credential patterns — never store secrets
  /\b(sk-[a-f0-9]{40,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,})\b/,
  /\b(api[_-]?key|secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}/i,
];

function isJunkContent(text) {
  if (!text || text.length < 10) return true;
  if (text.length > 10000) return true;
  const trimmed = text.trim();
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

// ---- File-based dedup -------------------------------------------------------
// Claude Code hooks run as separate node processes per invocation.
// In-memory Maps don't persist. Use a JSON file for dedup state.

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function loadDedupState() {
  ensureStateDir();
  try {
    if (fs.existsSync(DEDUP_FILE)) {
      return JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf-8'));
    }
  } catch { /* corrupted — start fresh */ }
  return {};
}

function saveDedupState(state) {
  ensureStateDir();
  try {
    fs.writeFileSync(DEDUP_FILE, JSON.stringify(state));
  } catch { /* best-effort */ }
}

/**
 * Returns true if this content should be captured (not a recent duplicate).
 * Uses file-based dedup with automatic expiry.
 */
function shouldCapture(content) {
  const key = content.substring(0, 120) + '|' + content.length;
  const now = Date.now();
  const state = loadDedupState();

  // Purge expired entries
  for (const [k, ts] of Object.entries(state)) {
    if (now - ts > DEDUP_WINDOW_MS) delete state[k];
  }

  if (state[key]) {
    return false; // duplicate within window
  }

  state[key] = now;
  saveDedupState(state);
  return true;
}

// ---- Correction detection ---------------------------------------------------

const CORRECTION_MARKERS = [
  'actually,', 'actually ', "that's wrong", 'thats wrong',
  'that is wrong', 'correction:', 'no, it', "no it's", 'not quite',
  'update:', 'i meant', 'i mean', 'i was wrong', 'was incorrect',
  'is incorrect', 'please update', 'forget that', 'ignore that',
  'disregard', 'instead,', 'rather,', 'not that,', 'fix:',
];

function isCorrectionMessage(text) {
  const lower = text.toLowerCase();
  return CORRECTION_MARKERS.some(m => lower.includes(m));
}

// ---- Generic acknowledgment detection (assistant output) --------------------

const GENERIC_ACK_PATTERNS = [
  /^(ok|okay|sure|got it|will do|understood|noted|done|sounds good|great|perfect|no problem|no worries|absolutely|certainly|of course|copy that|roger|on it|right away|working on it|let me|i'll|i will)[.!,]?$/i,
  /^(yes|yeah|yep|yup|nope|no|nah)[.!]?$/i,
  /^(thanks|thank you|thx|ty)[.!]?$/i,
  /^(one moment|just a moment|give me a (second|moment|sec))[.!,]?$/i,
  /^(looking into|checking|fetching|retrieving|processing|analyzing)\b/i,
];

function isGenericAck(text) {
  const trimmed = text.trim();
  if (trimmed.length > 250) return false;
  return GENERIC_ACK_PATTERNS.some(p => p.test(trimmed));
}

// ---- Assistant output summarization -----------------------------------------

const ASSISTANT_CAPTURE_MAX_DIRECT = 1500;

const DECISION_MARKERS = [
  'decided', 'recommend', 'conclusion', 'therefore', 'result:',
  'outcome:', 'solution:', 'answer:', 'key point', 'important:',
  'note:', 'summary:', 'in summary', 'to summarize', 'bottom line',
  'takeaway',
];

/**
 * Compresses a long assistant response into a compact summary for storage.
 * Extracts: first paragraph (context), decision-bearing paragraphs, last paragraph (conclusion).
 */
function summarizeForCapture(text) {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 20);
  if (paragraphs.length === 0) return text.substring(0, ASSISTANT_CAPTURE_MAX_DIRECT);

  const keyParagraphs = [];

  // Always include first paragraph (sets context)
  if (paragraphs[0]) keyParagraphs.push(paragraphs[0]);

  // Include paragraphs with decision markers
  for (let i = 1; i < paragraphs.length - 1; i++) {
    const pLower = paragraphs[i].toLowerCase();
    if (DECISION_MARKERS.some(m => pLower.includes(m))) {
      keyParagraphs.push(paragraphs[i]);
      if (keyParagraphs.length >= 3) break;
    }
  }

  // Always include last paragraph (conclusion)
  const last = paragraphs[paragraphs.length - 1];
  if (last && last !== keyParagraphs[0]) keyParagraphs.push(last);

  return keyParagraphs.join(' [...] ').substring(0, ASSISTANT_CAPTURE_MAX_DIRECT);
}

module.exports = {
  isJunkContent,
  shouldCapture,
  isCorrectionMessage,
  isGenericAck,
  summarizeForCapture,
  ASSISTANT_CAPTURE_MAX_DIRECT,
};
