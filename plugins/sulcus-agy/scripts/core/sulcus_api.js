const https = require('https');
const http = require('http');

const fs = require('fs');
const path = require('path');

function getSulcusConfig() {
  const config = {
    serverUrl: process.env.SULCUS_SERVER_URL || process.env.SULCUS_BASE_URL || 'https://api.sulcus.ca',
    apiKey: process.env.SULCUS_API_KEY || '',
    namespace: process.env.SULCUS_NAMESPACE || 'default',
    oidcIssuer: process.env.SULCUS_OIDC_ISSUER || 'http://127.0.0.1:8082/realms/master'
  };

  if (!config.apiKey) {
    try {
      const iniPath = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'sulcus', 'sulcus.ini');
      if (fs.existsSync(iniPath)) {
        const lines = fs.readFileSync(iniPath, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('server_url') && !process.env.SULCUS_SERVER_URL) {
            config.serverUrl = trimmed.split('=')[1].trim();
          }
          if (trimmed.startsWith('server_api_key') && !process.env.SULCUS_API_KEY) {
            config.apiKey = trimmed.split('=')[1].trim();
          }
          if (trimmed.startsWith('namespace') && !process.env.SULCUS_NAMESPACE) {
            config.namespace = trimmed.split('=')[1].trim();
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  return config;
}

function deriveContext(payload, config) {
  if (process.env.SULCUS_NAMESPACE && process.env.SULCUS_NAMESPACE !== 'default') {
    return process.env.SULCUS_NAMESPACE;
  }
  const convId = payload.conversationId || payload.sessionId;
  if (convId && convId.startsWith('ganymede_')) {
    return convId;
  }
  if (convId && convId.startsWith('benchmark_')) {
    return convId;
  }
  return config.namespace || 'default';
}

async function getOidcToken(config) {
  // Check cached token
  const tokenPath = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'sulcus', 'oidc_token.json');
  try {
    if (fs.existsSync(tokenPath)) {
      const cached = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      if (cached.access_token && cached.expires_at > Date.now() + 60000) {
        return cached.access_token;
      }
    }
  } catch (e) {}

  // Fetch new token (using admin-cli password grant for local dev)
  return new Promise((resolve, reject) => {
    const url = new URL(config.oidcIssuer + '/protocol/openid-connect/token');
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const bodyStr = 'client_id=sulcus-cli&username=admin&password=changeme&grant_type=password&scope=openid';
    
    const options = {
      hostname: url.hostname,
      port: url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': String(Buffer.byteLength(bodyStr))
      }
    };

    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!res.statusCode || res.statusCode >= 400) {
          return reject(new Error(`OIDC fetch failed: HTTP ${res.statusCode}: ${raw}`));
        }
        try {
          const data = JSON.parse(raw);
          if (data.access_token) {
            data.expires_at = Date.now() + (data.expires_in * 1000);
            fs.writeFileSync(tokenPath, JSON.stringify(data));
            resolve(data.access_token);
          } else {
            reject(new Error("No access token in OIDC response"));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(bodyStr);
    req.end();
  });
}

async function sulcusRequest(config, method, apiPath, body) {
  // Check if the local daemon is running first (hybrid mode)
  let targetBaseUrl = config.serverUrl;
  try {
    const localDaemonOk = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:4203/api/v1/admin/dashboard', (res) => {
        // Any response means the daemon is up
        resolve(res.statusCode !== 502 && res.statusCode !== 404);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(300, () => { req.destroy(); resolve(false); });
    });
    const isCloudOnly = apiPath.startsWith('/api/v2/siu');
    if (localDaemonOk && !isCloudOnly) {
      targetBaseUrl = 'http://127.0.0.1:4203';
    }
  } catch (e) {
    // Ignore ping errors
  }

  // If no API key is configured, try fetching an OIDC token when targeting remote server
  let token = config.apiKey;
  if (!token && targetBaseUrl === config.serverUrl) {
    try {
      token = await getOidcToken(config);
    } catch (e) {
      console.error("Failed to fetch OIDC token:", e.message);
    }
  }

  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(targetBaseUrl + apiPath);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${targetBaseUrl}${apiPath}`));
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {
      'Authorization': `Bearer ${token}`,
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
          const errMsg = `HTTP ${res.statusCode} from ${method} ${targetBaseUrl}${apiPath}: ${raw.substring(0, 200)}`;
          hookLog('error', errMsg);
          return reject(new Error(errMsg));
        }
        if (!raw || raw.trim() === '') return resolve(null);
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve(raw);
        }
      });
    });

    req.on('error', (e) => {
      hookLog('error', `Network error on ${method} ${targetBaseUrl}${apiPath}: ${e.message}`);
      reject(e);
    });
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

const SULCUS_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.sulcus');
const HOOK_LOG_FILE = path.join(SULCUS_DIR, 'hooks.log');
const HEALTH_FILE = path.join(SULCUS_DIR, 'health.json');

function hookLog(level, message, details) {
  const ts = new Date().toISOString();
  const detailStr = details ? ' ' + (typeof details === 'object' ? JSON.stringify(details) : details) : '';
  const entry = `[${ts}] [${level.toUpperCase()}] ${message}${detailStr}\n`;
  try {
    if (!fs.existsSync(SULCUS_DIR)) fs.mkdirSync(SULCUS_DIR, { recursive: true });
    fs.appendFileSync(HOOK_LOG_FILE, entry);
  } catch (e) {}

  if (level === 'error' || level === 'warn') {
    console.error(`[Sulcus ${level.toUpperCase()}] ${message}`);
  }
}

function updateHookHealth(component, status, metadata = {}) {
  try {
    if (!fs.existsSync(SULCUS_DIR)) fs.mkdirSync(SULCUS_DIR, { recursive: true });
    let health = {};
    if (fs.existsSync(HEALTH_FILE)) {
      try { health = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8')); } catch (e) {}
    }
    health[component] = {
      status,
      timestamp: new Date().toISOString(),
      ...metadata
    };
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(health, null, 2));
  } catch (e) {}
}

module.exports = {
  getSulcusConfig,
  deriveContext,
  sulcusRequest,
  ensureLocalDaemon,
  hookLog,
  updateHookHealth
};

async function ensureLocalDaemon() {
  const DAEMON_PORT = 4203;
  const HEALTH_URL = `http://127.0.0.1:${DAEMON_PORT}/api/v1/admin/dashboard`;
  const LOG_PATH = path.join(SULCUS_DIR, 'daemon_lifecycle.log');

  function daemonLog(msg) {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  }

  // First check if it's already responding
  const isUp = await new Promise((resolve) => {
    const req = http.get(HEALTH_URL, (res) => {
      resolve(res.statusCode !== 502 && res.statusCode !== 404);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });

  if (isUp) return;

  // It's not running. Check if we should run it.
  const iniPath = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'sulcus', 'sulcus.ini');
  if (!fs.existsSync(iniPath)) {
    daemonLog('No sulcus.ini found, skipping daemon launch');
    return;
  }

  // Parse INI for cloud sync credentials (server_url + server_api_key)
  let cloudServerUrl = '';
  let cloudApiKey = '';
  try {
    const lines = fs.readFileSync(iniPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('server_url')) {
        cloudServerUrl = trimmed.split('=').slice(1).join('=').trim();
      }
      if (trimmed.startsWith('server_api_key')) {
        cloudApiKey = trimmed.split('=').slice(1).join('=').trim();
      }
    }
  } catch (e) {
    daemonLog(`Failed to parse INI: ${e.message}`);
  }

  const { execSync, spawn } = require('child_process');
  let binPath = null;
  try {
    binPath = execSync('which sulcus', { encoding: 'utf8' }).trim();
  } catch (e) {
    const cargoPath = path.join(process.env.HOME || process.env.USERPROFILE, '.cargo', 'bin', 'sulcus');
    if (fs.existsSync(cargoPath)) {
      binPath = cargoPath;
    } else {
      // Dev mode fallback
      const devRel = path.join(process.env.HOME || process.env.USERPROFILE, 'dev', 'sulcus', 'target', 'release', 'sulcus');
      const devDbg = path.join(process.env.HOME || process.env.USERPROFILE, 'dev', 'sulcus', 'target', 'debug', 'sulcus');
      if (fs.existsSync(devRel)) binPath = devRel;
      else if (fs.existsSync(devDbg)) binPath = devDbg;
    }
  }

  if (!binPath) {
    daemonLog('Sulcus configured for hybrid mode but binary not found in PATH or standard directories.');
    return;
  }

  // Ensure log directory exists
  const sulcusDir = path.join(process.env.HOME || process.env.USERPROFILE, '.sulcus');
  if (!fs.existsSync(sulcusDir)) {
    fs.mkdirSync(sulcusDir, { recursive: true });
  }

  const logFile = path.join(sulcusDir, 'daemon.log');
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  // Build environment — inherit current env and add cloud sync credentials
  // so the binary can delta-sync to the remote server in hybrid mode.
  const childEnv = { ...process.env };
  if (cloudServerUrl && !cloudServerUrl.includes('127.0.0.1')) {
    // Only set cloud URL if it's an actual remote server, not a local loop
    childEnv.SULCUS_SERVER_URL = cloudServerUrl;
  }
  if (cloudApiKey) {
    childEnv.SULCUS_API_KEY = cloudApiKey;
  }

  // Spawn as detached background process with 'serve' command
  daemonLog(`Spawning Sulcus daemon: ${binPath} serve (port ${DAEMON_PORT})`);
  const child = spawn(binPath, ['serve'], {
    detached: true,
    stdio: ['ignore', out, err],
    env: childEnv
  });
  child.unref();
  daemonLog(`Daemon spawned with PID ${child.pid}`);

  // Wait for the daemon to become ready (up to 5 seconds)
  const MAX_WAIT_MS = 5000;
  const POLL_INTERVAL_MS = 250;
  const deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      const req = http.get(HEALTH_URL, (res) => {
        resolve(res.statusCode !== 502 && res.statusCode !== 404);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(300, () => { req.destroy(); resolve(false); });
    });
    if (ready) {
      daemonLog(`Daemon ready after ${Date.now() - (deadline - MAX_WAIT_MS)}ms`);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  daemonLog('Daemon spawned but did not become ready within 5s — hooks will retry on next invocation');
}

