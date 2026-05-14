#!/usr/bin/env node
/**
 * Hook: Stop
 *
 * Fires when Claude finishes responding.
 * - Captures transcript signal content directly via SIU v2 quality gate
 * - Captures assistant output (last response) if high-signal
 * - Reminds Claude to store unsaved learnings via MCP
 *
 * Checks stop_hook_active to avoid infinite loops.
 */
'use strict';

const { readStdin, writeOutput } = require('../lib/stdin.cjs');
const { storeMemory, getConfig, classifyMemory, purgeSessionMemories } = require('../lib/sulcus-client.cjs');
const { extractSignalContent, extractSessionState } = require('../lib/transcript.cjs');
const { isJunkContent, shouldCapture, isGenericAck, summarizeForCapture, ASSISTANT_CAPTURE_MAX_DIRECT } = require('../lib/capture-utils.cjs');

async function main() {
  const input = await readStdin();

  // Prevent infinite loops
  if (input.stop_hook_active === true) {
    return; // exit 0, no output
  }

  const transcriptPath = input.transcript_path || '';
  const sessionId = input.session_id || 'unknown';
  const config = getConfig();

  // Background captures + cleanup — all fire-and-forget, never block session end
  if (config.apiKey) {
    const tasks = [];

    if (transcriptPath) {
      // 1. Signal content capture (keyword-filtered transcript turns)
      tasks.push(captureSignalContent(transcriptPath, sessionId, input.cwd));

      // 2. Assistant output capture (last response, if high-signal)
      tasks.push(captureAssistantOutput(transcriptPath));
    }

    // 3. Purge session-scoped memories (ephemeral scratch-pad, intermediate reasoning)
    // These were created with storeSessionMemory() and tagged with session_id.
    tasks.push(
      purgeSessionMemories(sessionId).then(result => {
        if (result.purged > 0) {
          process.stderr.write(`sulcus/session: purged ${result.purged}/${result.total} session-scoped memories\n`);
        }
      }).catch(() => {})
    );

    await Promise.allSettled(tasks);
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

/**
 * Capture signal content from transcript via SIU v2 quality gate.
 * Extracts keyword-filtered turns, classifies them, stores if worthy.
 */
async function captureSignalContent(transcriptPath, sessionId, cwd) {
  try {
    const signalContent = extractSignalContent(transcriptPath, sessionId);
    if (!signalContent || signalContent.length < 100) return;
    if (isJunkContent(signalContent)) return;
    if (!shouldCapture(signalContent)) return;

    // Run through SIU v2 quality gate
    let memoryType = 'episodic';
    try {
      const siuResult = await classifyMemory(signalContent);
      if (siuResult) {
        if (siuResult.quality === 'reject' && (siuResult.quality_confidence ?? 0) >= 0.5) {
          return; // SIU says not worth storing
        }
        if (siuResult.memory_type) memoryType = siuResult.memory_type;
      }
    } catch {
      // SIU unavailable — store as episodic (benefit of the doubt)
    }

    await storeMemory(
      `## Session Signal Extract\n\n${signalContent}`,
      memoryType,
      {
        type: 'session_signal',
        source: 'stop-hook',
        session_id: sessionId,
        cwd: cwd || process.cwd(),
        siu_classified: true,
      }
    );
  } catch {
    // Silent — don't interfere with session end
  }
}

/**
 * Capture the last assistant response if it's high-signal.
 * Filters generic acks, compresses long output, quality-gates via SIU v2.
 */
async function captureAssistantOutput(transcriptPath) {
  try {
    const state = extractSessionState(transcriptPath);
    const lastAssistant = state.lastAssistantText;
    if (!lastAssistant || lastAssistant.length < 50) return;
    if (isGenericAck(lastAssistant)) return;
    if (isJunkContent(lastAssistant)) return;

    // Summarize if too long for direct storage
    const captureText = lastAssistant.length > ASSISTANT_CAPTURE_MAX_DIRECT
      ? summarizeForCapture(lastAssistant)
      : lastAssistant;

    if (!shouldCapture(captureText)) return;

    // SIU v2 quality gate
    let memoryType = 'episodic';
    try {
      const siuResult = await classifyMemory(captureText);
      if (siuResult) {
        if (siuResult.quality === 'reject' && (siuResult.quality_confidence ?? 0) >= 0.4) {
          return; // Not worth storing
        }
        if (siuResult.memory_type) memoryType = siuResult.memory_type;
      }
    } catch {
      // SIU unavailable — store as episodic
    }

    await storeMemory(
      captureText,
      memoryType,
      {
        type: 'assistant_capture',
        source: 'stop-hook',
        siu_classified: true,
      }
    );
  } catch {
    // Silent
  }
}

main().catch((err) => {
  console.error(`Sulcus Stop error: ${err.message}`);
});
