/**
 * Diversity filter — remove near-duplicate recall results.
 *
 * Uses Jaccard overlap on token sets to detect results that are
 * semantically near-identical. Keeps the first (highest-scored) result
 * when two results overlap above the threshold.
 *
 * This improves recall quality by ensuring the LLM sees diverse
 * perspectives rather than multiple copies of similar information.
 */
'use strict';

// Common stop words to exclude from token comparison
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
  'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
  'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very',
  'just', 'about', 'up', 'out', 'if', 'then', 'this', 'that',
  'it', 'its', 'he', 'she', 'they', 'we', 'you', 'i', 'me',
  'my', 'your', 'his', 'her', 'our', 'their', 'what', 'which',
  'who', 'whom', 'how', 'when', 'where', 'why',
]);

/**
 * Extract meaningful tokens from text for overlap comparison.
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  const words = (text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const tokens = new Set();
  for (const w of words) {
    if (w.length > 2 && !STOP_WORDS.has(w)) {
      tokens.add(w);
    }
  }
  return tokens;
}

/**
 * Jaccard similarity between two token sets.
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Remove near-duplicate results using Jaccard overlap on token sets.
 *
 * Keeps the first (highest-scored) result when two results overlap
 * above the threshold. Results should be pre-sorted by relevance
 * (score/heat descending).
 *
 * @param {Array<Object>} results - Memory objects with content/label/pointer_summary
 * @param {number} [threshold=0.6] - Jaccard overlap threshold for dedup
 * @returns {Array<Object>} Filtered results
 */
function diversityFilter(results, threshold = 0.6) {
  if (!results || results.length <= 1) return results;

  const kept = [];
  const keptTokens = [];

  for (const item of results) {
    const text = item.pointer_summary || item.label || item.content || '';
    const tokens = tokenize(text);

    if (tokens.size === 0) {
      kept.push(item); // can't compare — keep it
      continue;
    }

    let isDup = false;
    for (const existing of keptTokens) {
      if (jaccard(tokens, existing) > threshold) {
        isDup = true;
        break;
      }
    }

    if (!isDup) {
      kept.push(item);
      keptTokens.push(tokens);
    }
  }

  return kept;
}

module.exports = { diversityFilter, tokenize, jaccard };
