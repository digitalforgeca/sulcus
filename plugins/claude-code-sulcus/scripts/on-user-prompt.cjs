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
const { searchMemories, getConfig } = require('../lib/sulcus-client.cjs');

function formatRelativeTime(iso) {
  try {
    const dt = new Date(iso);
    const secs = (Date.now() - dt.getTime()) / 1000;
    if (secs < 1800) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
    return dt.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

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

  const items = relevant.map(r => {
    const heat = r.current_heat != null ? `[heat:${r.current_heat.toFixed(2)}]` : '';
    const type = r.memory_type ? `(${r.memory_type})` : '';
    const text = r.pointer_summary || r.label || r.content || '';
    return `- ${text.slice(0, 400)} ${heat} ${type}`.trim();
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
