const fs = require('fs');
const readline = require('readline');
const { getSulcusConfig, deriveContext, sulcusRequest } = require('../core/sulcus_api.js');

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
    console.log('{}');
    process.exit(0);
  }

  const config = getSulcusConfig();
  if (!config.apiKey) {
    console.log('{}');
    process.exit(0);
  }

  const transcriptPath = payload.transcriptPath;
  if (!transcriptPath) {
    console.log('{}');
    process.exit(0);
  }

  // Use transcript_full to get the untruncated pre-compaction history
  const fullTranscriptPath = transcriptPath.replace('transcript.jsonl', 'transcript_full.jsonl');
  const targetTranscript = fs.existsSync(fullTranscriptPath) ? fullTranscriptPath : transcriptPath;

  let allQueries = [];
  try {
    const lines = fs.readFileSync(targetTranscript, 'utf8').split('\n').filter(Boolean);
    const steps = lines.map(line => JSON.parse(line));
    
    for (const step of steps) {
      if (step.source === 'USER_EXPLICIT' && step.type === 'USER_INPUT' && step.content) {
        let text = step.content;
        const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        if (match && match[1]) text = match[1].trim();
        if (text.length > 5) allQueries.push(text);
      }
    }
  } catch (err) {
    // Ignore transcript reading errors
  }

  const targetNamespace = deriveContext(payload, config);

  // 1. Save the conversation pre-compaction as an episodic memory
  if (allQueries.length > 0) {
    const summary = allQueries.slice(-3).join(' -> ');
    try {
      await sulcusRequest(config, 'POST', '/api/v1/agent/nodes', {
        label: `Pre-compaction conversation snapshot: ${summary.substring(0, 500)}`,
        memory_type: 'episodic',
        namespace: targetNamespace
      });
    } catch (e) {
      // Ignore errors saving episodic snapshot
    }
  }

  // 2. Fetch relevant memories to inject post-compaction
  let injectMessage = '';
  try {
    const searchQuery = allQueries.length > 0 ? allQueries[allQueries.length - 1] : 'current context';
    const searchRes = await sulcusRequest(config, 'POST', '/api/v1/agent/search', {
      query: searchQuery,
      limit: 10,
      namespace: targetNamespace
    });

    let results = searchRes?.results || searchRes?.items || searchRes?.nodes || (Array.isArray(searchRes) ? searchRes : []);
    
    if (results && results.length > 0) {
      // Results are kept in the natural semantic/heat order returned by the engine

      const formatted = results.map((r, index) => {
        const node = r.node || r;
        const type = node.memory_type || 'semantic';
        const label = node.pointer_summary || node.label || '';
        const heat = node.current_heat !== undefined ? (node.current_heat * 100).toFixed(0) : 'unknown';
        const id = node.id || 'unknown';
        return `${index + 1}. [${type}] (ID: ${id}, heat: ${heat}%) ${label}`;
      }).join('\n');

      injectMessage = `<sulcus-memories>\nPost-compaction restored context (deterministically ordered for optimal caching):\n${formatted}\n\nNote: If a memory is inaccurate, unhelpful, or exceptionally useful, you can affect its rating by calling the corresponding Sulcus tools (e.g. \`boost_memory\`, \`retract_memory\`, \`forget_memory\`) using the memory ID provided above.\n</sulcus-memories>`;
    }
  } catch (err) {
    // Ignore fetch errors
  }

  // Return the injection block
  if (injectMessage) {
    console.log(JSON.stringify({
      injectSteps: [
        {
          ephemeralMessage: injectMessage
        }
      ]
    }));
  } else {
    console.log('{}');
  }
});
