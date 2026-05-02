#!/usr/bin/env node
/**
 * Hook: Stop
 *
 * Fires when Claude finishes responding.
 * - Reminds Claude to store unsaved learnings via MCP
 * - Captures transcript signal content directly as safety net
 *
 * Checks stop_hook_active to avoid infinite loops.
 */
'use strict';

const { readStdin, writeOutput } = require('../lib/stdin.cjs');
const { storeMemory, getConfig } = require('../lib/sulcus-client.cjs');
const { extractSignalContent } = require('../lib/transcript.cjs');

async function main() {
  const input = await readStdin();

  // Prevent infinite loops
  if (input.stop_hook_active === true) {
    return; // exit 0, no output
  }

  const transcriptPath = input.transcript_path || '';
  const sessionId = input.session_id || 'unknown';
  const config = getConfig();

  // Background: capture signal content directly
  if (config.apiKey && transcriptPath) {
    try {
      const signalContent = extractSignalContent(transcriptPath, sessionId);
      if (signalContent && signalContent.length > 100) {
        // Store signal turns as episodic memory
        await storeMemory(
          `## Session Signal Extract\n\n${signalContent}`,
          'episodic',
          {
            type: 'session_signal',
            source: 'stop-hook',
            session_id: sessionId,
            cwd: input.cwd || process.cwd(),
          }
        );
      }
    } catch {
      // Silent — don't interfere with session end
    }
  }

  // Inject prompt for Claude to store learnings via MCP
  writeOutput({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: `Before finishing, check if there are important learnings from this interaction that should be persisted using the Sulcus MCP \`record_memory\` tool:

1. Were any significant **decisions** made? → memory_type "fact"
2. Were any new **patterns or strategies** discovered? → memory_type "procedural"
3. Did any approach **fail**? → memory_type "episodic" (anti-pattern)
4. Did you learn anything about the user's **preferences**? → memory_type "preference"
5. Were there **environment/setup** discoveries? → memory_type "fact"

Memories should be detailed and searchable — include full context, reasoning, code snippets, file paths. Longer memories are more valuable than vague one-liners.

If nothing notable happened in this interaction, it's fine to skip. Only store genuinely useful learnings.`,
    },
  });
}

main().catch((err) => {
  console.error(`Sulcus Stop error: ${err.message}`);
});
