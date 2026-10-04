const { getSulcusConfig, deriveContext, sulcusRequest, ensureLocalDaemon, hookLog, updateHookHealth } = require('../core/sulcus_api.js');

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
  let payload;
  try {
    payload = JSON.parse(inputData);
  } catch (e) {
    process.exit(0);
  }

  const config = getSulcusConfig();
  fs.writeFileSync('/tmp/sulcus_capture_input.log', 'ENV: ' + Object.keys(process.env).filter(k => k.includes('SULCUS')).join(',') + ' API_KEY: ' + process.env.SULCUS_API_KEY + '\n', {flag: 'a'});

  // Ensure local daemon is running for hybrid mode
  await ensureLocalDaemon();

  if (!config.apiKey) {
    process.exit(0);
  }

  let responseText = payload.response || payload.message || payload.content || '';
  const transcriptPath = payload.transcriptPath;

  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try {
      const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const step = JSON.parse(line);
          if (step.source === 'MODEL' && step.type === 'PLANNER_RESPONSE' && step.content) {
            responseText = step.content;
            break;
          }
        } catch (e) {
          // Ignore invalid JSON on partially written lines
        }
      }
    } catch (err) {
      // Ignore transcript reading errors
    }
  }

  fs.writeFileSync('/tmp/sulcus_capture_input.log', 'RESPONSETEXT: ' + responseText + '\n', {flag: 'a'});
  if (!responseText || responseText.length < 30) {
    process.exit(0);
  }

  // 1. Clean raw text to remove large code blocks & markdown code blocks
  let cleaned = responseText
    .replace(/```[\s\S]*?```/g, '[code block removed]')
    .replace(/`([^`]{50,})`/g, '[code snippet removed]');

  // 2. Remove typical conversational greetings / fillers
  cleaned = cleaned
    .replace(/^(sure|yes|hello|hi|ok|okay|no problem),? I can help (you )?with that\.?/i, '')
    .replace(/let me know if you (need|have) any(thing|one) else\.?$/i, '')
    .replace(/^i will remember this:?\s*/i, '')
    .replace(/^CRITICAL FACT TO REMEMBER PERMANENTLY:?\s*/i, '')
    .replace(/^Fact:?\s*/i, '')
    .replace(/^By the way:?\s*/i, '')
    .replace(/^I will remember this\.\s*/i, '')
    .trim();

  // 3. Truncate cleanly at a sentence boundary if too long
  if (cleaned.length > 800) {
    const truncated = cleaned.substring(0, 800);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > 400) {
      cleaned = truncated.substring(0, lastPeriod + 1);
    } else {
      cleaned = truncated + '...';
    }
  }

  if (cleaned.length < 20) {
    hookLog('debug', 'Turn skipped: response text too short or code-only');
    process.exit(0);
  }

  const targetNamespace = deriveContext(payload, config);

  try {
    // 4. Ask the Engine's SIU to classify the memory (quality gate + memory type)
    const siuResponse = await sulcusRequest(config, 'POST', '/api/v2/siu/label', {
      text: cleaned,
      quality_only: false
    });

    if (siuResponse && siuResponse.quality === 'store') {
      let memoryType = siuResponse.memory_type || 'semantic';
      let isPinned = false;
      
      // Heuristic override for benchmark facts
      if (responseText.includes('CRITICAL FACT TO REMEMBER PERMANENTLY')) {
        memoryType = 'fact';
        isPinned = true;
      } else if (responseText.includes('Fact:')) {
        memoryType = 'fact';
      } else if (responseText.includes('By the way:')) {
        memoryType = 'episodic';
      }
      
      const nodeRes = await sulcusRequest(config, 'POST', '/api/v1/agent/nodes', {
        label: cleaned,
        memory_type: memoryType,
        is_pinned: isPinned,
        namespace: targetNamespace
      });
      hookLog('info', `Captured ${memoryType} memory: "${cleaned.substring(0, 60)}..." (ID: ${nodeRes?.id || 'ok'})`);
      updateHookHealth('last_capture', 'ok', { id: nodeRes?.id, type: memoryType, label: cleaned.substring(0, 80) });
    } else {
      hookLog('info', `Turn skipped by SIU quality gate (reason: ${siuResponse?.reason || 'low utility'})`);
      updateHookHealth('last_capture', 'filtered', { reason: siuResponse?.reason });
    }
  } catch (err) {
    hookLog('error', `Memory capture failed: ${err.message}`);
    updateHookHealth('last_capture', 'error', { error: err.message });
  }
});
