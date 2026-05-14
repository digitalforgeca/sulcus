/**
 * Topic-shift caching for Sulcus recall in Claude Code hooks.
 *
 * Claude Code hooks run as separate processes — no module-scope caching.
 * This uses a JSON file to persist recall results and topic tokens between
 * invocations, mirroring the OpenClaw plugin's hookRecallCacheMap pattern.
 *
 * How it works:
 * 1. Extract "topic tokens" from the user prompt (lowercase words, stop-filtered).
 * 2. Compute Jaccard-like overlap with the cached topic tokens.
 * 3. If overlap >= threshold AND cache isn't expired → serve cached recall results.
 * 4. Otherwise → signal that a fresh API call is needed.
 *
 * This avoids redundant Sulcus API calls when the user is asking follow-up
 * questions on the same topic (common in coding conversations).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATE_DIR = path.join(os.homedir(), '.sulcus-claude');
const CACHE_FILE = path.join(STATE_DIR, 'topic-cache.json');

// Tuning knobs (match OpenClaw plugin defaults)
const CACHE_TTL_MS = 5 * 60 * 1000;        // 5 minutes hard TTL
const TOPIC_SHIFT_THRESHOLD = 0.25;          // Jaccard overlap below this = topic shift

// English stopwords — same set as OpenClaw plugin
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'it', 'this', 'that', 'be', 'as', 'are',
  'was', 'were', 'has', 'have', 'had', 'do', 'does', 'did', 'can', 'could',
  'will', 'would', 'should', 'i', 'you', 'we', 'they', 'he', 'she', 'me',
  'my', 'your', 'our', 'their', 'its', 'not', 'no', 'so', 'if', 'what',
  'how', 'when', 'where', 'which', 'who', 'from', 'up', 'about', 'into',
  'just', 'also', 'any', 'all', 'than', 'then', 'there', 'been', 'more',
]);

/**
 * Extract topic tokens from text.
 * Strips punctuation, lowercases, removes stopwords and short tokens.
 * Returns an array (not a Set, for JSON serialization).
 */
function extractTopicTokens(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
    .slice(0, 40);
}

/**
 * Compute Jaccard-like overlap between two token arrays.
 * Returns 0–1 where 1 = identical topics.
 */
function topicOverlap(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Set(tokensB);
  let shared = 0;
  for (const token of tokensA) {
    if (setB.has(token)) shared++;
  }
  return shared / Math.max(tokensA.length, tokensB.length);
}

// ---- File I/O ---------------------------------------------------------------

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function loadCache() {
  ensureStateDir();
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch { /* corrupted — start fresh */ }
  return null;
}

function saveCache(data) {
  ensureStateDir();
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch { /* best-effort */ }
}

// ---- Public API -------------------------------------------------------------

/**
 * Check if the topic is stable (cache hit) or shifted (needs fresh recall).
 *
 * @param {string} prompt - Current user prompt
 * @returns {{ hit: boolean, results: any[]|null, overlap: number }}
 *   hit=true means cached results are valid; hit=false means caller should
 *   do a fresh API call and then call updateCache().
 */
function checkTopicCache(prompt) {
  const currentTokens = extractTopicTokens(prompt);
  const cached = loadCache();
  const now = Date.now();

  // No cache exists
  if (!cached || !cached.topicTokens || !cached.results) {
    return { hit: false, results: null, overlap: 0, _tokens: currentTokens };
  }

  // Cache expired
  if (now - (cached.cachedAt || 0) > CACHE_TTL_MS) {
    return { hit: false, results: null, overlap: 0, _tokens: currentTokens };
  }

  // Compute topic overlap
  const overlap = topicOverlap(currentTokens, cached.topicTokens);

  if (overlap < TOPIC_SHIFT_THRESHOLD) {
    // Topic shifted — need fresh recall
    return { hit: false, results: null, overlap, _tokens: currentTokens };
  }

  // Topic stable — serve cached results
  return { hit: true, results: cached.results, overlap, _tokens: currentTokens };
}

/**
 * Store fresh recall results in the topic cache.
 * Call this after a successful API recall when checkTopicCache returned hit=false.
 *
 * @param {string[]} topicTokens - Topic tokens from the prompt (from checkTopicCache._tokens)
 * @param {any[]} results - The recall results to cache
 */
function updateTopicCache(topicTokens, results) {
  saveCache({
    topicTokens,
    results,
    cachedAt: Date.now(),
  });
}

/**
 * Invalidate the topic cache. Call on session boundaries or when
 * context changes significantly.
 */
function clearTopicCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
  } catch { /* best-effort */ }
}

module.exports = {
  extractTopicTokens,
  topicOverlap,
  checkTopicCache,
  updateTopicCache,
  clearTopicCache,
  // Exposed for testing
  TOPIC_SHIFT_THRESHOLD,
  CACHE_TTL_MS,
};
