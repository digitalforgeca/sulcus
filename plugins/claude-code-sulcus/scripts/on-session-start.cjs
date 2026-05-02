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
const { searchMemories, getHotNodes, getStatus, getConfig } = require('../lib/sulcus-client.cjs');
const path = require('node:path');

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
  const source = input.source || 'startup';
  const cwd = input.cwd || process.cwd();
  const projectName = path.basename(cwd);
  const config = getConfig();

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
    // Parallel fetch: project context + hot nodes + status
    const [projectResults, hotNodes, status] = await Promise.all([
      searchMemories(`${projectName} project context architecture decisions patterns`, 8)
        .catch(() => null),
      getHotNodes(5).catch(() => null),
      getStatus().catch(() => null),
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
