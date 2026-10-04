/**
 * Sulcus Recall Ranking — MemPalace Phase 2
 *
 * Extracted from index.ts for testability. Contains the core ranking pipeline:
 *   1. BM25 scoring (Okapi BM25 with k1=1.5, b=0.75)
 *   2. Hybrid ranking (0.6 vector + 0.4 BM25)
 *   3. Cosine dedup filter (Jaccard proxy, threshold 0.85)
 *   4. Credential boost (proactive boost for credential-type memories)
 *
 * All functions are pure — no side effects, no I/O, fully deterministic.
 */

// ---------------------------------------------------------------------------
// Stopwords (shared between BM25 and topic extraction)
// ---------------------------------------------------------------------------

export const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "it", "this", "that", "be", "as", "are",
  "was", "were", "has", "have", "had", "do", "does", "did", "can", "could",
  "will", "would", "should", "i", "you", "we", "they", "he", "she", "me",
  "my", "your", "our", "their", "its", "not", "no", "so", "if", "what",
  "how", "when", "where", "which", "who", "from", "up", "about", "into",
  "just", "also", "any", "all", "than", "then", "there", "been", "more",
]);

// ---------------------------------------------------------------------------
// BM25 Scoring
// ---------------------------------------------------------------------------

export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

/**
 * Tokenize text for BM25 — lowercase, strip punctuation, remove stopwords.
 * Returns an array (not a set) to preserve term frequency.
 */
export function bm25Tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Compute BM25 score for a single document against a query.
 */
export function bm25ScoreDoc(
  queryTerms: string[],
  docTerms: string[],
  avgDocLen: number,
  idfMap: Map<string, number>,
): number {
  const docLen = docTerms.length;
  if (docLen === 0 || avgDocLen === 0) return 0;

  const tf = new Map<string, number>();
  for (const t of docTerms) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }

  let score = 0;
  const seenTerms = new Set<string>();
  for (const qt of queryTerms) {
    if (seenTerms.has(qt)) continue;
    seenTerms.add(qt);

    const termFreq = tf.get(qt) ?? 0;
    if (termFreq === 0) continue;

    const idf = idfMap.get(qt) ?? 0;
    const numerator = termFreq * (BM25_K1 + 1);
    const denominator = termFreq + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen));
    score += idf * (numerator / denominator);
  }

  return score;
}

/**
 * Compute BM25 scores for a set of documents against a query.
 * Returns scores normalized to [0, 1] range.
 */
export function bm25Scores(
  query: string,
  documents: Array<{ label: string; [k: string]: unknown }>,
): Map<number, number> {
  const queryTerms = bm25Tokenize(query);
  const docTermArrays = documents.map((d) => bm25Tokenize(d.label));

  const totalLen = docTermArrays.reduce((s, d) => s + d.length, 0);
  const avgDocLen = documents.length > 0 ? totalLen / documents.length : 1;

  const docCount = documents.length;
  const idfMap = new Map<string, number>();
  for (const qt of queryTerms) {
    const df = docTermArrays.filter((d) => d.includes(qt)).length;
    const idf = Math.max(0, Math.log((docCount - df + 0.5) / (df + 0.5) + 1));
    idfMap.set(qt, idf);
  }

  const scores = new Map<number, number>();
  let maxScore = 0;
  for (let i = 0; i < documents.length; i++) {
    const s = bm25ScoreDoc(queryTerms, docTermArrays[i], avgDocLen, idfMap);
    scores.set(i, s);
    if (s > maxScore) maxScore = s;
  }

  if (maxScore > 0) {
    for (const [idx, s] of scores) {
      scores.set(idx, s / maxScore);
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Hybrid Ranking
// ---------------------------------------------------------------------------

export const HYBRID_VECTOR_WEIGHT = 0.6;
export const HYBRID_BM25_WEIGHT = 0.4;

export interface RankedItem {
  label: string;
  _heat: number;
  [k: string]: unknown;
}

export interface HybridRankedItem extends RankedItem {
  _originalHeat: number;
}

/**
 * Hybrid rank: 0.6 * vector_similarity + 0.4 * BM25_normalized.
 * Re-ranks recall results using both vector and lexical signals.
 */
export function hybridRank(
  items: RankedItem[],
  query: string,
): HybridRankedItem[] {
  if (items.length <= 1) return items.map((i) => ({ ...i, _originalHeat: i._heat }));

  const bm25 = bm25Scores(query, items);

  const maxHeat = items.reduce((m, r) => Math.max(m, r._heat), 0);
  const normalizedItems = items.map((item, idx) => {
    const vectorScore = maxHeat > 0 ? item._heat / maxHeat : 0;
    const bm25Score = bm25.get(idx) ?? 0;
    const hybridScore = HYBRID_VECTOR_WEIGHT * vectorScore + HYBRID_BM25_WEIGHT * bm25Score;
    return { ...item, _heat: hybridScore, _originalHeat: item._heat };
  });

  normalizedItems.sort((a, b) => b._heat - a._heat);
  return normalizedItems;
}

// ---------------------------------------------------------------------------
// Topic Tokens & Overlap (used by dedup and topic-shift)
// ---------------------------------------------------------------------------

export function extractTopicTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return new Set(tokens.slice(0, 40));
}

export function topicOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) { if (b.has(token)) shared++; }
  return shared / Math.max(a.size, b.size);
}

// ---------------------------------------------------------------------------
// Cosine Dedup Filter
// ---------------------------------------------------------------------------

export const COSINE_DEDUP_THRESHOLD = 0.85;

/**
 * Cosine dedup filter — removes near-duplicate memories from recall results.
 * Uses Jaccard similarity on topic tokens as a client-side proxy for cosine distance.
 */
export function cosineDedupFilter<T extends { label: string }>(
  items: T[],
  limit: number,
): T[] {
  if (items.length <= 1) return items.slice(0, limit);

  const accepted: T[] = [];
  const acceptedTokens: Set<string>[] = [];

  for (const item of items) {
    if (accepted.length >= limit) break;

    const tokens = extractTopicTokens(item.label);
    let isDuplicate = false;

    for (const existing of acceptedTokens) {
      if (topicOverlap(tokens, existing) >= COSINE_DEDUP_THRESHOLD) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      accepted.push(item);
      acceptedTokens.push(tokens);
    }
  }

  return accepted;
}

// ---------------------------------------------------------------------------
// Credential Boost
// ---------------------------------------------------------------------------

export const CREDENTIAL_PATTERNS = /\b(api[_-]?key|token|pat|password|secret|credential|ssh[_-]?key|passphrase|auth[_-]?token|access[_-]?key|bearer)\b/i;
export const CREDENTIAL_SERVICE_PATTERNS = /\b(github|gh|gitlab|npm|docker|azure|aws|gcp|heroku|vercel|netlify|supabase|firebase|openai|anthropic|elevenlabs|tailscale|ssh|smtp|imap|redis|postgres|mysql|mongo|slack|discord|telegram|twilio|stripe|paypal|ko-?fi|patreon)\b/i;

export interface CredentialBoostItem extends RankedItem {
  memory_type?: string;
  pointer_summary?: string;
  is_pinned?: boolean;
  _credentialBoosted?: boolean;
}

/**
 * Boost credential-related memories in a recall result set.
 * Only activates when the query mentions a recognized service/tool name.
 */
export function boostCredentialMemories(
  results: CredentialBoostItem[],
  query: string,
): { results: CredentialBoostItem[]; boostedCount: number } {
  if (!CREDENTIAL_SERVICE_PATTERNS.test(query)) {
    return { results, boostedCount: 0 };
  }

  let boostedCount = 0;
  const out = results.map((r) => {
    const mtype = r.memory_type ?? "";
    const summary = r.label ?? r.pointer_summary ?? "";
    const pinned = !!(r.is_pinned ?? false);

    if ((mtype === "fact" || mtype === "preference") && CREDENTIAL_PATTERNS.test(summary)) {
      const boost = pinned ? 0.30 : 0.20;
      boostedCount++;
      return { ...r, _heat: r._heat + boost, _credentialBoosted: true };
    }
    return r;
  });

  return { results: out, boostedCount };
}

// ---------------------------------------------------------------------------
// Hebbian Strength Blending (MemPalace Phase 3 → Client)
// ---------------------------------------------------------------------------

/**
 * Weight applied to the hybrid score component in Hebbian blending.
 * Combined with HEBBIAN_STRENGTH_WEIGHT, these sum to 1.0.
 */
export const HEBBIAN_HYBRID_WEIGHT = 0.7;

/**
 * Weight applied to the normalized effective_strength component.
 * effective_strength ranges 0.05–5.0 on the server; we normalize by dividing by 5.0.
 */
export const HEBBIAN_STRENGTH_WEIGHT = 0.3;

/**
 * Maximum effective_strength value from the server (Hebbian potentiation ceiling).
 * Used to normalize strength into [0, 1] range for blending.
 */
export const HEBBIAN_STRENGTH_MAX = 5.0;

export interface HebbianBlendItem {
  _heat: number;
  effective_strength?: number | null;
  [k: string]: unknown;
}

/**
 * Blend Hebbian effective_strength into recall scores.
 *
 * When the server returns `effective_strength` (Hebbian potentiation × Ebbinghaus
 * decay), this makes recall prefer memories the agent actually uses repeatedly,
 * not just ones that are recent or textually similar.
 *
 * Formula: _heat = hybridScore × 0.7 + (effective_strength / 5.0) × 0.3
 *
 * Gated: only items with a numeric `effective_strength` are reblended.
 * Items without the field keep their original `_heat` unchanged.
 * If NO items have the field, the array is returned as-is (no sort change).
 *
 * Re-sorts by blended score descending.
 */
export function blendHebbianStrength<T extends HebbianBlendItem>(
  items: T[],
): T[] {
  // Check if any items have effective_strength — if not, skip entirely
  const hasAny = items.some(
    (i) => i.effective_strength != null && typeof i.effective_strength === "number",
  );
  if (!hasAny) return items;

  const blended = items.map((item) => {
    const eff = item.effective_strength;
    if (eff == null || typeof eff !== "number") {
      // No Hebbian data — keep original score; preserve _hybridHeat for inspect
      return { ...item, _hybridHeat: item._heat };
    }
    const normalizedStrength = Math.min(eff / HEBBIAN_STRENGTH_MAX, 1.0);
    const hybridHeat = item._heat; // pure BM25+vector score before Hebbian blend
    const newHeat =
      HEBBIAN_HYBRID_WEIGHT * hybridHeat +
      HEBBIAN_STRENGTH_WEIGHT * normalizedStrength;
    // _hybridHeat = pure BM25+vector score (Step 12 observability)
    return { ...item, _heat: newHeat, _hybridHeat: hybridHeat };
  });

  blended.sort((a, b) => b._heat - a._heat);
  return blended;
}

// ---------------------------------------------------------------------------
// BM25 Topic-Shift Detection
// ---------------------------------------------------------------------------

export const BM25_TOPIC_RELEVANCE_THRESHOLD = 0.20;

/**
 * Detect whether a new query represents a topic shift relative to cached results.
 * Uses BM25 scoring of cached labels against the new query.
 * Returns { shifted, relevance } where relevance is the max BM25 score.
 */
export function detectTopicShift(
  newQuery: string,
  cachedLabels: Array<{ label: string; [k: string]: unknown }>,
): { shifted: boolean; relevance: number } {
  if (cachedLabels.length === 0) {
    return { shifted: true, relevance: 0 };
  }

  const scores = bm25Scores(newQuery, cachedLabels);
  const relevance = Math.max(...Array.from(scores.values()), 0);
  return {
    shifted: relevance < BM25_TOPIC_RELEVANCE_THRESHOLD,
    relevance,
  };
}

// ---------------------------------------------------------------------------
// Staleness Detection (MemPalace Phase 3 refinement)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// -- Temporal query detection + chronological reranking ---------------------
// Detects whether a query is asking about events in time-order ("when did",
// "what happened yesterday", etc.) so recall results can be re-sorted
// chronologically instead of by relevance/heat.
// ---------------------------------------------------------------------------

export const TEMPORAL_KEYWORDS = [
  "yesterday", "today", "last week", "this week", "last month", "this month",
  "days ago", "hours ago", "weeks ago", "months ago",
  "last monday", "last tuesday", "last wednesday", "last thursday",
  "last friday", "last saturday", "last sunday",
  "recently", "timeline", "chronolog", "sequence of", "in order",
  "what order", "time order", "when did", "when was", "since when",
  "how long ago", "first thing", "before that", "after that",
];

/**
 * Returns true when the query is asking about events in chronological order.
 * Checked against a keyword list; false positives are low-cost (just re-sort).
 */
export function isTemporalQuery(query: string): boolean {
  const q = query.toLowerCase();
  return TEMPORAL_KEYWORDS.some((kw) => q.includes(kw));
}

/**
 * Parse an ISO 8601 date string to milliseconds since epoch.
 * Returns 0 on invalid/missing input (sorts to oldest).
 */
export function parseISOMs(iso: string | undefined): number {
  if (!iso) return 0;
  try { return new Date(iso).getTime(); } catch { return 0; }
}

/**
 * Re-sort recall results chronologically (oldest → newest) for temporal queries.
 * Falls back to original order if fewer than half the results have timestamps.
 * Returns a new array — does not mutate the input.
 */
export function temporalRerank<T extends { updated_at?: string; [k: string]: unknown }>(items: T[]): T[] {
  const withTimestamp = items.filter((r) => r.updated_at);
  // Only re-rank if at least half the results have timestamps; otherwise
  // chronological ordering would be meaningless (too many unknowns).
  if (withTimestamp.length < items.length / 2) return items;
  return [...items].sort((a, b) => {
    const aMs = parseISOMs(a.updated_at);
    const bMs = parseISOMs(b.updated_at);
    return aMs - bMs; // ascending = oldest first (chronological)
  });
}

// ---------------------------------------------------------------------------

export const STALE_HEAT_THRESHOLD = 0.10;
/**
 * Memories with effective_strength >= this value are exempted from stale labeling
 * even if their heat has decayed. Hebbian potentiation reflects real usage frequency;
 * a memory the agent looks up often (e.g. credential facts, core identity) should not
 * be marked stale just because it isn't "written" frequently.
 * Value 1.0 = 20% of max Hebbian ceiling (5.0) — conservative guard.
 */
export const STALE_STRENGTH_GUARD = 1.0;

/**
 * Returns true when a recall item should be flagged as stale in context XML.
 *
 * Stale = heat below threshold AND not protected by Hebbian strength.
 * Phase 3 refinement: if the server returns `effective_strength`, actively-used
 * memories (strength >= STALE_STRENGTH_GUARD) are exempted so the LLM doesn't
 * dismiss them as outdated when they're actually heavily reinforced.
 *
 * @param heat          - Current heat value (0.0–1.0). undefined/null → not stale.
 * @param effectiveStrength - Optional Hebbian effective_strength from server response.
 */
export function isStaleMemory(heat: number | undefined | null, effectiveStrength?: number | null): boolean {
  if (heat === undefined || heat === null) return false;
  if (heat >= STALE_HEAT_THRESHOLD) return false;
  // Heat is below threshold. Hebbian guard: if actively used, exempt from stale.
  if (effectiveStrength != null && effectiveStrength >= STALE_STRENGTH_GUARD) return false;
  return true;
}
