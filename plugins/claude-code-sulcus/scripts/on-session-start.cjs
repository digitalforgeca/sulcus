#!/usr/bin/env node
/**
 * Hook: SessionStart (matcher: startup|resume|compact)
 *
 * Bootstraps Sulcus context at the start of every Claude Code session.
 * - On startup: searches for relevant project context + hot nodes
 * - On resume: refreshes relevant memories
 * - On compact: recovers session state from Sulcus
 *
 * Output: JSON with hookSpecificOutput.additionalContext injected into Claude's context.
 */
'use strict';

const { readStdin, writeOutput } = require('../lib/stdin.cjs');
const { searchMemories, getHotNodes, getStatus, getConfig, listMemoriesByType } = require('../lib/sulcus-client.cjs');
const { clearTopicCache } = require('../lib/topic-cache.cjs');
const { extractNegativePrefs, saveNegPrefCache, getGuardrailConfig } = require('../lib/guardrails.cjs');
const { resetOnSessionStart } = require('../lib/context-throttle.cjs');
const path = require('node:path');

async function main() {
  const input = await readStdin();
  const source = input.source || 'startup';
  const cwd = input.cwd || process.cwd();
  const projectName = path.basename(cwd);
  const config = getConfig();

  // Clear topic cache on session start — fresh session = fresh topic context.
  // This ensures stale cached recall results don't bleed across sessions.
  try { clearTopicCache(); } catch { /* best-effort */ }

  // Reset context-window throttle state — fresh session = fresh context budget.
  try { resetOnSessionStart(); } catch { /* best-effort */ }

  if (!config.apiKey) {
    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `<sulcus-status>
Sulcus API key not configured.
Set SULCUS_API_KEY and SULCUS_SERVER_URL environment variables.
Get your key at https://sulcus.ca
</sulcus-status>`,
      },
    });
    return;
  }

  const sections = [];
  const errors = [];

  if (source === 'startup') {
    // Parallel fetch: project context + hot nodes + status + profile (preferences + facts)
    const [projectResults, hotNodes, status, preferences, facts] = await Promise.all([
      searchMemories(`${projectName} project context architecture decisions patterns`, 8)
        .catch(() => null),
      getHotNodes(5).catch(() => null),
      getStatus().catch(() => null),
      listMemoriesByType('preference', 10).catch(() => null),
      listMemoriesByType('fact', 10).catch(() => null),
    ]);

    if (status) {
      const ns = status.stats?.namespace_memories || 'unknown';
      const total = status.stats?.tenant_total_memories || 'unknown';
      sections.push(`### Sulcus Status\n- Namespace memories: ${ns} | Total: ${total} | Namespace: ${status.namespace || config.namespace} | Version: ${status.version || 'unknown'}`);
    }

    if (projectResults?.results?.length) {
      const items = projectResults.results.map(r => {
        const heat = r.current_heat != null ? ` [heat: ${r.current_heat.toFixed(2)}]` : '';
        const type = r.memory_type ? ` (${r.memory_type})` : '';
        const text = r.pointer_summary || r.label || r.content || '';
        return `- ${text.slice(0, 300)}${heat}${type}`;
      });
      sections.push(`### Project Context\n${items.join('\n')}`);
    }

    if (Array.isArray(hotNodes) && hotNodes.length) {
      const items = hotNodes.map(n => {
        const heat = n.current_heat != null ? ` [heat: ${n.current_heat.toFixed(2)}]` : '';
        const type = n.memory_type ? ` (${n.memory_type})` : '';
        const text = n.pointer_summary || n.label || n.content || '';
        return `- ${text.slice(0, 200)}${heat}${type}`;
      });
      sections.push(`### Hot Memories (most active)\n${items.join('\n')}`);
    }

    // --- Profile injection: preferences + facts ---
    const profileItems = [];

    const prefNodes = preferences?.nodes || preferences?.results || (Array.isArray(preferences) ? preferences : []);
    if (prefNodes.length) {
      profileItems.push('**Preferences:**');
      for (const p of prefNodes) {
        const text = p.pointer_summary || p.label || p.content || '';
        if (text) profileItems.push(`- ${text.slice(0, 300)}`);
      }
    }

    const factNodes = facts?.nodes || facts?.results || (Array.isArray(facts) ? facts : []);
    if (factNodes.length) {
      if (profileItems.length) profileItems.push('');
      profileItems.push('**Known Facts:**');
      for (const f of factNodes) {
        const text = f.pointer_summary || f.label || f.content || '';
        if (text) profileItems.push(`- ${text.slice(0, 300)}`);
      }
    }

    if (profileItems.length) {
      sections.push(`### User Profile\n${profileItems.join('\n')}`);
    }

    // --- Warm the negative preference cache for guardrails ---
    // Extract negative-signal preferences ("avoid X", "never do Y") from the
    // preferences already fetched above. Cache to disk so on-user-prompt.cjs
    // can check recall results against them without an extra API call.
    try {
      const guardConfig = getGuardrailConfig();
      if (guardConfig.prefCheck.enabled && prefNodes.length) {
        const negPrefs = extractNegativePrefs(prefNodes);
        saveNegPrefCache(negPrefs);
      }
    } catch { /* best-effort — guardrails are non-blocking */ }

  } else if (source === 'resume') {
    const results = await searchMemories(`${projectName} current task in progress`, 5).catch(() => null);

    if (results?.results?.length) {
      const items = results.results.map(r =>
        `- ${(r.pointer_summary || r.label || '').slice(0, 300)}`
      );
      sections.push(`### Recent Context (resumed session)\n${items.join('\n')}`);
    }

  } else if (source === 'compact') {
    // Post-compaction: recover session state
    const results = await searchMemories('session state pre-compaction current task in progress', 5).catch(() => null);

    if (results?.results?.length) {
      const items = results.results.map(r =>
        `- ${(r.pointer_summary || r.label || '').slice(0, 500)}`
      );
      sections.push(`### Recovered Context (post-compaction)\n${items.join('\n')}`);
    }
  }

  if (sections.length === 0 && errors.length === 0) {
    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `<sulcus-context>
Connected to Sulcus (${config.serverUrl}).
No previous memories found for project "${projectName}".
Memories will be captured as you work — decisions, patterns, and learnings persist across sessions.

Use the Sulcus MCP tools for manual memory operations:
- search_memory: Find relevant past context
- record_memory: Store important decisions or learnings
- memory_boost/memory_deprecate: Adjust memory importance
- create_trigger: Set up reactive rules on memory events
</sulcus-context>`,
      },
    });
    return;
  }

  const errorNotice = errors.length
    ? `<sulcus-status>\n${errors.join('\n')}\n</sulcus-status>\n`
    : '';

  const contextBody = sections.join('\n\n');
  const disclaimer = "Use these memories naturally when relevant. Don't force them into every response.";

  writeOutput({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `${errorNotice}<sulcus-context>
The following is recalled context from Sulcus persistent memory. Reference it only when relevant.

${contextBody}

${disclaimer}
</sulcus-context>`,
    },
  });
}

main().catch((err) => {
  console.error(`Sulcus SessionStart error: ${err.message}`);
  writeOutput({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `<sulcus-status>Failed to load memories: ${err.message}</sulcus-status>`,
    },
  });
});
