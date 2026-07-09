const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const readline = require('readline');

function getSulcusConfig() {
  const config = {
    serverUrl: process.env.SULCUS_SERVER_URL || process.env.SULCUS_BASE_URL || 'https://api.sulcus.ca',
    apiKey: process.env.SULCUS_API_KEY || '',
    namespace: process.env.SULCUS_NAMESPACE || 'default'
  };

  if (!config.apiKey) {
    try {
      const openClawPath = path.join(process.env.HOME || '/Users/dv00003-00', '.openclaw', 'openclaw.json');
      if (fs.existsSync(openClawPath)) {
        const raw = fs.readFileSync(openClawPath, 'utf8');
        const data = JSON.parse(raw);
        const sulcusPlugin = data.plugins?.entries?.['openclaw-sulcus']?.config;
        if (sulcusPlugin) {
          if (sulcusPlugin.serverUrl && !process.env.SULCUS_SERVER_URL) {
            config.serverUrl = sulcusPlugin.serverUrl;
          }
          if (sulcusPlugin.apiKey && !process.env.SULCUS_API_KEY) {
            config.apiKey = sulcusPlugin.apiKey;
          }
          if (sulcusPlugin.namespace && !process.env.SULCUS_NAMESPACE) {
            config.namespace = sulcusPlugin.namespace;
          }
        }
      }
    } catch (err) {
      // ignore fallback errors
    }
  }
  return config;
}

function sulcusRequest(config, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(config.serverUrl + apiPath);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${config.serverUrl}${apiPath}`));
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Accept': 'application/json',
    };
    if (bodyStr !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
    }

    const options = {
      hostname: url.hostname,
      port: url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!res.statusCode || res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw.substring(0, 200)}`));
        }
        if (!raw || raw.trim() === '') return resolve(null);
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve(raw);
        }
      });
    });

    req.on('error', (e) => reject(e));
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

function deriveNamespace(payload, config) {
  if (process.env.SULCUS_NAMESPACE && process.env.SULCUS_NAMESPACE !== 'default') {
    return process.env.SULCUS_NAMESPACE;
  }
  const convId = payload.conversationId || payload.sessionId;
  if (convId) {
    if (convId.startsWith('ganymede_')) {
      const parts = convId.split('_');
      if (parts.length >= 2) {
        return `ganymede_${parts[1]}`;
      }
    }
  }
  return config.namespace || 'default';
}

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
        const step = JSON.parse(line);
        if (step.source === 'MODEL' && step.type === 'PLANNER_RESPONSE' && step.content) {
          responseText = step.content;
          break;
        }
      }
    } catch (err) {
      // Ignore transcript reading errors
    }
  }

  if (!responseText || responseText.length < 30) {
    process.exit(0);
  }

  const matchRegex = /(decided|will use|our approach|preference|important|remember|lesson|key takeaway|going with)/i;
  if (matchRegex.test(responseText)) {
    // 1. Clean raw text to remove large code blocks & markdown code blocks
    let cleaned = responseText
      .replace(/```[\s\S]*?```/g, '[code block removed]')
      .replace(/`([^`]{50,})`/g, '[code snippet removed]');

    // 2. Remove typical conversational greetings / fillers
    cleaned = cleaned
      .replace(/^(sure|yes|hello|hi|ok|okay|no problem),? I can help (you )?with that\.?/i, '')
      .replace(/let me know if you (need|have) any(thing|one) else\.?$/i, '')
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
      process.exit(0);
    }

    // 4. Classify memory type dynamically based on content keywords
    let memoryType = 'semantic';
    const lowerText = cleaned.toLowerCase();
    if (lowerText.includes('prefer') || lowerText.includes('preference')) {
      memoryType = 'preference';
    } else if (lowerText.includes('lesson') || lowerText.includes('takeaway') || lowerText.includes('remember')) {
      memoryType = 'semantic';
    }

    const targetNamespace = deriveNamespace(payload, config);

    try {
      await sulcusRequest(config, 'POST', '/api/v1/agent/nodes', {
        label: cleaned,
        memory_type: memoryType,
        namespace: targetNamespace
      });
    } catch (err) {
      // Ignore capture errors
    }
  }
});
