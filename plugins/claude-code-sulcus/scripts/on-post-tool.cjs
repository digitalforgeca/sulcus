#!/usr/bin/env node
/**
 * Hook: PostToolUse (matcher: Write|Edit|Bash)
 *
 * After tool calls succeed, extracts file paths and notable commands
 * for context tracking. Lightweight — no network calls in the hot path.
 */
'use strict';

const { readStdin } = require('../lib/stdin.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATE_DIR = path.join(os.homedir(), '.sulcus-claude');
const STATE_FILE = path.join(STATE_DIR, 'session-files.json');

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }

  // Load current state
  let state = { files: [], commands: [], lastUpdated: null };
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch { /* start fresh */ }

  let changed = false;

  if ((toolName === 'Write' || toolName === 'Edit') && toolInput.file_path) {
    if (!state.files.includes(toolInput.file_path)) {
      state.files.push(toolInput.file_path);
      // Cap at 100 files
      if (state.files.length > 100) state.files = state.files.slice(-100);
      changed = true;
    }
  }

  if (toolName === 'Bash' && toolInput.command) {
    // Only track notable commands (not simple ls, cat, etc.)
    const cmd = toolInput.command;
    const notable = cmd.length > 20 || /install|build|test|deploy|migrate|rm|git|docker|npm|cargo/.test(cmd);
    if (notable) {
      state.commands.push({ cmd: cmd.slice(0, 500), ts: Date.now() });
      // Cap at 50 commands
      if (state.commands.length > 50) state.commands = state.commands.slice(-50);
      changed = true;
    }
  }

  if (changed) {
    state.lastUpdated = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  // exit 0, no output — pass through silently
}

main().catch(() => {});
