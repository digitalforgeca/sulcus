// Lightweight OpenClaw <-> Sulcus plugin scaffold (ESM)
// - Spawns `sulcus-local` sidecar (optional)
// - Sends/receives MCP JSON lines over stdin/stdout
// - Provides high-level helpers: describeTools, addMemory, getActiveIndex

import { spawn } from 'child_process';

export async function connectSulcus({
  cwd = process.cwd(),
  dbPath = undefined,
  autoSpawn = true,
  timeoutMs = 10_000,
} = {}) {
  let child = null;
  let spawned = false;

  if (autoSpawn) {
    const env = { ...process.env };
    if (dbPath) env.SULCUS_DB_PATH = dbPath;
    child = spawn('cargo', ['run', '-p', 'sulcus-local', '--', 'serve'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    spawned = true;
  } else {
    throw new Error('connectSulcus currently requires autoSpawn=true in this scaffold');
  }

  const pending = new Map();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.split('\n').filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        const id = obj && obj.id;
        if (id && pending.has(id)) {
          const { resolve, timeout } = pending.get(id);
          clearTimeout(timeout);
          pending.delete(id);
          resolve(obj);
        }
      } catch (err) {
        // ignore non-json lines
      }
    }
  });

  function send(req, timeoutMsLocal = timeoutMs) {
    if (!req.id) req.id = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => {
        pending.delete(req.id);
        reject(new Error('timeout waiting for MCP response'));
      }, timeoutMsLocal);
      pending.set(req.id, { resolve, reject, timeout: to });

      try {
        child.stdin.write(JSON.stringify(req) + '\n');
      } catch (err) {
        clearTimeout(to);
        pending.delete(req.id);
        reject(err);
      }
    });
  }

  return {
    describeTools: async () => {
      const res = await send({ method: 'describe_tools' });
      return res.result;
    },
    addMemory: async (content) => {
      const res = await send({ method: 'add_memory', params: { content } });
      return res.result?.node_id;
    },
    getActiveIndex: async (limit = 10) => {
      const res = await send({ method: 'resource', params: { resource: 'memory://active_index', limit } });
      return Array.isArray(res.result) ? res.result : [];
    },
    rawSend: send,
    close: async () => {
      // flush pending
      for (const { reject, timeout } of pending.values()) {
        clearTimeout(timeout);
        reject(new Error('sulcus-client shutting down'));
      }
      pending.clear();
      if (spawned && child) {
        try { child.kill(); } catch (e) { /* ignore */ }
      }
    },
    _meta: { spawned, child },
  };
}
