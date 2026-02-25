// Lightweight OpenClaw <-> Sulcus plugin scaffold (ESM)
//
// Two connection modes
// ───────────────────
//  1. PGlite (default, recommended)
//     Uses @electric-sql/pglite — in-process Postgres WASM, same dialect as
//     the sulcus-wasm browser build.  No Rust binary required.
//
//       import { createPGliteClient } from './openclaw-plugin.mjs';
//       const sulcus = await createPGliteClient({ dataDir: './my-memory' });
//
//  2. Rust sidecar (full fastembed vectors + thermodynamics engine)
//
//       import { connectSulcus } from './openclaw-plugin.mjs';
//       const sulcus = await connectSulcus({ databaseUrl: 'postgres://...' });
//
// NOTE: There is no SQL dialect split in this JS layer.  The JS side speaks
// exclusively Postgres-compatible SQL via PGlite.  The Rust binary uses
// a PGlite/Postgres-compatible storage backend, but that detail is hidden behind
// the MCP stdio protocol.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Re-export PGlite factory and tool helpers so callers only need one import.
export { createPGliteClient, compactToolDirectory, getToolSchema, TOOL_CATALOGUE }
  from './pglite-backend.mjs';

/**
 * Resolve the sulcus-local binary path.
 * Priority: release build → debug build → `cargo run` fallback.
 *
 * @param {string} cwd  Workspace root
 * @returns {{ cmd: string, args: string[] }}
 */
function resolveBinary(cwd) {
  const candidates = [
    path.join(cwd, 'target', 'release', 'sulcus-local'),
    path.join(cwd, 'target', 'debug', 'sulcus-local'),
  ];
  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); return { cmd: p, args: ['serve'] }; } catch {}
  }
  // No pre-built binary found — fall back to `cargo run` (slower but always works)
  return { cmd: 'cargo', args: ['run', '-p', 'sulcus-local', '--', 'serve'] };
}

/**
 * Connect to Sulcus via the compiled Rust sidecar binary.
 *
 * Prefer `createPGliteClient()` for new integrations — it requires no build step.
 * Use this when you need full fastembed vector embeddings or the complete
 * thermodynamics engine running in Rust.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd]           Workspace root (default: process.cwd())
 * @param {string} [opts.databaseUrl]   Postgres DSN for server mode.
 * @param {number} [opts.timeoutMs]     Per-request timeout (default: 30 000 ms)
 * @returns {Promise<SulcusClient>}
 */
export async function connectSulcus({
  cwd        = process.cwd(),
  databaseUrl,
  timeoutMs  = 30_000,
  autoSpawn  = true,
} = {}) {
  let child = null;
  let spawned = false;

  if (autoSpawn) {
    const env = { ...process.env };
    // Pass Postgres DSN if provided; otherwise the binary uses its own default.
    // Do NOT set local DB path env vars here — PGlite/Postgres is the target dialect.
    if (databaseUrl) env.DATABASE_URL = databaseUrl;

    const { cmd, args } = resolveBinary(cwd);
    child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    spawned = true;
  } else {
    throw new Error('connectSulcus currently requires autoSpawn=true; use createPGliteClient() for in-process mode');
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
    if (!req.jsonrpc) req.jsonrpc = '2.0';
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
      const res = await send({ method: 'tools/list' });
      return res.result?.tools ?? res.result ?? [];
    },
    /** Compact tool directory string (empty for Rust backend — use describeTools()). */
    toolDirectory: () => '',
    getToolSchema: async (name) => {
      const res   = await send({ method: 'tools/list' });
      const tools = res.result?.tools ?? res.result ?? [];
      return tools.find(t => t.name === name) ?? null;
    },
    addMemory: async (content) => {
      const res = await send({ method: 'tools/call', params: { name: 'add_memory', arguments: { content } } });
      const inner = JSON.parse(res.result.content[0].text);
      return inner?.node_id;
    },
    getActiveIndex: async (limit = 10) => {
      const res = await send({ method: 'resources/read', params: { uri: 'memory://active_index', limit } });
      const contents = res.result?.contents || [];
      const text = contents[0] && contents[0].text ? contents[0].text : '[]';
      return JSON.parse(text);
    },
    callTool: async (name, args = {}) => {
      const res  = await send({ method: 'tools/call', params: { name, arguments: args } });
      const text = res?.result?.content?.[0]?.text ?? '{}';
      try { return JSON.parse(text); } catch { return text; }
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
