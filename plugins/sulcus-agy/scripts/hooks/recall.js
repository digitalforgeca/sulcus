const fs = require('fs');
const readline = require('readline');
const {
  getSulcusConfig,
  deriveContext,
  sulcusRequest,
  hybridSearch,
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
  fs.writeFileSync('/tmp/sulcus_recall_debug.log', 'INPUT: ' + inputData + '\n', { flag: 'a' });
  let payload;
  try {
    payload = JSON.parse(inputData);
  } catch (e) {
    console.log('{}');
    process.exit(0);
  }

  const config = getSulcusConfig();
  await ensureLocalDaemon();

  if (!config.apiKey && !config.oidcIssuer) {
    console.log('{}');
    process.exit(0);
  }

  const transcriptPath = payload.transcriptPath;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    console.log('{}');
    process.exit(0);
  }

  let lastUserQuery = '';
  let precedingContext = '';
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
    const steps = lines.map(line => JSON.parse(line));

    let lastUserIndex = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].source === 'USER_EXPLICIT' && steps[i].type === 'USER_INPUT') {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex !== -1) {
      let text = steps[lastUserIndex].content || '';
      const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      if (match && match[1]) {
        text = match[1].trim();
      }
      lastUserQuery = text;

      if (lastUserQuery.length < 35) {
        for (let i = lastUserIndex - 1; i >= 0; i--) {
          const step = steps[i];
          if (step.content && step.content.length > 20) {
            let contextText = step.content;
            const m = contextText.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
            if (m && m[1]) contextText = m[1].trim();
            contextText = contextText.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').trim();
            if (contextText.length > 15) {
              precedingContext = contextText.substring(0, 200);
              break;
            }
          }
        }
      }
    }
  } catch (err) {
    // Ignore transcript reading errors
  }

  if (!lastUserQuery || lastUserQuery.length < 3) {
    console.log('{}');
    process.exit(0);
  }

  // 1. Extract technical identifiers
  const identifierTerms = [];
  const pkgRegex = /(?:ca|com|org|net|io)\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+/gi;
  let m;
  while ((m = pkgRegex.exec(lastUserQuery)) !== null) {
    identifierTerms.push(m[0]);
  }
  const keyWords = lastUserQuery.match(/\b(apocalypse|icarus|godot|pixel|android|package|apk)\b/gi) || [];
  for (const kw of keyWords) {
    if (!identifierTerms.map(t => t.toLowerCase()).includes(kw.toLowerCase())) {
      identifierTerms.push(kw);
    }
  }

  // 2. Pre-filter conversational banter / non-informational feedback
  // Do NOT flood the prompt with memories when the user is casually chatting or giving feedback
  const isConversationalOnly =
    /^(yes|no|okay|ok|sounds good|thanks|thank you|cool|awesome|great|let'?s be real|do some legwork|what'?s up|hello|hey|sure)\b/i.test(lastUserQuery.trim()) &&
    identifierTerms.length === 0 &&
    !/\?/.test(lastUserQuery);

  if (isConversationalOnly) {
    console.log('{}');
    process.exit(0);
  }

  const targetNamespace = deriveContext(payload, config);

  try {
    const searchPromises = [
      hybridSearch(config, {
        query: lastUserQuery,
        context: precedingContext,
        limit: 10,
        namespace: targetNamespace
      })
    ];

    for (const term of identifierTerms.slice(0, 2)) {
      searchPromises.push(
        hybridSearch(config, {
          query: term,
          limit: 5,
          namespace: targetNamespace
        })
      );
    }

    const searchResponses = await Promise.all(searchPromises);

    const seenIds = new Set();
    const seenLabels = new Set();
    const allResults = [];

    // Real search relevance score: use actual match score from the engine!
    function scoreOf(item) {
      if (item.score !== undefined) return item.score;
      if (item.node && item.node.score !== undefined) return item.node.score;
      if (item.cosine_sim !== undefined) return item.cosine_sim;
      return 0;
    }

    for (const resp of searchResponses) {
      const items = resp?.results || resp?.items || resp?.nodes || (Array.isArray(resp) ? resp : []);
      for (const item of items) {
        const node = item.node || item;
        const id = node.id;
        const norm = (node.label || node.pointer_summary || '').trim().toLowerCase();
        if (id && seenIds.has(id)) continue;
        if (norm && seenLabels.has(norm)) continue;
        if (id) seenIds.add(id);
        if (norm) seenLabels.add(norm);
        allResults.push(item);
      }
    }

    // Sort by REAL search relevance score, descending
    allResults.sort((a, b) => scoreOf(b) - scoreOf(a));

    // Strict relevance threshold filter: do NOT inject random irrelevant memories
    // If the top score is below meaningful relevance, drop it
    const MIN_RELEVANCE_SCORE = 0.10;
    const qualifiedResults = allResults.filter(r => scoreOf(r) >= MIN_RELEVANCE_SCORE || r.is_pinned);

    if (qualifiedResults.length === 0) {
      updateHookHealth('last_recall', 'empty', { count: 0, query: lastUserQuery.substring(0, 60) });
      console.log('{}');
      process.exit(0);
    }

    // Working memory cap: maximum 5 high-confidence memories, NEVER a 20-item dump
    const results = qualifiedResults.slice(0, 5);

    hookLog('info', `Recalled ${results.length} memories for query: "${lastUserQuery.substring(0, 40)}..."`);
    updateHookHealth('last_recall', 'ok', { count: results.length, query: lastUserQuery.substring(0, 60) });

    const formatted = results.map((r, index) => {
      const node = r.node || r;
      const type = node.memory_type || 'semantic';
      const label = node.pointer_summary || node.label || '';
      const id = node.id || 'unknown';
      const pinTag = node.is_pinned ? ' [PINNED]' : '';
      return `${index + 1}. [${type}]${pinTag} (ID: ${id}) ${label}`;
    }).join('\n');

    const injectMessage = `<sulcus-memories>\nRelevant memories from Sulcus:\n${formatted}\n</sulcus-memories>`;
    console.log(JSON.stringify({
      injectSteps: [
        {
          ephemeralMessage: injectMessage
        }
      ]
    }));
  } catch (err) {
    hookLog('warn', `Memory recall search failed: ${err.message}`);
    updateHookHealth('last_recall', 'error', { error: err.message });
    console.log('{}');
  }
});
