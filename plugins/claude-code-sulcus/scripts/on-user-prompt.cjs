#!/usr/bin/env node
/**
 * Hook: UserPromptSubmit
 *
 * Fires on every user message. Two parallel paths:
 *
 * 1. **Recall** — searches Sulcus for relevant memories (vector + graph-hop)
 *    and injects them into Claude's context before processing.
 *
 * 2. **Auto-capture** — classifies the user's message via SIU v2 quality gate.
 *    If it passes, stores it as a typed memory. Fire-and-forget: doesn't block
 *    the recall path or add latency to the user experience.
 *
 * Skips very short prompts (< 20 chars) to avoid noise.
 */
'use strict';

const { readStdin, writeOutput } = require('../lib/stdin.cjs');
const { searchMemories, getGraphNeighbors, getConfig, classifyMemory, storeMemory, updateMemoryHeat, listMemoriesByType, recallLog } = require('../lib/sulcus-client.cjs');
const { isJunkContent, shouldCapture, isCorrectionMessage } = require('../lib/capture-utils.cjs');
const { checkTopicCache, updateTopicCache } = require('../lib/topic-cache.cjs');
const { diversityFilter } = require('../lib/diversity-filter.cjs');
const { guardRecallResults, refreshNegPrefCache } = require('../lib/guardrails.cjs');
const { recordTurn, recordRecallInjection, getThrottleLevel, CHARS_PER_TOKEN } = require('../lib/context-throttle.cjs');
const { isTemporalQuery, temporalRerank, markSuperseded } = require('../lib/temporal.cjs');

const MIN_STORE_CONFIDENCE = 0.5;

// Token budget for recall injection (configurable via SULCUS_RECALL_BUDGET env var)
// Default 4k tokens (~16k chars at ~4 chars/token). Prevents bloating Claude's context.
const BASE_RECALL_BUDGET_TOKENS = parseInt(process.env.SULCUS_RECALL_BUDGET || '4000', 10);

async function main() {
  const input = await readStdin();
  const prompt = input.prompt || '';
  const config = getConfig();

  // Skip trivial prompts — not worth a network call
  if (!config.apiKey || prompt.length < 20) {
    return; // exit 0, no output = pass through
  }

  // --- Context-window throttling ---
  // Track this turn and check if we should scale down recall.
  recordTurn(prompt.length);
  const throttle = getThrottleLevel();

  // If context is critically full, skip recall entirely
  if (throttle.level === 'silent') {
    return; // exit 0, no output — preserve context for actual work
  }

  // Scale recall budget based on throttle level
  const RECALL_BUDGET_TOKENS = Math.ceil(BASE_RECALL_BUDGET_TOKENS * throttle.budgetScale);

  // --- Auto-capture: fire-and-forget SIU classification + store ---
  // Runs in parallel with recall. Errors are silently swallowed.
  const capturePromise = autoCapture(prompt).catch(() => {});

  // --- Topic-shift caching ---
  // Check if the topic is stable (serve cached recall) or shifted (fresh API call).
  // File-based because Claude Code hooks run as separate processes.
  const cacheCheck = checkTopicCache(prompt);

  let relevant;
  if (cacheCheck.hit && cacheCheck.results?.length) {
    // Topic stable — use cached results, skip API call
    relevant = cacheCheck.results;
  } else {
    // Topic shifted or no cache — fresh recall
    const results = await searchMemories(prompt, 5);

    if (!results?.results?.length) {
      // Still wait for capture to finish before exiting
      await capturePromise;
      return; // No relevant memories
    }

    // Filter to reasonably relevant results (score threshold)
    relevant = results.results.filter(r =>
      r.score == null || r.score > 0.35
    );

    if (!relevant.length) {
      await capturePromise;
      return;
    }
  }

  // --- Graph-hop expansion ---
  // Seed top-2 vector results into graph neighbor lookup,
  // fold warm neighbors into results (mirroring OpenClaw plugin pattern).
  // Only run graph hops on fresh API calls — cached results already include them.
  let allResults = [...relevant];
  const skipGraphHops = cacheCheck.hit;
  try {
    if (skipGraphHops) throw null; // skip to catch block — use cached results as-is

    const seedIds = relevant.slice(0, 2)
      .map(r => r.id)
      .filter(Boolean);

    if (seedIds.length > 0) {
      const neighborFetches = await Promise.allSettled(
        seedIds.map(id => getGraphNeighbors(id, 6))
      );

      const seenIds = new Set(allResults.map(r => r.id).filter(Boolean));
      const graphExtras = [];

      for (const result of neighborFetches) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        // API may return { neighbors: [...] } or an array directly
        const neighbors = Array.isArray(result.value)
          ? result.value
          : (result.value.neighbors || []);
        for (const node of neighbors) {
          const nodeId = node.id;
          if (!nodeId || seenIds.has(nodeId)) continue;
          const heat = node.current_heat ?? 0;
          if (heat < 0.2) continue; // skip cold ephemeral noise
          seenIds.add(nodeId);
          graphExtras.push({ ...node, _source: 'graph' });
        }
      }

      if (graphExtras.length > 0) {
        // Sort by heat descending, take top 4
        graphExtras.sort((a, b) => (b.current_heat ?? 0) - (a.current_heat ?? 0));
        allResults = [...allResults, ...graphExtras.slice(0, 4)];
      }
    }
  } catch {
    // Graph expansion failed or skipped (cache hit) — use existing results
  }

  // --- Diversity filter ---
  // Remove near-duplicate results so the LLM sees diverse perspectives.
  allResults = diversityFilter(allResults, 0.6);

  // --- Temporal supersession ---
  // Detect overlapping memories where a newer one supersedes an older one.
  // Penalizes the older item's heat so it falls below the budget cut line.
  let supersededCount = 0;
  try {
    supersededCount = markSuperseded(allResults);
    if (supersededCount > 0) {
      // Re-sort by heat so superseded items fall to the bottom
      allResults.sort((a, b) => (b.current_heat ?? 0) - (a.current_heat ?? 0));
      process.stderr.write(`sulcus/temporal: ${supersededCount} superseded memory/memories penalized\n`);
    }
  } catch {
    // Supersession failure — fail-open
  }

  // --- Temporal re-ranking ---
  // Detect temporal queries and re-sort results chronologically.
  const temporalDetected = isTemporalQuery(prompt);

  // --- Guardrails: PII redaction + preference violation check ---
  // Scans recall results before injection. PII is redacted in-place so it never
  // reaches the LLM. Preference-violating memories are flagged but still included
  // (removal would lose context — the flag is informational).
  try {
    const negPrefs = await refreshNegPrefCache(listMemoriesByType);
    const guarded = guardRecallResults(allResults, { negPrefs });
    allResults = guarded.results;
    if (guarded.stats.piiRedacted > 0 || guarded.stats.piiBlocked > 0) {
      process.stderr.write(`sulcus/guardrails: PII redacted=${guarded.stats.piiRedacted} blocked=${guarded.stats.piiBlocked}\n`);
    }
    if (guarded.stats.prefFlagged > 0) {
      process.stderr.write(`sulcus/guardrails: ${guarded.stats.prefFlagged} result(s) flagged for preference conflict\n`);
    }
  } catch {
    // Guardrail failure — fail-open (don't block recall)
  }

  // --- Update topic cache (after graph hops + diversity filter + guardrails) ---
  // Store the full result set (vector + graph, deduplicated) so cache hits include graph results.
  if (!cacheCheck.hit && cacheCheck._tokens) {
    try { updateTopicCache(cacheCheck._tokens, allResults); } catch { /* best-effort */ }
  }

  // --- Temporal re-ranking (applied after guardrails, before budget) ---
  // For temporal queries, re-sort results chronologically so the LLM sees them
  // in time-order. This overrides the default heat-based ordering.
  if (temporalDetected) {
    allResults = temporalRerank(allResults);
    process.stderr.write(`sulcus/temporal: temporal query detected — results re-ranked chronologically\n`);
  }

  // --- Token budget enforcement ---
  // Greedy packing: include memories until budget is exhausted.
  const budgetChars = RECALL_BUDGET_TOKENS * CHARS_PER_TOKEN;
  let usedChars = 0;
  const items = [];

  for (const r of allResults) {
    const heat = r.current_heat != null ? `[heat:${r.current_heat.toFixed(2)}]` : '';
    const type = r.memory_type ? `(${r.memory_type})` : '';
    const src = r._source === 'graph' ? ' [graph]' : '';
    const text = r.pointer_summary || r.label || r.content || '';

    const supersededTag = r._superseded ? ' [superseded]' : '';
    const line = `- ${text.slice(0, 400)} ${heat} ${type}${src}${supersededTag}`.trim();

    if (usedChars + line.length > budgetChars && items.length > 0) {
      break; // budget exhausted (always include at least one item)
    }
    items.push(line);
    usedChars += line.length;
  }

  if (!items.length) return;

  // Record actual recall injection size for context tracking
  const injectionText = items.join('\n');
  try { recordRecallInjection(injectionText.length + 100); } catch { /* best-effort */ }

  // --- SIRU recall logging ---
  // Fire-and-forget: post recall metadata for server-side learning.
  // Tracks which memories were selected, their scores/sources, and budget usage.
  try {
    const packedResults = allResults.slice(0, items.length);
    const semanticCount = packedResults.filter(r => r._source !== 'graph').length;
    const graphCount = packedResults.filter(r => r._source === 'graph').length;
    recallLog({
      query_text: prompt,
      memory_ids: packedResults.map(r => r.id).filter(Boolean),
      memory_scores: packedResults.map(r => r.score ?? r.current_heat ?? 0),
      memory_sources: packedResults.map(r => r._source === 'graph' ? 'graph' : 'semantic'),
      token_budget: RECALL_BUDGET_TOKENS,
      tokens_used: Math.ceil(usedChars / CHARS_PER_TOKEN),
      candidates_total: allResults.length,
      candidates_selected: items.length,
      semantic_count: semanticCount,
      hot_count: 0, // hot nodes not separately tracked in this flow
      entity_count: graphCount,
      entity_hints: [],
    }).catch(() => {}); // fire-and-forget
  } catch {
    // SIRU logging failure — never block recall
  }

  // Add throttle notice when recall is reduced
  const throttleNotice = throttle.level !== 'normal'
    ? `\n\n_[Sulcus: ${throttle.reason}]_`
    : '';

  const orderAttr = temporalDetected ? ' order="chronological"' : '';
  const temporalHint = temporalDetected
    ? '\nResults are in chronological order (oldest first). Use this timeline to answer accurately.'
    : '';

  writeOutput({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `<sulcus-recall${orderAttr}>
## Relevant memories from Sulcus

${items.join('\n')}${temporalHint}

Use these memories naturally when relevant to the user's request.${throttleNotice}
</sulcus-recall>`,
    },
  });
}

/**
 * Auto-capture: classify user message via SIU v2 quality gate, store if worthy.
 * Includes correction detection with heat-boosting of related memories.
 */
async function autoCapture(text) {
  if (!text || text.length < 15) return; // too short to be meaningful
  if (isJunkContent(text)) return;
  if (!shouldCapture(text)) return; // dedup: seen recently

  // Classify via SIU v2
  const siuResult = await classifyMemory(text);
  if (!siuResult) return; // SIU unavailable

  const quality = siuResult.quality || 'store';
  const qualityConf = siuResult.quality_confidence ?? 0;

  // Quality gate: reject if SIU says don't store with sufficient confidence
  if (quality === 'reject' && qualityConf >= MIN_STORE_CONFIDENCE) {
    return; // SIU rejected — not worth storing
  }

  // If SIU says "store" but with very low confidence, still store (benefit of the doubt)
  const memoryType = siuResult.memory_type || 'episodic';

  const metadata = {
    type: 'user_capture',
    source: 'auto-capture-hook',
    siu_quality: quality,
    siu_quality_confidence: qualityConf,
    siu_memory_type: memoryType,
    siu_type_confidence: siuResult.type_confidence ?? 0,
    siu_model: siuResult.model_version || 'unknown',
    siu_engine: siuResult.engine || 'unknown',
  };

  await storeMemory(text, memoryType, metadata);

  // Correction detection: boost related memories when user corrects something
  if (isCorrectionMessage(text)) {
    try {
      const related = await searchMemories(text, 3);
      if (related?.results?.length) {
        await Promise.allSettled(
          related.results.map(node => {
            if (!node.id) return Promise.resolve();
            return updateMemoryHeat(node.id, 0.85);
          })
        );
      }
    } catch {
      // best-effort — correction boost is nice-to-have
    }
  }
}

main().catch(() => {
  // Silent failure — never block the user's prompt
});
