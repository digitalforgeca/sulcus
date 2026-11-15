import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  detectSecretInText,
  installJunie,
  runDoctor,
  uninstallJunie,
} from '../bin/sulcus-junie.mjs';

test('sulcus-junie installer wires pure-Rust sulcus hook, enforces secret hygiene, and uninstalls cleanly', () => {
  const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'junie-install-test-'));
  try {
    fs.mkdirSync(path.join(tmpProj, '.idea'), { recursive: true });
    // Simulate legacy JS hook directory to confirm installer cleans it up
    const legacyDir = path.join(tmpProj, '.junie', 'sulcus');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'sulcus-junie-hook.mjs'), '// legacy');

    const installed = installJunie({ scope: 'project', projectDir: tmpProj, rubymine: true });
    assert.equal(fs.existsSync(legacyDir), false, 'legacy JS hook dir must be removed');
    assert.ok(fs.existsSync(installed.mcpPath));
    const mcpParsed = JSON.parse(fs.readFileSync(installed.mcpPath, 'utf8'));
    assert.deepEqual(mcpParsed.mcpServers.sulcus.args, ['mcp-proxy']);

    assert.ok(fs.existsSync(installed.configPath));
    const cfgParsed = JSON.parse(fs.readFileSync(installed.configPath, 'utf8'));
    assert.ok(
      JSON.stringify(cfgParsed.hooks).includes('sulcus hook --harness junie'),
      'hooks must delegate to pure-Rust sulcus hook --harness junie'
    );
    assert.ok(fs.existsSync(installed.guidelinesPath));
    assert.ok(fs.existsSync(path.join(tmpProj, '.idea', 'sulcus.json')));

    const cleanDoc = runDoctor({ projectDir: tmpProj });
    assert.equal(cleanDoc.ok, true);

    assert.ok(detectSecretInText('Bearer sk_live_' + '1234567890abcdefghij'));
    fs.writeFileSync(
      installed.mcpPath,
      JSON.stringify({ mcpServers: { sulcus: { env: { SULCUS_API_KEY: 'sk_live_' + '1234567890abcdefghij' } } } })
    );
    const dirtyDoc = runDoctor({ projectDir: tmpProj });
    assert.equal(dirtyDoc.ok, false);
    assert.ok(dirtyDoc.issues.some((i) => i.includes('Secret token')));

    uninstallJunie({ scope: 'project', projectDir: tmpProj });
    const afterCfg = JSON.parse(fs.readFileSync(installed.configPath, 'utf8'));
    assert.deepEqual(afterCfg.hooks, {});
  } finally {
    fs.rmSync(tmpProj, { recursive: true, force: true });
  }
});
