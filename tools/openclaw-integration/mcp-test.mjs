#!/usr/bin/env node
// Minimal harness: ensures `openclaw` is installed and uses Node to drive
// a short MCP-validating scenario against `sulcus-local serve`.

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const oc = await import('openclaw');
  const ocVer = oc?.version ?? oc?.default?.version ?? 'unknown';
  console.log('openclaw present:', ocVer);

  // locate sulcus-local binary (allow override)
  const provided = process.env.SULCUS_LOCAL_BIN;
  const defaultBin = path.resolve(__dirname, '../../target/debug/sulcus-local');
  const sulcusBin = provided || defaultBin;

  if (!fs.existsSync(sulcusBin)) {
    console.log('sulcus-local binary not found at', sulcusBin);
    console.log('building sulcus-local (cargo build -p sulcus-local)...');
    const r = spawnSync('cargo', ['build', '-p', 'sulcus-local'], { stdio: 'inherit' });
    if (r.status !== 0) {
      throw new Error('cargo build failed');
    }
    if (!fs.existsSync(sulcusBin)) {
      throw new Error('sulcus-local binary still missing after build');
    }
  }

  // Abort if a real `~/.sulcus/memory.db` already exists to avoid data loss.
  const userHome = os.homedir();
  const userDb = path.join(userHome, '.sulcus', 'memory.db');
  if (fs.existsSync(userDb)) {
    throw new Error(`refusing to run test: existing sulcus DB found at ${userDb}`);
  }

  // Run sulcus-local with the default HOME (safer + known-working path).
  // We already refused to run if a real `~/.sulcus/memory.db` exists above.
  const childEnv = { ...process.env };
  console.log('starting sulcus-local (stdio MCP) via `cargo run` in workspace root');

  // spawn via `cargo run` (cwd set to workspace root) so behavior matches manual runs
  const projectRoot = path.resolve(__dirname, '..', '..');
  const child = spawn('cargo', ['run', '-p', 'sulcus-local', '--', 'serve'], {
    env: childEnv,
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  child.on('exit', (code, sig) => {
    console.log(`sulcus-local exited code=${code} signal=${sig}`);
  });

  const rl = child.stdout.setEncoding('utf8');

  // helper to send JSON request and wait for next JSON line
  function send(req) {
    return new Promise((resolve, reject) => {
      const lineHandler = (chunk) => {
        for (const raw of chunk.split('\n').filter(Boolean)) {
          try {
            const v = JSON.parse(raw);
            // consume and return
            child.stdout.off('data', lineHandler);
            resolve(v);
            return;
          } catch (err) {
            // ignore non-JSON output lines
          }
        }
      };

      child.stdout.on('data', lineHandler);
      child.stdin.write(JSON.stringify(req) + '\n', (err) => {
        if (err) {
          child.stdout.off('data', lineHandler);
          reject(err);
        }
      });

      // timeout (raised to 10s for slower/dev machines)
      setTimeout(() => {
        child.stdout.off('data', lineHandler);
        reject(new Error('timeout waiting for response'));
      }, 10_000);
    });
  }

  try {
    // 1) describe_tools
    console.log('-> describe_tools');
    const desc = await send({ id: 't1', method: 'describe_tools' });
    if (!desc.result || !desc.result.tools) throw new Error('describe_tools failed');
    console.log('describe_tools OK');

    // 2) add_memory
    console.log('-> add_memory');
    const add = await send({ id: 'm1', method: 'add_memory', params: { content: 'openclaw test memory' } });
    const node_id = add?.result?.node_id;
    if (!node_id) throw new Error('add_memory failed');
    console.log('add_memory OK ->', node_id);

    // 3) resource active_index
    console.log('-> resource memory://active_index');
    const res = await send({ id: 'r1', method: 'resource', params: { resource: 'memory://active_index', limit: 10 } });
    const list = Array.isArray(res.result) ? res.result : [];
    const found = list.some(n => n.summary === 'openclaw test memory');
    if (!found) throw new Error('active_index did not contain added memory');
    console.log('resource OK — memory present in active_index');

    // signal success
    console.log('\n✅ MCP validation passed (openclaw-driven example)');
  } finally {
    // clean up
    try { child.kill(); } catch (e) { /* ignore */ }

    // remove the test DB we created under ~/.sulcus
    const userHome = os.homedir();
    const sulcusDir = path.join(userHome, '.sulcus');
    const defaultDb = path.join(sulcusDir, 'memory.db');
    try {
      if (fs.existsSync(defaultDb)) {
        fs.unlinkSync(defaultDb);
      }
      // remove the directory if empty
      try { fs.rmdirSync(sulcusDir); } catch (e) { /* ignore if not empty */ }
    } catch (e) {
      console.warn('cleanup failed:', e);
    }
  }
}

run().catch(err => {
  console.error('\n❌ MCP validation failed:', err);
  process.exit(1);
});
