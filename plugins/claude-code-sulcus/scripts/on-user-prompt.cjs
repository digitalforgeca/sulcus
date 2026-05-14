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
const { searchMemories, getGraphNeighbors, getConfig, classifyMemory, storeMemory, updateMemoryHeat } = require('../lib/sulcus-client.cjs');
const { isJunkContent, shouldCapture, isCorrectionMessage } = require('../lib/capture-utils.cjs');
const { checkTopicCache, updateTopicCache } = require('../lib/topic-cache.cjs');

const MIN_STORE_CONFIDENCE = 0.5;

// Token budget for recall injection (configurable via SULCUS_RECALL_BUDGET env var)
// Default 4k tokens (~16k chars at ~4 chars/token). Prevents bloating Claude's context.
const RECALL_BUDGET_TOKENS = parseInt(process.env.SULCUS_RECALL_BUDGET || '4000', 10);
const CHARS_PER_TOKEN = 4; // rough heuristic

async function main() {
  const input = await readStdin();
  const prompt = input.prompt || '';
  const config = getConfig();

  // Skip trivial prompts — not worth a network call
  if (!config.apiKey || prompt.length < 20) {
    return; // exit 0, no output = pass through
  }

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

  // --- Update topic cache (after graph hops) ---
  // Store the full result set (vector + graph) so cache hits include graph results.
  if (!cacheCheck.hit && cacheCheck._tokens) {
    try { updateTopicCache(cacheCheck._tokens, allResults); } catch { /* best-effort */ }
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
    const line = `- ${text.slice(0, 400)} ${heat} ${type}${src}`.trim();

    if (usedChars + line.length > budgetChars && items.length > 0) {
      break; // budget exhausted (always include at least one item)
    }
    items.push(line);
    usedChars += line.length;
  }

  if (!items.length) return;

  writeOutput({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `<sulcus-recall>
## Relevant memories from Sulcus

${items.join('\n')}

Use these memories naturally when relevant to the user's request.
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
