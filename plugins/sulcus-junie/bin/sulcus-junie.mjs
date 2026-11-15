#!/usr/bin/env node
/**
 * `sulcus-junie` Installer, Secret-Hygiene Auditor & Diagnostics CLI
 *
 * Wires JetBrains Junie / RubyMine directly to the pure-Rust `sulcus hook --harness junie`
 * and `sulcus mcp-proxy` subcommands (zero Node.js runtime hooks).
 *
 * Commands:
 *   sulcus-junie install [--global | --project] [--rubymine] [--dir <project_root>]
 *   sulcus-junie doctor  [--dir <project_root>]
 *   sulcus-junie status  [--dir <project_root>]
 *   sulcus-junie uninstall [--global | --project] [--dir <project_root>]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const GUIDELINES_SRC = path.join(PLUGIN_ROOT, 'guidelines', 'guidelines.md');
const SKILL_SRC = path.join(PLUGIN_ROOT, 'skills', 'sulcus', 'SKILL.md');
const PATH_PREFIX =
  'SULCUS_MODEL_CACHE_DIR="$HOME/.sulcus/models/fastembed" PATH="$HOME/.sulcus/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"';

const SECRET_TOKEN_REGEX = /\b(sk[-_][A-Za-z0-9_-]{16,}|si_[a-fA-F0-9]{32,}|sulcus_lic_[A-Za-z0-9._-]{24,})\b/;

export function detectSecretInText(text = '') {
  const m = String(text).match(SECRET_TOKEN_REGEX);
  return m ? m[1] : null;
}

function readJsonSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {}
  return {};
}

function writeJsonAtomic(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function buildHookEntries() {
  const mk = (eventName, timeout = 3000) => [
    {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: `${PATH_PREFIX} sulcus hook --harness junie ${eventName}`,
          timeout,
        },
      ],
    },
  ];
  return {
    SessionStart: mk('SessionStart', 3000),
    UserPromptSubmit: mk('UserPromptSubmit', 3000),
    PreToolUse: mk('PreToolUse', 2500),
    PostToolUse: mk('PostToolUse', 3000),
    PreCompact: mk('PreCompact', 3000),
    Stop: mk('Stop', 3000),
    SessionEnd: mk('SessionEnd', 3000),
  };
}

function isSulcusHookEntry(item) {
  const s = JSON.stringify(item);
  return (
    s.includes('sulcus hook --harness junie') ||
    s.includes('sulcus-junie-hook.mjs') ||
    s.includes('sulcus-jetbrains-bridge.mjs')
  );
}

function mergeSulcusHooks(existingConfig) {
  const out = { ...existingConfig };
  const hooks = typeof out.hooks === 'object' && out.hooks ? { ...out.hooks } : {};
  const desired = buildHookEntries();

  for (const [eventName, entries] of Object.entries(desired)) {
    const prev = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
    const filtered = prev.filter((item) => !isSulcusHookEntry(item));
    hooks[eventName] = [...filtered, ...entries];
  }
  out.hooks = hooks;
  return out;
}

function removeSulcusHooks(existingConfig) {
  const out = { ...existingConfig };
  if (!out.hooks || typeof out.hooks !== 'object') return out;
  const hooks = { ...out.hooks };
  for (const k of Object.keys(hooks)) {
    if (!Array.isArray(hooks[k])) continue;
    hooks[k] = hooks[k].filter((item) => !isSulcusHookEntry(item));
    if (hooks[k].length === 0) delete hooks[k];
  }
  out.hooks = hooks;
  return out;
}

function ensureGitignoreEntries(projectDir, entries) {
  const gitignorePath = path.join(projectDir, '.gitignore');
  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf8');
  }
  const lines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = entries.filter((e) => !lines.has(e));
  if (missing.length > 0) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    const block = `${prefix}# Sulcus local state & private MCP overrides\n${missing.join('\n')}\n`;
    fs.appendFileSync(gitignorePath, block, 'utf8');
  }
}

export function installJunie({
  scope = 'project',
  projectDir = process.cwd(),
  homeDir = os.homedir(),
  rubymine = false,
} = {}) {
  const baseJunieDir =
    scope === 'global' ? path.join(homeDir, '.junie') : path.join(projectDir, '.junie');

  // Remove legacy copied JS hook directory if upgrading from pre-1.2
  const legacyHookDir = path.join(baseJunieDir, 'sulcus');
  if (fs.existsSync(legacyHookDir)) {
    fs.rmSync(legacyHookDir, { recursive: true, force: true });
  }

  // 1. Configure zero-secret MCP (`sulcus mcp-proxy`)
  const mcpPath = path.join(baseJunieDir, 'mcp', 'mcp.json');
  const mcpCfg = readJsonSafe(mcpPath);
  mcpCfg.mcpServers = mcpCfg.mcpServers || {};
  mcpCfg.mcpServers.sulcus = {
    command: 'sulcus',
    args: ['mcp-proxy'],
  };
  writeJsonAtomic(mcpPath, mcpCfg);

  // 2. Configure pure-Rust Junie lifecycle hooks in config.json
  const configPath = path.join(baseJunieDir, 'config.json');
  const mergedCfg = mergeSulcusHooks(readJsonSafe(configPath));
  writeJsonAtomic(configPath, mergedCfg);

  // 3. Install skill
  const skillDest = path.join(baseJunieDir, 'skills', 'sulcus', 'SKILL.md');
  fs.mkdirSync(path.dirname(skillDest), { recursive: true });
  fs.copyFileSync(SKILL_SRC, skillDest);

  // 4. Project-specific guidelines & .gitignore secret protection
  let guidelinesPath = null;
  if (scope === 'project') {
    guidelinesPath = path.join(baseJunieDir, 'guidelines.md');
    const marker = '<!-- sulcus-junie-guidelines -->';
    const srcText = `${marker}\n${fs.readFileSync(GUIDELINES_SRC, 'utf8').trim()}\n${marker}\n`;
    if (fs.existsSync(guidelinesPath)) {
      const cur = fs.readFileSync(guidelinesPath, 'utf8');
      if (!cur.includes(marker)) {
        fs.writeFileSync(guidelinesPath, `${cur.trimEnd()}\n\n${srcText}`, 'utf8');
      }
    } else {
      fs.writeFileSync(guidelinesPath, srcText, 'utf8');
    }

    ensureGitignoreEntries(projectDir, [
      '.sulcus/',
      '.junie/mcp/mcp.local.json',
      '.junie/config.local.json',
    ]);

    if (rubymine) {
      const ideaDir = path.join(projectDir, '.idea');
      if (fs.existsSync(ideaDir)) {
        writeJsonAtomic(path.join(ideaDir, 'sulcus.json'), {
          enabled: true,
          harness: 'rubymine-junie',
          autoCaptureRspec: true,
          mcpConfig: '.junie/mcp/mcp.json',
        });
      }
    }
  }

  return {
    scope,
    baseJunieDir,
    mcpPath,
    configPath,
    guidelinesPath,
  };
}

export function runDoctor({ projectDir = process.cwd(), homeDir = os.homedir() } = {}) {
  const issues = [];
  const checks = [];

  let sulcusFound = false;
  for (const candidate of [
    'sulcus',
    path.join(homeDir, '.sulcus', 'bin', 'sulcus'),
    path.join(homeDir, '.cargo', 'bin', 'sulcus'),
  ]) {
    try {
      const ver = execFileSync(candidate, ['--version'], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      sulcusFound = true;
      checks.push(`sulcus binary: OK (${ver})`);
      break;
    } catch {}
  }
  if (!sulcusFound) {
    checks.push('sulcus binary: not on PATH (install via `curl -fsSL https://sulcus.ca/install.sh | bash`)');
  }

  const junieDir = path.join(projectDir, '.junie');
  if (fs.existsSync(junieDir)) {
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full);
        } else if (ent.isFile() && !ent.name.endsWith('.local.json')) {
          const content = fs.readFileSync(full, 'utf8');
          const leaked = detectSecretInText(content);
          if (leaked) {
            let ignored = false;
            try {
              execFileSync('git', ['check-ignore', '-q', full], {
                cwd: projectDir,
                stdio: 'ignore',
              });
              ignored = true;
            } catch {}
            if (!ignored) {
              issues.push(
                `Secret token (${leaked.slice(0, 7)}...) detected in unignored file ${path.relative(projectDir, full)}`
              );
            }
          }
        }
      }
    };
    walk(junieDir);
  }

  if (issues.length === 0) {
    checks.push('secret hygiene (.junie/): OK (zero plaintext credentials in tracked configs)');
  }

  return {
    ok: issues.length === 0,
    checks,
    issues,
  };
}

export function uninstallJunie({
  scope = 'project',
  projectDir = process.cwd(),
  homeDir = os.homedir(),
} = {}) {
  const baseJunieDir =
    scope === 'global' ? path.join(homeDir, '.junie') : path.join(projectDir, '.junie');
  const configPath = path.join(baseJunieDir, 'config.json');
  if (fs.existsSync(configPath)) {
    writeJsonAtomic(configPath, removeSulcusHooks(readJsonSafe(configPath)));
  }
  const mcpPath = path.join(baseJunieDir, 'mcp', 'mcp.json');
  if (fs.existsSync(mcpPath)) {
    const mcp = readJsonSafe(mcpPath);
    if (mcp.mcpServers && mcp.mcpServers.sulcus) {
      delete mcp.mcpServers.sulcus;
      writeJsonAtomic(mcpPath, mcp);
    }
  }
  const hookDir = path.join(baseJunieDir, 'sulcus');
  if (fs.existsSync(hookDir)) {
    fs.rmSync(hookDir, { recursive: true, force: true });
  }
  return { ok: true, baseJunieDir };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'status';
  const scope = args.includes('--global') ? 'global' : 'project';
  const rubymine = args.includes('--rubymine');
  const dirIdx = args.indexOf('--dir');
  const projectDir = dirIdx !== -1 && args[dirIdx + 1] ? path.resolve(args[dirIdx + 1]) : process.cwd();

  if (cmd === 'install') {
    const res = installJunie({ scope, projectDir, rubymine });
    console.log(`Installed Sulcus for Junie (${res.scope}):`);
    console.log(`  MCP Config:   ${res.mcpPath}`);
    console.log(`  Hooks Config: ${res.configPath} (pure-Rust sulcus hook --harness junie)`);
    if (res.guidelinesPath) console.log(`  Guidelines:   ${res.guidelinesPath}`);
  } else if (cmd === 'doctor') {
    const rep = runDoctor({ projectDir });
    for (const c of rep.checks) console.log(`  [OK] ${c}`);
    for (const iss of rep.issues) console.error(`  [FAIL] ${iss}`);
    process.exit(rep.ok ? 0 : 1);
  } else if (cmd === 'uninstall') {
    const res = uninstallJunie({ scope, projectDir });
    console.log(`Removed Sulcus Junie hooks & MCP entry from ${res.baseJunieDir}`);
  } else {
    const projMcp = path.join(projectDir, '.junie', 'mcp', 'mcp.json');
    const globMcp = path.join(os.homedir(), '.junie', 'mcp', 'mcp.json');
    console.log('Sulcus Junie Status:');
    console.log(`  Project (.junie/mcp/mcp.json): ${fs.existsSync(projMcp) ? 'configured' : 'not installed'}`);
    console.log(`  Global (~/.junie/mcp/mcp.json): ${fs.existsSync(globMcp) ? 'configured' : 'not installed'}`);
  }
}
