/**
 * Transcript parser for Claude Code sessions.
 * Reads JSONL transcript files and extracts structured session state.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_TAIL_LINES = 500;
const TRACKER_DIR = path.join(os.homedir(), '.sulcus-claude', 'trackers');

function ensureTrackerDir() {
  if (!fs.existsSync(TRACKER_DIR)) {
    fs.mkdirSync(TRACKER_DIR, { recursive: true });
  }
}

function getLastCapturedUuid(sessionId) {
  ensureTrackerDir();
  const file = path.join(TRACKER_DIR, `${sessionId}.txt`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8').trim();
  return null;
}

function setLastCapturedUuid(sessionId, uuid) {
  ensureTrackerDir();
  fs.writeFileSync(path.join(TRACKER_DIR, `${sessionId}.txt`), uuid);
}

function tailLines(filepath, n) {
  try {
    const fd = fs.openSync(filepath, 'r');
    const stat = fs.fstatSync(fd);
    if (stat.size === 0) { fs.closeSync(fd); return []; }
    const chunkSize = Math.min(stat.size, n * 4096);
    const buf = Buffer.alloc(chunkSize);
    fs.readSync(fd, buf, 0, chunkSize, Math.max(0, stat.size - chunkSize));
    fs.closeSync(fd);
    return buf.toString('utf-8').split('\n').slice(-n);
  } catch {
    return [];
  }
}

function parseTranscript(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];
  const content = fs.readFileSync(transcriptPath, 'utf-8');
  const entries = [];
  for (const line of content.trim().split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip bad lines */ }
  }
  return entries;
}

function extractSessionState(transcriptPath) {
  const lines = tailLines(transcriptPath, MAX_TAIL_LINES);
  const userMessages = [];
  const filesModified = new Set();
  const bashCommands = [];
  let lastAssistantText = '';

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.isSidechain) continue;

    const content = entry.message?.content;
    if (!content) continue;

    if (entry.type === 'user') {
      const text = extractText(content);
      if (text && text.length > 10 && !text.startsWith('<')) {
        userMessages.push(text);
      }
    } else if (entry.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          lastAssistantText = block.text.trim();
        }
        if (block.type === 'tool_use') {
          const name = block.name || '';
          const input = block.input || {};
          if (name === 'Write' || name === 'Edit') {
            const fp = input.file_path || '';
            if (fp) filesModified.add(fp);
          } else if (name === 'Bash') {
            const cmd = input.command || '';
            if (cmd) bashCommands.push(cmd);
          }
        }
      }
    }
  }

  return {
    userMessages: userMessages.slice(-30),
    filesModified: [...filesModified].sort(),
    bashCommands: bashCommands.slice(-20),
    lastAssistantText: lastAssistantText.slice(0, 10000),
  };
}

function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text)
      .join('\n')
      .trim();
  }
  return '';
}

function buildSessionSummary(state, source) {
  const parts = [`## Session State (${source})\n`];

  if (state.userMessages.length) {
    parts.push('### What the user was working on');
    for (const msg of state.userMessages) {
      parts.push(`- ${msg.slice(0, 5000)}`);
    }
    parts.push('');
  }

  if (state.filesModified.length) {
    parts.push('### Files modified');
    for (const fp of state.filesModified) {
      parts.push(`- \`${fp}\``);
    }
    parts.push('');
  }

  if (state.bashCommands.length) {
    parts.push('### Recent commands');
    for (const cmd of state.bashCommands) {
      parts.push(`- \`${cmd.slice(0, 1000)}\``);
    }
    parts.push('');
  }

  if (state.lastAssistantText) {
    parts.push('### Last context');
    parts.push(state.lastAssistantText.slice(0, 3000));
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Signal extraction: filters transcript turns that contain high-signal keywords.
 * Only captures turns where the user discussed decisions, architecture, bugs, etc.
 */
const SIGNAL_KEYWORDS = [
  'remember', 'decision', 'architecture', 'important', 'bug', 'fix',
  'solved', 'solution', 'pattern', 'approach', 'design', 'tradeoff',
  'migrate', 'upgrade', 'refactor', 'deprecate', 'preference',
  'convention', 'learning', 'mistake', 'insight',
];

function hasSignal(text) {
  const lower = text.toLowerCase();
  return SIGNAL_KEYWORDS.some(kw => lower.includes(kw));
}

function extractSignalContent(transcriptPath, sessionId) {
  const entries = parseTranscript(transcriptPath);
  if (!entries.length) return null;

  const lastUuid = getLastCapturedUuid(sessionId);
  let foundLast = !lastUuid;
  const newEntries = [];

  for (const entry of entries) {
    if (!foundLast) {
      if (entry.uuid === lastUuid) foundLast = true;
      continue;
    }
    if (entry.type === 'user' || entry.type === 'assistant') {
      newEntries.push(entry);
    }
  }

  if (!newEntries.length) return null;

  // Filter to signal turns only
  const signalTurns = [];
  let currentTurn = { user: [], assistant: [] };

  for (const entry of newEntries) {
    if (entry.type === 'user') {
      if (currentTurn.assistant.length) {
        if (currentTurn.user.some(u => hasSignal(extractText(u.message?.content)))) {
          signalTurns.push(currentTurn);
        }
        currentTurn = { user: [], assistant: [] };
      }
      currentTurn.user.push(entry);
    } else if (entry.type === 'assistant') {
      currentTurn.assistant.push(entry);
    }
  }

  // Check last turn
  if (currentTurn.user.some(u => hasSignal(extractText(u.message?.content)))) {
    signalTurns.push(currentTurn);
  }

  if (!signalTurns.length) return null;

  // Update tracker
  const lastEntry = newEntries[newEntries.length - 1];
  if (lastEntry.uuid) setLastCapturedUuid(sessionId, lastEntry.uuid);

  // Format signal content
  const parts = [];
  for (const turn of signalTurns) {
    for (const entry of [...turn.user, ...turn.assistant]) {
      const text = extractText(entry.message?.content);
      if (text) {
        parts.push(`[${entry.type}] ${text.slice(0, 3000)}`);
      }
    }
  }

  return parts.join('\n\n');
}

module.exports = {
  extractSessionState,
  buildSessionSummary,
  extractSignalContent,
  parseTranscript,
  getLastCapturedUuid,
  setLastCapturedUuid,
};
