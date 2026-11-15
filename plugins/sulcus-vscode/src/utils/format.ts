/**
 * Utility functions enforcing strict UI presentation constraints:
 * - No emoji icons
 * - No shield or brain icons
 * - Buttons use exactly 1 word and 1 icon
 * - Headers, subheaders, options, and labels limited to 3 words with no punctuation and no special characters
 */

export function sanitizeThreeWords(input?: string, fallback: string = 'Sulcus Memory Node'): string {
  if (!input) return fallback;
  // Remove all non-alphanumeric and non-space characters
  const clean = input.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean).slice(0, 3);
  return words.join(' ') || fallback;
}

export function formatButton(codicon: string, words: string): string {
  const cleanWords = words.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
  return `$(${codicon}) ${cleanWords}`;
}

export function cleanMemoryLabel(label?: string, summary?: string): string {
  let text = (label || '').trim();

  // If label is trivial (e.g., "Synthesis: oo", "Synthesis: default", or short) and summary exists, use summary
  const lower = text.toLowerCase();
  if ((lower.startsWith('synthesis:') && text.length < 25) || !text) {
    if (summary && summary.trim()) {
      text = summary.trim();
    }
  }

  // Strip type prefixes at start of text (case-insensitive)
  text = text.replace(/^(synthesis|fact|procedural|preference|semantic|episodic|core(\s*identity)?)\s*:\s*/i, '').trim();

  // If stripped text resulted in just a namespace word ("oo", "default", "sulcus") or < 4 chars, fallback to summary
  const lowerAfter = text.toLowerCase();
  if ((lowerAfter === 'oo' || lowerAfter === 'default' || lowerAfter === 'sulcus' || text.length < 4) && summary && summary.trim()) {
    let cleanSummary = summary.trim().replace(/^(synthesis|fact|procedural|preference|semantic|episodic|core(\s*identity)?)\s*:\s*/i, '').trim();
    if (cleanSummary) {
      text = cleanSummary;
    }
  }

  return text || label || summary || 'Memory Content';
}
