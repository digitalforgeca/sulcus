#!/usr/bin/env node
/**
 * Hook: PreCompact
 *
 * Fires BEFORE context compaction. This is the last chance to capture
 * the full conversation before it gets compressed.
 *
 * Two-pronged approach:
 * 1. Injects instructions telling Claude to store a session summary via MCP
 * 2. Directly captures transcript state to Sulcus as a safety net
 */
'use strict';

const { readStdin, writeOutput } = require('../lib/stdin.cjs');
const { storeMemory, getConfig } = require('../lib/sulcus-client.cjs');
const { extractSessionState, buildSessionSummary } = require('../lib/transcript.cjs');
const { resetOnCompact } = require('../lib/context-throttle.cjs');

async function main() {
  const input = await readStdin();
  const transcriptPath = input.transcript_path || '';
  const config = getConfig();

  // Reset context-window throttle estimates — compaction frees most of the context.
  try { resetOnCompact(); } catch { /* best-effort */ }

  // Safety net: capture transcript state directly via REST API
  if (config.apiKey && transcriptPath) {
    try {
      const state = extractSessionState(transcriptPath);
      if (state.userMessages.length || state.filesModified.length) {
        const summary = buildSessionSummary(state, 'pre-compaction');
        await storeMemory(summary, 'episodic', {
          type: 'session_state',
          source: 'pre-compaction',
          cwd: input.cwd || process.cwd(),
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // Don't let safety net failure block the hook
    }
  }

  // Inject instructions for Claude to also store via MCP (richer, since Claude has full context)
  writeOutput({
    hookSpecificOutput: {
      hookEventName: 'PreCompact',
      additionalContext: `## CRITICAL: Pre-Compaction — Save Session State to Sulcus

Context compaction is about to happen. You will lose most of your conversation history.

**You MUST store a comprehensive session summary NOW using the Sulcus MCP \`record_memory\` tool.**

### What to store (call record_memory with memory_type "episodic"):

\`\`\`
## Session Summary (Pre-Compaction)

### User's Goal
[What the user originally asked for and their intent]

### What Was Accomplished
[Numbered list of tasks completed, features built, bugs fixed]

### Key Decisions Made
[Architectural choices, design decisions, trade-offs discussed]

### Files Created or Modified
[List of important file paths with what changed in each]

### Current State
[What is in progress RIGHT NOW — the task you were in the middle of]
[Any pending items, blockers, or next steps]

### Important Context
[User preferences observed, coding patterns, anything that helps
the post-compaction agent continue without asking redundant questions]
\`\`\`

### Also store any unstored learnings as separate memories:
- Failed approaches → memory_type "episodic"
- Successful strategies → memory_type "procedural"
- Architecture decisions → memory_type "fact"
- User preferences → memory_type "preference"

**Do this NOW. The quality of this summary determines whether you can continue the user's task after compaction.**`,
    },
  });
}

main().catch((err) => {
  console.error(`Sulcus PreCompact error: ${err.message}`);
});
