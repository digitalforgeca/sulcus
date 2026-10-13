const fs = require('fs');
const readline = require('readline');
const {
  getSulcusConfig,
  deriveContext,
  sulcusRequest,
  dualCommitNode,
  ensureLocalDaemon,
  hookLog,
  updateHookHealth
} = require('../core/sulcus_api.js');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let inputData = '';
rl.on('line', (line) => {
  inputData += line;
});

rl.on('close', async () => {
  fs.writeFileSync('/tmp/capture_last_payload.json', inputData || '{}');
  let payload;
  try {
    payload = JSON.parse(inputData);
  } catch (e) {
    process.exit(0);
  }

  const config = getSulcusConfig();
  await ensureLocalDaemon();

  if (!config.apiKey && !config.oidcIssuer) {
    process.exit(0);
  }

  // CRITICAL ARCHITECTURAL DIRECTIVE:
  // Memory capture MUST ONLY ingest user-provided facts, preferences, and profile statements.
  // Under NO circumstance should the assistant's generated responses (MODEL / PLANNER_RESPONSE)
  // ever be captured by this proactive hook! Ingesting the assistant's output creates an infinite
  // self-referential echo loop and floods the memory store with markdown essays and debug logs.
  let rawUserText = '';
  const transcriptPath = payload.transcriptPath;

  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try {
      const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const step = JSON.parse(line);
          if (step.source === 'USER_EXPLICIT' && step.type === 'USER_INPUT' && step.content) {
            let uText = step.content;
            if (uText.includes('<CONTEXT_SUMMARY>')) {
              continue; // Skip compaction / context summaries
            }
            const match = uText.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
            if (match && match[1]) uText = match[1].trim();
            rawUserText = uText;
            break;
          }
        } catch (e) {}
      }
    } catch (err) {}
  }

  if (!rawUserText && payload.prompt) {
    if (!payload.prompt.includes('<CONTEXT_SUMMARY>')) {
      rawUserText = payload.prompt;
    }
  }

  if (!rawUserText) {
    process.exit(0);
  }

  // 1. Strip system/injected blocks so we only inspect real user speech
  let cleaned = rawUserText
    .replace(/<USER_REQUEST>[\s\S]*?<\/USER_REQUEST>/gi, '')
    .replace(/<sulcus-memories>[\s\S]*?<\/sulcus-memories>/gi, '')
    .replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]{50,}`/g, '')
    .replace(/\([^)]*(?:Acknowledge|DO NOT USE|Understood|respond with)[^)]*\)/gi, '')
    .trim();

  // If cleaning stripped everything (e.g. prompt was wrapped), fallback to unadorned inner content
  if (!cleaned && rawUserText) {
    cleaned = rawUserText
      .replace(/<sulcus-memories>[\s\S]*?<\/sulcus-memories>/gi, '')
      .replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, '')
      .trim();
  }

  // 2. Reject meta-discussions, memory engine debugging, and prompt injections
  const isMetaDiscussion =
    /Pinning is an emergency bypass/i.test(cleaned) ||
    /emergency bypass/i.test(cleaned) ||
    /is_pinned/i.test(cleaned) ||
    /pinning everything/i.test(cleaned) ||
    /Like, why pin anything/i.test(cleaned) ||
    /sulcus-memories/i.test(cleaned) ||
    /dualCommitNode/i.test(cleaned);

  if (isMetaDiscussion) {
    hookLog('debug', 'Turn skipped: meta-discussion or self-referential memory text');
    process.exit(0);
  }

  // 3. Reject slash commands (agent orchestration commands, e.g. /goal, /loop, /plan)
  if (/^\/[a-zA-Z0-9_-]+/i.test(cleaned)) {
    hookLog('debug', 'Turn skipped: slash command prompt');
    process.exit(0);
  }

  // 4. Handle questions & commands vs facts:
  // Split into sentences so that if the user said:
  // "The package name is ca.dforge.apocalypse. Please make sure tests pass."
  // we extract the declarative statement and drop the command.
  const rawSentences = cleaned.split(/(?<=[.!?\n])\s+/);
  const declarativeSentences = [];

  const isQuestion = (s) => {
    const trimmed = s.trim();
    if (trimmed.endsWith('?')) return true;
    return /^(what|when|where|which|who|whom|whose|why|how|can you|could you|is there|are there|do you|does it|will you|tell me|show me)\b/i.test(trimmed);
  };

  const isPureTaskCommand = (s) => {
    const trimmed = s.trim();
    const commandPattern = /^(?:(?:let'?s|lets|let us|please|kindly|try to|make sure to|ensure|we should|we need to|now)\s+)?(benchmark|test|run|check|verify|fix|update|edit|create|build|deploy|install|compile|delete|remove|find|search|list|inspect|open|kill|review|consolidate|audit)\b/i;
    if (commandPattern.test(trimmed)) {
      return !/(remember|fact:|preference:|note:|critical fact)\b/i.test(trimmed);
    }
    return false;
  };

  for (const s of rawSentences) {
    const trimmed = s.trim();
    if (trimmed.length < 10) continue;
    if (isQuestion(trimmed)) continue;
    if (isPureTaskCommand(trimmed)) continue;
    declarativeSentences.push(trimmed);
  }

  let finalContent = declarativeSentences.join(' ').trim();

  // If no declarative sentences survived, check if the full text had explicit memory keywords
  const hasExplicitFactMarker = /(CRITICAL FACT|Fact:|By the way:|Remember:|I prefer|My preference is|Note:)/i.test(cleaned);
  if (!finalContent && hasExplicitFactMarker) {
    finalContent = cleaned;
  }

  // 5. Remove conversational fillers
  finalContent = finalContent
    .replace(/^(sure|yes|hello|hi|ok|okay|no problem),?\s*/i, '')
    .replace(/^i will remember this:?\s*/i, '')
    .replace(/^CRITICAL FACT TO REMEMBER PERMANENTLY:?\s*/i, '')
    .replace(/^Fact:?\s*/i, '')
    .replace(/^By the way:?\s*/i, '')
    .replace(/^Remember:?\s*/i, '')
    .replace(/^Note:?\s*/i, '')
    .trim();

  if (finalContent.length < 15) {
    hookLog('debug', 'Turn skipped: no storable declarative facts found');
    process.exit(0);
  }

  // 6. Truncate cleanly at a sentence boundary if too long
  if (finalContent.length > 500) {
    const truncated = finalContent.substring(0, 500);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > 200) {
      finalContent = truncated.substring(0, lastPeriod + 1);
    } else {
      finalContent = truncated + '...';
    }
  }

  const targetNamespace = deriveContext(payload, config);

  // 7. Explicit Pinning ONLY:
  // Never auto-pin heuristic patterns. Pinning is reserved strictly for explicit human directives.
  const isExplicitlyPinned =
    rawUserText.includes('CRITICAL FACT TO REMEMBER PERMANENTLY') ||
    /\b(pin this memory|pin this fact|permanently pin)\b/i.test(rawUserText);

  try {
    // Consult the Engine's SIU / JEV classifier for quality and memory type
    const siuResponse = await sulcusRequest(config, 'POST', '/api/v2/siu/label', {
      text: finalContent,
      quality_only: false
    }).catch(() => null);

    if (siuResponse && siuResponse.quality === 'store') {
      let memoryType = 'semantic';
      if (/^(Fact:|CRITICAL FACT)/i.test(rawUserText) || siuResponse.memory_type === 'fact') {
        memoryType = 'fact';
      } else if (/\b(prefer|preference|favorite|like|hate)\b/i.test(finalContent) || siuResponse.memory_type === 'preference') {
        memoryType = 'preference';
      } else if (/\b(By the way:)\b/i.test(rawUserText) || siuResponse.memory_type === 'episodic') {
        memoryType = 'episodic';
      } else if (siuResponse.memory_type) {
        memoryType = siuResponse.memory_type;
      }

      const commitResults = await dualCommitNode(config, {
        label: finalContent,
        memory_type: memoryType,
        is_pinned: isExplicitlyPinned,
        namespace: targetNamespace
      });

      const successfulTargets = commitResults.filter(r => r.res).map(r => r.target);
      hookLog('info', `Captured ${memoryType}${isExplicitlyPinned ? ' [PINNED]' : ''} memory committed to [${successfulTargets.join(', ')}]: "${finalContent.substring(0, 60)}..."`);
      updateHookHealth('last_capture', 'ok', {
        targets: successfulTargets,
        type: memoryType,
        is_pinned: isExplicitlyPinned,
        label: finalContent.substring(0, 80)
      });
    } else {
      hookLog('info', `Turn skipped by SIU quality gate (reason: ${siuResponse?.reason || 'low utility'})`);
      updateHookHealth('last_capture', 'filtered', { reason: siuResponse?.reason });
    }
  } catch (err) {
    hookLog('error', `Memory capture failed: ${err.message}`);
    updateHookHealth('last_capture', 'error', { error: err.message });
  }
});
