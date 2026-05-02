#!/usr/bin/env node
/**
 * Hook: TaskCompleted
 *
 * Fires when a task is marked as completed.
 * Extracts key learnings and stores them via MCP.
 */
'use strict';

const { readStdin, writeOutput } = require('../lib/stdin.cjs');

async function main() {
  const input = await readStdin();
  const taskSubject = input.task_subject || 'unknown task';

  writeOutput({
    hookSpecificOutput: {
      hookEventName: 'TaskCompleted',
      additionalContext: `Task completed: "${taskSubject}"

Extract key learnings from this completed task and store them using the Sulcus MCP \`record_memory\` tool:

1. **What strategy worked well?** → memory_type "procedural"
2. **Were there failed approaches** before finding the solution? → memory_type "episodic"
3. **Were there architectural decisions?** → memory_type "fact"
4. **Any new conventions or patterns** established? → memory_type "procedural"
5. **Files modified and why** → memory_type "episodic" (with file paths in content)

Memories should include full context, reasoning, code snippets, and examples.
Only store genuinely useful learnings — skip if the task was trivial.`,
    },
  });
}

main().catch((err) => {
  console.error(`Sulcus TaskCompleted error: ${err.message}`);
});
