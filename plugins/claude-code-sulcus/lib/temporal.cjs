/**
 * Temporal re-ranking and supersession — handles time-aware recall ordering.
 *
 * Two features ported from the OpenClaw plugin:
 *
 * 1. **Temporal re-ranking** (Task 79): Detects temporal queries ("yesterday",
 *    "last week", "when did...") and re-sorts recall results chronologically
 *    (oldest → newest) instead of by relevance/heat.
 *
 * 2. **Temporal supersession** (Task 80): When two memories share significant
 *    topic overlap and one is newer (or contains correction language), the
 *    older one gets a score penalty so it ranks below the budget cut line.
 *    The newer memory stays prominent — the older one becomes a footnote.
 */
'use strict';

const { tokenize, jaccard } = require('./diversity-filter.cjs');

// ---------------------------------------------------------------------------
// Temporal query detection (Task 79)
// ---------------------------------------------------------------------------

const TEMPORAL_KEYWORDS = [
  'yesterday', 'today', 'last week', 'this week', 'last month', 'this month',
  'days ago', 'hours ago', 'weeks ago', 'months ago',
  'last monday', 'last tuesday', 'last wednesday', 'last thursday',
  'last friday', 'last saturday', 'last sunday',
  'recently', 'timeline', 'chronolog', 'sequence of', 'in order',
  'what order', 'time order', 'when did', 'when was', 'since when',
  'how long ago', 'first thing', 'before that', 'after that',
];

/**
 * Detect whether a user query is asking about events in time-order.
 * @param {string} query - User's prompt text
 * @returns {boolean}
 */
function isTemporalQuery(query) {
  const q = (query || '').toLowerCase();
  return TEMPORAL_KEYWORDS.some(kw => q.includes(kw));
}

/**
 * Parse an ISO timestamp to epoch milliseconds. Returns 0 on failure.
 * @param {string|undefined} iso
 * @returns {number}
 */
function parseISOMs(iso) {
  if (!iso) return 0;
  try {
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

/**
 * Re-sort recall results chronologically (oldest → newest) for temporal queries.
 *
 * Only re-ranks if at least half the results have timestamps — otherwise
 * chronological ordering would be meaningless (too many unknowns).
 *
 * Returns a new array — does not mutate the input.
 *
 * @param {Array<Object>} items - Memory objects with updated_at field
 * @returns {Array<Object>} Chronologically sorted items (or original if insufficient timestamps)
 */
function temporalRerank(items) {
  if (!items || items.length <= 1) return items;

  const withTimestamp = items.filter(r => r.updated_at);
  // Only re-rank if at least half have timestamps
  if (withTimestamp.length < items.length / 2) return items;

  return [...items].sort((a, b) => {
    return parseISOMs(a.updated_at) - parseISOMs(b.updated_at); // ascending = oldest first
  });
}

// ---------------------------------------------------------------------------
// Temporal supersession (Task 80)
// ---------------------------------------------------------------------------

const NEGATION_MARKERS = [
  'actually', "that's wrong", "that's incorrect", 'not true',
  'no longer', 'changed to', 'switched to', 'replaced by',
  'correction', 'mistake', 'was wrong', 'instead', 'update:',
];

const SUPERSESSION_SCORE_PENALTY = 0.5;  // 50% heat penalty on superseded items
const SUPERSESSION_MIN_OVERLAP = 0.35;   // minimum topic overlap to compare
const SUPERSESSION_STALENESS_GAP_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Check if text contains negation/correction language.
 * @param {string} text
 * @returns {boolean}
 */
function hasNegationMarker(text) {
  const lower = (text || '').toLowerCase();
  return NEGATION_MARKERS.some(m => lower.includes(m));
}

/**
 * Scan recall items for supersession relationships.
 *
 * When two memories share significant topic overlap and one is newer
 * (by timestamp or by containing correction/negation language), the
 * older one gets _superseded=true and a heat penalty.
 *
 * Mutates items in-place. Returns count of superseded items.
 *
 * @param {Array<Object>} items - Memory objects with label/content, current_heat, updated_at
 * @returns {number} Count of items marked as superseded
 */
function markSuperseded(items) {
  if (!items || items.length <= 1) return 0;

  let supersededCount = 0;
  const alreadySuperseded = new Set();

  for (let i = 0; i < items.length; i++) {
    if (alreadySuperseded.has(i)) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (alreadySuperseded.has(j)) continue;

      const a = items[i];
      const b = items[j];
      const textA = a.pointer_summary || a.label || a.content || '';
      const textB = b.pointer_summary || b.label || b.content || '';

      const tokensA = tokenize(textA);
      const tokensB = tokenize(textB);
      const overlap = jaccard(tokensA, tokensB);

      if (overlap < SUPERSESSION_MIN_OVERLAP) continue;

      // Determine which is newer
      const aNeg = hasNegationMarker(textA);
      const bNeg = hasNegationMarker(textB);
      const aMs = parseISOMs(a.updated_at);
      const bMs = parseISOMs(b.updated_at);

      let olderIdx = null;

      // Negation supersession: the corrective memory supersedes the original
      if (aNeg !== bNeg) {
        olderIdx = aNeg ? j : i; // non-negation item is the older/superseded one
      }
      // Staleness supersession: significantly newer timestamp wins
      else if (aMs > 0 && bMs > 0 && Math.abs(aMs - bMs) > SUPERSESSION_STALENESS_GAP_MS) {
        olderIdx = aMs < bMs ? i : j;
      }

      if (olderIdx !== null) {
        items[olderIdx]._superseded = true;
        const heat = items[olderIdx].current_heat ?? 0;
        items[olderIdx].current_heat = heat * SUPERSESSION_SCORE_PENALTY;
        alreadySuperseded.add(olderIdx);
        supersededCount++;
      }
    }
  }

  return supersededCount;
}

module.exports = {
  isTemporalQuery,
  temporalRerank,
  markSuperseded,
  hasNegationMarker,
  parseISOMs,
  TEMPORAL_KEYWORDS,
};
