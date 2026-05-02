#!/usr/bin/env node
/**
 * Hook: PreToolUse (matcher: Write|Edit)
 *
 * Blocks writes to MEMORY.md and auto-memory files, redirecting Claude
 * to use the Sulcus MCP record_memory tool instead.
 *
 * Exit codes:
 *   0 = allow the tool call
 *   2 = block the tool call (stderr message shown to Claude as feedback)
 */
'use strict';

const { readStdin, writeOutput } = require('../lib/stdin.cjs');

async function main() {
  const input = await readStdin();
  const filePath = input.tool_input?.file_path || input.tool_input?.path || '';

  if (!filePath) {
    process.exit(0); // No file path = not our concern
  }

  // Block writes to memory files — use Sulcus instead
  const blocked = [
    /\/MEMORY\.md$/i,
    /\/memory\/.*\.md$/i,
    /\/.claude\/.*\/memory\//i,
  ];

  for (const pattern of blocked) {
    if (pattern.test(filePath)) {
      writeOutput({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `BLOCKED: Do not write to ${filePath}. Use the Sulcus MCP \`record_memory\` tool instead to persist memories. This project uses Sulcus for all memory storage.`,
        },
      });
      return;
    }
  }

  process.exit(0); // Allow all other writes
}

main().catch(() => process.exit(0));
