/**
 * Guardrails for Sulcus Claude Code plugin.
 *
 * Two protection layers:
 * 1. **PII Scanner** — regex-based detection and redaction of personally
 *    identifiable information in recall output (memories injected into context).
 * 2. **Preference Violation Checker** — detects recall content that conflicts
 *    with stored negative preferences (e.g., "never recommend X").
 *
 * Architecture note: Claude Code doesn't expose `llm_output` or `message_sending`
 * hooks like OpenClaw, so we can't intercept outgoing messages. Instead, we
 * guard the **recall path** — scanning and redacting memories before they're
 * injected into Claude's context. This is actually stronger: PII never reaches
 * the LLM, so it can't be echoed or paraphrased back.
 *
 * Configuration via environment variables:
 *   SULCUS_GUARDRAILS_PII=true|false       (default: true)
 *   SULCUS_GUARDRAILS_PII_ACTION=redact|block  (default: redact)
 *   SULCUS_GUARDRAILS_PREF_CHECK=true|false (default: true)
 *   SULCUS_GUARDRAILS_FAIL_MODE=open|closed (default: open)
 *
 * File persistence (shared across hook invocations):
 *   ~/.sulcus-claude/neg-pref-cache.json  — cached negative preferences
 *   ~/.sulcus-claude/redaction-log.json   — reversible redaction keys
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATE_DIR = path.join(os.homedir(), '.sulcus-claude');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getGuardrailConfig() {
  return {
    pii: {
      enabled: (process.env.SULCUS_GUARDRAILS_PII || 'true') === 'true',
      action: process.env.SULCUS_GUARDRAILS_PII_ACTION || 'redact', // 'redact' or 'block'
      reversible: true, // always store redaction keys for recovery
    },
    prefCheck: {
      enabled: (process.env.SULCUS_GUARDRAILS_PREF_CHECK || 'true') === 'true',
      cacheTtlMs: 5 * 60 * 1000, // 5 minutes
    },
    failMode: process.env.SULCUS_GUARDRAILS_FAIL_MODE || 'open', // 'open' or 'closed'
  };
}

// ---------------------------------------------------------------------------
// PII Patterns (GDPR-neutral, same set as OpenClaw plugin)
// ---------------------------------------------------------------------------

const PII_PATTERNS = [
  {
    name: 'email',
    regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[EMAIL_REDACTED]',
  },
  {
    name: 'phone',
    regex: /(?:\+?\d[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4}\b/g,
    replacement: '[PHONE_REDACTED]',
  },
  {
    name: 'ssn',
    regex: /\b\d{3}[\s\-]\d{2}[\s\-]\d{4}\b/g,
    replacement: '[SSN_REDACTED]',
  },
  {
    name: 'credit_card',
    regex: /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|6011\d{12}|3(?:0[0-5]|[68]\d)\d{11})\b/g,
    replacement: '[CARD_REDACTED]',
  },
  {
    name: 'ip_address',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[IP_REDACTED]',
  },
  {
    name: 'api_key',
    // OpenAI (sk-), GitHub (ghp_/gho_/ghs_/ghr_), Slack (xoxb-/xoxp-/xoxa-),
    // AWS (AKIA), Stripe (sk_live_/pk_live_/sk_test_/rk_live_), Anthropic (sk-ant-)
    regex: /\b(sk-[a-zA-Z0-9]{20,}|sk-ant-[a-zA-Z0-9\-]{20,}|gh[pors]_[A-Za-z0-9]{36,}|xox[bpa]-[A-Za-z0-9\-]+|AKIA[A-Z0-9]{16}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,})\b/g,
    replacement: '[KEY_REDACTED]',
  },
];

// ---------------------------------------------------------------------------
// PII Scanning
// ---------------------------------------------------------------------------

/**
 * Scan text for PII patterns. Returns an array of detected spans.
 * Each span: { start, end, type, original, redactionId }
 */
function scanPii(text) {
  const spans = [];
  for (const pattern of PII_PATTERNS) {
    // Clone regex to reset lastIndex
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      const redactionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        type: pattern.name,
        original: match[0],
        replacement: pattern.replacement,
        redactionId,
      });
    }
  }
  // Sort by position for left-to-right replacement
  spans.sort((a, b) => a.start - b.start);

  // Remove overlapping spans (keep the first/longest match at each position)
  const deduped = [];
  let lastEnd = -1;
  for (const span of spans) {
    if (span.start >= lastEnd) {
      deduped.push(span);
      lastEnd = span.end;
    }
  }
  return deduped;
}

/**
 * Redact PII spans from text. Returns the redacted string.
 * Non-overlapping assumption (sorted by start).
 */
function redactText(text, spans) {
  if (!spans.length) return text;
  let result = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      result += text.slice(cursor, span.start);
    }
    result += span.replacement;
    cursor = span.end;
  }
  result += text.slice(cursor);
  return result;
}

// ---------------------------------------------------------------------------
// Reversible Redaction Storage
// ---------------------------------------------------------------------------

const REDACTION_LOG_FILE = path.join(STATE_DIR, 'redaction-log.json');

function storeRedactionKeys(spans) {
  if (!spans.length) return;
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    let store = { version: 1, entries: {} };
    if (fs.existsSync(REDACTION_LOG_FILE)) {
      try {
        store = JSON.parse(fs.readFileSync(REDACTION_LOG_FILE, 'utf-8'));
      } catch { store = { version: 1, entries: {} }; }
    }
    for (const span of spans) {
      store.entries[span.redactionId] = {
        original: span.original,
        type: span.type,
        redactedAt: new Date().toISOString(),
      };
    }
    fs.writeFileSync(REDACTION_LOG_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch {
    // Best effort — never break the hook
  }
}

// ---------------------------------------------------------------------------
// Negative Preference Cache
// ---------------------------------------------------------------------------

const NEG_PREF_CACHE_FILE = path.join(STATE_DIR, 'neg-pref-cache.json');

/**
 * Load cached negative preferences. Returns { prefs: string[], cachedAt: number } or null.
 * Prefs are lowercased content strings from preference-type memories that contain
 * negative signals (dislike, avoid, never, don't, hate, stop, no more).
 */
function loadNegPrefCache(ttlMs) {
  try {
    if (!fs.existsSync(NEG_PREF_CACHE_FILE)) return null;
    const cache = JSON.parse(fs.readFileSync(NEG_PREF_CACHE_FILE, 'utf-8'));
    if (!cache.prefs || !cache.cachedAt) return null;
    if (Date.now() - cache.cachedAt > ttlMs) return null; // expired
    return cache;
  } catch {
    return null;
  }
}

/**
 * Save negative preferences to cache.
 */
function saveNegPrefCache(prefs) {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(NEG_PREF_CACHE_FILE, JSON.stringify({
      prefs,
      cachedAt: Date.now(),
    }), { mode: 0o600 });
  } catch {
    // best-effort
  }
}

// Negative-signal keywords for filtering preference memories
const NEGATIVE_SIGNALS = [
  'dislike', 'avoid', 'never', "don't", 'dont', 'hate', 'stop',
  'no more', 'not a fan', 'prefer not', "won't", 'wont', 'refuse',
  'reject', 'against', 'allergic', 'intolerant',
];

// Stop words for keyword extraction (shared with pref violation check)
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
  'not', 'so', 'if', 'then', 'that', 'this', 'it', 'its', 'i', 'me',
  'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them',
  'user', 'agent', 'use', 'using',
]);

/**
 * Extract meaningful keywords from text (lowercased, stop-filtered).
 */
function extractKeywords(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

// Meta-words that commonly appear in preferences but aren't the subject entity.
// These get skipped when extracting the subject from a negative preference.
const SUBJECT_SKIP_WORDS = new Set([
  'recommend', 'suggest', 'want', 'like', 'think', 'prefer', 'need',
  'dooley', 'user', 'agent', 'always', 'ever', 'really', 'much',
  'too', 'very', 'just', 'make', 'put', 'get', 'set',
]);

/**
 * Given a list of preference memories, extract those with negative signals.
 * Returns objects with { text, keywords, subject } for efficient matching.
 *
 * The `subject` is the primary entity the preference is about — the first
 * domain-specific keyword after stripping negative signals, stop words, and
 * meta-words (like "recommend", "user", agent names).
 * For "Never recommend MongoDB for transactional workloads", subject = "mongodb".
 * When checking memories, the subject keyword MUST be present for a violation.
 */
function extractNegativePrefs(prefNodes) {
  const negPrefs = [];
  for (const node of prefNodes) {
    const text = (node.pointer_summary || node.label || node.content || '').toLowerCase();
    if (!text) continue;
    const isNeg = NEGATIVE_SIGNALS.some(sig => text.includes(sig));
    if (isNeg) {
      // Extract subject keywords (strip the negative signal itself to get the topic)
      let subjectText = text;
      for (const sig of NEGATIVE_SIGNALS) {
        subjectText = subjectText.replace(sig, '');
      }
      const keywords = extractKeywords(subjectText);
      if (keywords.length > 0) {
        // Subject is the first keyword that isn't a meta/filler word.
        // Falls back to first keyword if all are meta-words.
        const subject = keywords.find(k => !SUBJECT_SKIP_WORDS.has(k)) || keywords[0];
        negPrefs.push({ text, keywords, subject });
      }
    }
  }
  return negPrefs;
}

// ---------------------------------------------------------------------------
// High-Level Guard Functions
// ---------------------------------------------------------------------------

/**
 * Scan and guard recall results before injection into Claude's context.
 *
 * For each memory in `results`:
 * 1. PII scan → redact or block
 * 2. Preference violation check → flag or remove
 *
 * Returns: { results: guardedResults[], stats: { piiRedacted, piiBlocked, prefFlagged } }
 *
 * @param {Array} results - Memory objects with text in pointer_summary/label/content
 * @param {Object} options - { negPrefs: string[] | null } — cached negative prefs
 */
function guardRecallResults(results, options = {}) {
  const config = getGuardrailConfig();
  const stats = { piiRedacted: 0, piiBlocked: 0, prefFlagged: 0 };
  const negPrefs = options.negPrefs || null;

  if (!results?.length) {
    return { results: results || [], stats };
  }

  const guarded = [];
  for (const item of results) {
    const textKey = item.pointer_summary ? 'pointer_summary' :
                    item.label ? 'label' :
                    item.content ? 'content' : null;
    if (!textKey) {
      guarded.push(item); // no text to guard
      continue;
    }
    const text = item[textKey] || '';

    let guardedItem = { ...item };
    let blocked = false;

    // --- PII Guard ---
    if (config.pii.enabled) {
      const spans = scanPii(text);
      if (spans.length > 0) {
        if (config.pii.action === 'block') {
          stats.piiBlocked++;
          blocked = true; // remove this memory entirely
        } else {
          // Redact
          if (config.pii.reversible) {
            storeRedactionKeys(spans);
          }
          guardedItem[textKey] = redactText(text, spans);
          guardedItem._piiRedacted = true;
          stats.piiRedacted++;
        }
      }
    }

    // --- Preference Violation Check ---
    // Uses keyword overlap with subject-entity awareness. A memory is flagged if:
    // 1. The preference's subject keyword is present in the memory, AND
    // 2. At least one additional context keyword overlaps (total overlap >= 2)
    // This catches "MongoDB is great for transactional data" against
    // "Never recommend MongoDB for transactional workloads" (subject=mongodb)
    // but won't flag "Use PostgreSQL for transactional workloads" (no mongodb).
    if (!blocked && config.prefCheck.enabled && negPrefs?.length) {
      const memoryKeywords = new Set(extractKeywords(text));
      if (memoryKeywords.size > 0) {
        for (const pref of negPrefs) {
          if (!pref.keywords?.length) continue;
          // Subject must be present
          if (pref.subject && !memoryKeywords.has(pref.subject)) continue;
          const overlap = pref.keywords.filter(k => memoryKeywords.has(k)).length;
          // Require subject + at least 1 more context keyword
          if (overlap >= 2) {
            guardedItem._prefViolation = pref.text;
            stats.prefFlagged++;
            break;
          }
        }
      }
    }

    if (!blocked) {
      guarded.push(guardedItem);
    }
  }

  return { results: guarded, stats };
}

/**
 * Fetch and cache negative preferences for preference violation checking.
 * Uses the Sulcus client's listMemoriesByType to fetch preference-type memories,
 * extracts those with negative signals, and caches them to disk.
 *
 * @param {Function} listMemoriesByType - Client function (memoryType, limit) => Promise
 * @returns {Promise<string[]>} - Array of lowercased negative preference strings
 */
async function refreshNegPrefCache(listMemoriesByType) {
  const config = getGuardrailConfig();
  if (!config.prefCheck.enabled) return [];

  // Check cache first
  const cached = loadNegPrefCache(config.prefCheck.cacheTtlMs);
  if (cached) return cached.prefs;

  // Fetch fresh preferences
  try {
    const response = await listMemoriesByType('preference', 20);
    const nodes = response?.nodes || response?.results || (Array.isArray(response) ? response : []);
    const negPrefs = extractNegativePrefs(nodes);
    saveNegPrefCache(negPrefs);
    return negPrefs;
  } catch {
    return []; // fetch failed — no pref checking this time
  }
}

module.exports = {
  getGuardrailConfig,
  scanPii,
  redactText,
  storeRedactionKeys,
  loadNegPrefCache,
  saveNegPrefCache,
  extractNegativePrefs,
  guardRecallResults,
  refreshNegPrefCache,
  PII_PATTERNS,
  NEGATIVE_SIGNALS,
};
