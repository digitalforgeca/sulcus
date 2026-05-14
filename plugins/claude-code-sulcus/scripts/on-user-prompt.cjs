#!/usr/bin/env node
/**
 * Hook: UserPromptSubmit
 *
 * Fires on every user message. Searches Sulcus for relevant memories
 * and injects them into Claude's context before processing.
 *
 * Skips very short prompts (< 20 chars) to avoid noise.
 * Uses a 3s timeout to minimize latency impact.
 */
'use strict';

const { readStdin, writeOutput } = require('../lib/stdin.cjs');
const { searchMemories, getGraphNeighbors, getConfig } = require('../lib/sulcus-client.cjs');

async function main() {
  const input = await readStdin();
  const prompt = input.prompt || '';
  const config = getConfig();

  // Skip trivial prompts — not worth a network call
  if (!config.apiKey || prompt.length < 20) {
    return; // exit 0, no output = pass through
  }

  const results = await searchMemories(prompt, 5);

  if (!results?.results?.length) {
    return; // No relevant memories
  }

  // Filter to reasonably relevant results (score threshold)
  const relevant = results.results.filter(r =>
    r.score == null || r.score > 0.35
  );

  if (!relevant.length) return;

  // --- Graph-hop expansion ---
  // Seed top-2 vector results into graph neighbor lookup,
  // fold warm neighbors into results (mirroring OpenClaw plugin pattern).
  let allResults = [...relevant];
  try {
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
    // Graph expansion failed — fall back to vector results only
  }

  const items = allResults.map(r => {
    const heat = r.current_heat != null ? `[heat:${r.current_heat.toFixed(2)}]` : '';
    const type = r.memory_type ? `(${r.memory_type})` : '';
    const src = r._source === 'graph' ? ' [graph]' : '';
    const text = r.pointer_summary || r.label || r.content || '';
    return `- ${text.slice(0, 400)} ${heat} ${type}${src}`.trim();
  });

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

main().catch(() => {
  // Silent failure — never block the user's prompt
});
