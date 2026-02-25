#!/usr/bin/env node
// Smoke harness: verifies `openclaw` package is installed and then runs
// the repository's real Node MCP example against `sulcus-local`.

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const oc = await import('openclaw');
  const ocVer = oc?.version ?? oc?.default?.version ?? 'unknown';
  console.log('openclaw present:', ocVer);

  const provided = process.env.SULCUS_LOCAL_BIN;
  const defaultBin = path.resolve(__dirname, '../../target/debug/sulcus-local');
  const sulcusBin = provided || defaultBin;

  if (!fs.existsSync(sulcusBin)) {
    console.log('sulcus-local binary not found at', sulcusBin);
    console.log('building sulcus-local (cargo build -p sulcus-local)...');
    const build = spawnSync('cargo', ['build', '-p', 'sulcus-local'], { stdio: 'inherit' });
    if (build.status !== 0 || !fs.existsSync(sulcusBin)) {
      throw new Error('failed to build sulcus-local binary');
    }
  }

  const exampleScript = path.resolve(__dirname, '../../crates/sulcus-local/examples/openclaw-node/index.js');
  console.log('running OpenClaw node example:', exampleScript);

  const out = spawnSync('node', [exampleScript, sulcusBin], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: process.env,
    encoding: 'utf8',
  });

  if (out.stdout) process.stdout.write(out.stdout);
  if (out.stderr) process.stderr.write(out.stderr);

  if (out.status !== 0) {
    throw new Error(`openclaw-node example failed with code ${out.status}`);
  }

  if (!out.stdout.includes('OPENCLAW-OK')) {
    throw new Error('OPENCLAW-OK marker not found in output');
  }

  console.log('\n✅ OpenClaw smoke test passed (openclaw package + sulcus-local example)');
}

run().catch((err) => {
  console.error('\n❌ OpenClaw smoke test failed:', err);
  process.exit(1);
});
