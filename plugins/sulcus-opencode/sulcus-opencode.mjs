/**
 * Sulcus Lifecycle Plugin for OpenCode (.opencode/plugins/sulcus.mjs)
 *
 * Delegates recall, compaction resets, and turn capture
 * directly to the compiled pure-Rust `sulcus hook --harness opencode` binary.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function resolveSulcusBin() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.sulcus', 'bin', 'sulcus'),
    path.join(home, '.cargo', 'bin', 'sulcus'),
    '/opt/homebrew/bin/sulcus',
    '/usr/local/bin/sulcus',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'sulcus';
}

function runSulcusHook(args, stdinPayload = null) {
  return new Promise((resolve) => {
    const home = os.homedir();
    const child = spawn(resolveSulcusBin(), ['hook', '--harness', 'opencode', ...args], {
      stdio: [stdinPayload ? 'pipe' : 'ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        SULCUS_HARNESS: 'opencode',
        SULCUS_MODEL_CACHE_DIR:
          process.env.SULCUS_MODEL_CACHE_DIR || path.join(home, '.sulcus', 'models', 'fastembed'),
      },
    });
    if (stdinPayload && child.stdin) {
      try {
        child.stdin.write(JSON.stringify(stdinPayload));
        child.stdin.end();
      } catch {}
    }
    let out = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {}
      resolve(out.trim());
    }, 4500);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out.trim());
    });
  });
}

export const SulcusOpenCodePlugin = async ({ directory }) => {
  process.env.SULCUS_WORKSPACE_DIR = directory || process.cwd();
  return {
    'chat.message': async ({ message, sessionID }) => {
      const text = typeof message?.content === 'string' ? message.content : '';
      if (!text || text.length < 4) return;
      const recalled = await runSulcusHook(['recall', text.slice(0, 400)], {
        session_id: sessionID,
        cwd: directory || process.cwd(),
        prompt: text.slice(0, 1200),
      });
      if (recalled && typeof message.content === 'string') {
        message.content = `${recalled}\n\n${message.content}`;
      }
    },
    'tool.execute.after': async (input) => {
      const file = input?.args?.filePath || input?.args?.path;
      if (file) {
        await runSulcusHook(['PostToolUse'], {
          session_id: input?.sessionID,
          cwd: directory || process.cwd(),
          tool_name: input?.tool || 'write',
          tool_input: { filePath: file },
        });
      }
    },
    'session.compacted': async (event) => {
      await runSulcusHook(['Compaction'], {
        session_id: event?.sessionID,
        cwd: directory || process.cwd(),
        summary: event?.summary || '',
      });
    },
    'session.idle': async ({ lastAssistantMessage, sessionID }) => {
      if (lastAssistantMessage && lastAssistantMessage.length >= 40) {
        await runSulcusHook(['ingest'], {
          session_id: sessionID,
          cwd: directory || process.cwd(),
          assistant_output: lastAssistantMessage,
        });
      }
    },
  };
};

export default SulcusOpenCodePlugin;
