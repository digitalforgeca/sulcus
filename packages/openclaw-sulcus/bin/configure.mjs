#!/usr/bin/env node
/**
 * Sulcus Configuration Wizard
 * Interactive CLI to configure Sulcus for multiple AI tools.
 *
 * Usage:
 *   npx @digitalforgestudios/openclaw-sulcus configure             # OpenClaw
 *   npx @digitalforgestudios/openclaw-sulcus configure --claude    # Claude CLI / Claude Code
 *   npx @digitalforgestudios/openclaw-sulcus configure --openai    # OpenAI Codex CLI
 *   npx @digitalforgestudios/openclaw-sulcus configure --gemini    # Google Gemini CLI
 *   node bin/configure.mjs [--no-color] [--help]
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { execSync } from 'child_process';

// ─── Colour support ───────────────────────────────────────────────────────────

const noColor =
  process.argv.includes('--no-color') ||
  process.env.NO_COLOR !== undefined ||
  !process.stdout.isTTY;

const c = {
  reset:   noColor ? '' : '\x1b[0m',
  bold:    noColor ? '' : '\x1b[1m',
  dim:     noColor ? '' : '\x1b[2m',
  red:     noColor ? '' : '\x1b[31m',
  green:   noColor ? '' : '\x1b[32m',
  yellow:  noColor ? '' : '\x1b[33m',
  blue:    noColor ? '' : '\x1b[34m',
  magenta: noColor ? '' : '\x1b[35m',
  cyan:    noColor ? '' : '\x1b[36m',
  white:   noColor ? '' : '\x1b[37m',
};

const bold    = (s) => `${c.bold}${s}${c.reset}`;
const dim     = (s) => `${c.dim}${s}${c.reset}`;
const green   = (s) => `${c.green}${s}${c.reset}`;
const yellow  = (s) => `${c.yellow}${s}${c.reset}`;
const red     = (s) => `${c.red}${s}${c.reset}`;
const cyan    = (s) => `${c.cyan}${s}${c.reset}`;
const magenta = (s) => `${c.magenta}${s}${c.reset}`;

// ─── Mode detection ───────────────────────────────────────────────────────────

const MODE_OPENCLAW = 'openclaw';
const MODE_CLAUDE   = 'claude';
const MODE_OPENAI   = 'openai';
const MODE_GEMINI   = 'gemini';

function detectMode() {
  if (process.argv.includes('--claude')) return MODE_CLAUDE;
  if (process.argv.includes('--openai')) return MODE_OPENAI;
  if (process.argv.includes('--gemini')) return MODE_GEMINI;
  return MODE_OPENCLAW;
}

// ─── Help ─────────────────────────────────────────────────────────────────────

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
${bold('Sulcus Configuration Wizard')}

Interactively configure Sulcus as an MCP server for your AI tools.

${bold('Usage:')}
  npx @digitalforgestudios/openclaw-sulcus configure [mode] [options]
  node bin/configure.mjs [mode] [options]

${bold('Modes:')}
  ${dim('(no flag)')}      Configure for ${cyan('OpenClaw')} (openclaw.json)
  ${cyan('--claude')}       Configure for ${cyan('Claude CLI / Claude Code')}  (~/.claude/claude_desktop_config.json)
  ${cyan('--openai')}       Configure for ${cyan('OpenAI Codex CLI')}           (~/.codex/config.toml)
  ${cyan('--gemini')}       Configure for ${cyan('Google Gemini CLI')}          (~/.gemini/settings.json)

${bold('Options:')}
  --help, -h      Show this help message
  --no-color      Disable coloured output

${bold('OpenClaw mode (default):')}
  1. Locates your openclaw.json (checks $OPENCLAW_CONFIG_PATH, ~/.openclaw/, ./)
  2. Walks you through backend mode, dylib path, namespace, hooks, and tools
  3. Deep-merges settings under plugins.entries.openclaw-sulcus.config
  4. Validates that your native dylibs exist and warns if they are missing
  5. Reminds you to restart the OpenClaw gateway

${bold('MCP server modes (--claude / --openai / --gemini):')}
  1. Detects if the target CLI is installed
  2. Asks: Cloud mode (Sulcus API) or Local mode (binary path)?
  3. Merges the sulcus MCP server entry into the target config
  4. Preserves all existing config settings

${bold('Examples:')}
  npx @digitalforgestudios/openclaw-sulcus configure
  npx @digitalforgestudios/openclaw-sulcus configure --claude
  npx @digitalforgestudios/openclaw-sulcus configure --openai
  npx @digitalforgestudios/openclaw-sulcus configure --gemini
`);
  process.exit(0);
}

// ─── Readline helpers ─────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
});

// Graceful Ctrl+C
rl.on('SIGINT', () => {
  console.log(`\n\n${yellow('⚡ Wizard cancelled — no changes were written.')}\n`);
  process.exit(0);
});

/**
 * Prompt the user with an optional default value.
 * Returns the trimmed answer, or the default if empty.
 */
function ask(question, defaultValue = '') {
  return new Promise((resolve) => {
    const hint = defaultValue !== '' ? dim(` [${defaultValue}]`) : '';
    rl.question(`${question}${hint} `, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed === '' ? defaultValue : trimmed);
    });
  });
}

/**
 * Ask a yes/no question. Returns boolean.
 */
function askYN(question, defaultVal = false) {
  return new Promise((resolve) => {
    const hint = dim(` [${defaultVal ? 'Y/n' : 'y/N'}]`);
    rl.question(`  ${question}${hint} `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultVal);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function expandHome(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

// Deep-merge two plain objects (target mutated).
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ─── Binary detection (sulcus executable) ────────────────────────────────────

const SULCUS_BINARY_SEARCH_PATHS = [
  path.join(os.homedir(), '.sulcus', 'bin', 'sulcus'),
  path.join(os.homedir(), '.local', 'bin', 'sulcus'),
  '/usr/local/bin/sulcus',
];

/**
 * Try to locate the sulcus binary.
 * Returns the absolute path if found, or null.
 */
function findSulcusBinary() {
  for (const p of SULCUS_BINARY_SEARCH_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const result = execSync('which sulcus', { stdio: 'pipe' }).toString().trim();
    if (result && fs.existsSync(result)) return result;
  } catch (_) {
    // not on PATH
  }
  return null;
}

/**
 * Check if a CLI tool is installed by running `which <name>`.
 */
function isCliInstalled(name) {
  try {
    execSync(`which ${name}`, { stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
}

// ─── JSON config helpers ──────────────────────────────────────────────────────

function readJsonConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeJsonConfig(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── Minimal hand-rolled TOML helpers ────────────────────────────────────────
// Supports the subset needed for ~/.codex/config.toml:
//   - Bare/quoted string values, integers, booleans
//   - Arrays of quoted strings: key = ["a", "b"]
//   - [table] and [table.subtable] headers
//   - # line comments

function parseToml(src) {
  const lines = src.split('\n');
  const root = {};
  let current = root;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Table header: [a.b.c]
    const tableMatch = line.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      const parts = tableMatch[1].trim().split('.').map(s => s.trim());
      current = root;
      for (const part of parts) {
        if (current[part] === undefined) current[part] = {};
        else if (typeof current[part] !== 'object' || Array.isArray(current[part])) {
          current[part] = {};
        }
        current = current[part];
      }
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let valStr = line.slice(eqIdx + 1).trim();
    let value;

    if (valStr.startsWith('[')) {
      // Array of strings
      const inner = valStr.slice(1, valStr.lastIndexOf(']'));
      value = inner
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(s => s.length > 0);
    } else if (valStr.startsWith('"') || valStr.startsWith("'")) {
      const q = valStr[0];
      const end = valStr.indexOf(q, 1);
      value = end === -1 ? valStr.slice(1) : valStr.slice(1, end);
    } else if (valStr === 'true') {
      value = true;
    } else if (valStr === 'false') {
      value = false;
    } else {
      const commentIdx = valStr.indexOf('#');
      if (commentIdx !== -1) valStr = valStr.slice(0, commentIdx).trim();
      const num = Number(valStr);
      value = isNaN(num) || valStr === '' ? valStr : num;
    }

    current[key] = value;
  }

  return root;
}

function serializeToml(obj, prefix = []) {
  const scalarLines = [];
  const subTables = [];

  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) continue;

    if (Array.isArray(val)) {
      const items = val.map(v => JSON.stringify(String(v))).join(', ');
      scalarLines.push(`${key} = [${items}]`);
    } else if (typeof val === 'object') {
      subTables.push([key, val]);
    } else if (typeof val === 'string') {
      scalarLines.push(`${key} = ${JSON.stringify(val)}`);
    } else {
      scalarLines.push(`${key} = ${val}`);
    }
  }

  const parts = [...scalarLines];

  for (const [key, val] of subTables) {
    const tablePath = [...prefix, key];
    parts.push('');
    parts.push(`[${tablePath.join('.')}]`);
    const inner = serializeToml(val, tablePath);
    if (inner) parts.push(inner);
  }

  return parts.join('\n');
}

function readTomlConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return parseToml(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeTomlConfig(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = serializeToml(data).trimStart() + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

// ─── Shared MCP server config prompts ────────────────────────────────────────

/**
 * Ask cloud vs local, collect info, return an MCP server config object:
 * { command, args, env? }
 */
async function askMcpServerConfig() {
  console.log();
  console.log(`  ${bold('Mode:')}`);
  console.log(`    ${cyan('[1]')} Cloud  ${dim('(Sulcus API — requires server URL + API key)')}`);
  console.log(`    ${cyan('[2]')} Local  ${dim('(sulcus binary installed on this machine)')}`);
  const modeRaw = await ask(`  >`, '1');
  const isCloud = modeRaw !== '2';
  console.log();

  if (isCloud) {
    const serverUrl = await ask(
      `  ${bold('Sulcus server URL:')}`,
      'https://api.sulcus.ca',
    );
    const apiKey = await ask(`  ${bold('Sulcus API key')} ${dim('(sk-...)')}:`, '');
    console.log();

    const env = {};
    if (serverUrl) env.SULCUS_SERVER_URL = serverUrl;
    if (apiKey)    env.SULCUS_API_KEY    = apiKey;

    return {
      command: expandHome('~/.sulcus/bin/sulcus'),
      args: ['stdio'],
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  } else {
    // Local mode — detect binary
    const detected = findSulcusBinary();
    if (detected) {
      console.log(`  ${green('✓')} Found sulcus binary: ${cyan(detected)}`);
    } else {
      console.log(`  ${yellow('⚠')}  sulcus binary not found in common locations.`);
      console.log(`  ${dim('Search paths checked:')}`);
      for (const p of SULCUS_BINARY_SEARCH_PATHS) {
        console.log(`    ${dim('•')} ${dim(p)}`);
      }
      console.log(`  ${dim('Download from:')} ${cyan('https://github.com/digitalforgeca/sulcus/releases/latest')}`);
      console.log();
    }

    const binaryPath = await ask(
      `  ${bold('Path to sulcus binary:')}`,
      detected || expandHome('~/.sulcus/bin/sulcus'),
    );
    console.log();

    const wantCloudEnv = await askYN(
      'Also add SULCUS_SERVER_URL / SULCUS_API_KEY? (for cloud sync)',
      false,
    );
    console.log();

    let env;
    if (wantCloudEnv) {
      const serverUrl = await ask(
        `  ${bold('Sulcus server URL:')}`,
        'https://api.sulcus.ca',
      );
      const apiKey = await ask(`  ${bold('Sulcus API key')} ${dim('(sk-...)')}:`, '');
      console.log();
      const e = {};
      if (serverUrl) e.SULCUS_SERVER_URL = serverUrl;
      if (apiKey)    e.SULCUS_API_KEY    = apiKey;
      if (Object.keys(e).length > 0) env = e;
    }

    return {
      command: binaryPath,
      args: ['stdio'],
      ...(env ? { env } : {}),
    };
  }
}

/**
 * Print an MCP server summary block.
 */
function printMcpSummary(toolName, configFile, serverCfg) {
  const displayFile = configFile.replace(os.homedir(), '~');
  console.log(`  ${dim('──── Summary ────────────────────────────────────────')}`);
  console.log(`  Tool:       ${cyan(toolName)}`);
  console.log(`  Config:     ${cyan(displayFile)}`);
  console.log(`  MCP server: ${cyan('sulcus')}`);
  console.log(`  Command:    ${cyan(serverCfg.command)}`);
  console.log(`  Args:       ${cyan(serverCfg.args.join(', '))}`);
  if (serverCfg.env && Object.keys(serverCfg.env).length > 0) {
    for (const [k, v] of Object.entries(serverCfg.env)) {
      const display = k === 'SULCUS_API_KEY' && v && v.length > 8
        ? v.slice(0, 8) + '...'
        : v;
      console.log(`  ${k}: ${cyan(display)}`);
    }
  }
  console.log(`  ${dim('─────────────────────────────────────────────────────')}`);
  console.log();
}

// ─── Claude wizard ────────────────────────────────────────────────────────────

async function runClaudeWizard() {
  const configFile = expandHome('~/.claude/claude_desktop_config.json');

  console.log(`
${bold(magenta('🧠  Sulcus → Claude CLI Configuration Wizard'))}
${dim('──────────────────────────────────────────────────────')}
Configures Sulcus as an MCP server for ${cyan('Claude CLI / Claude Code')}.
Config file: ${cyan('~/.claude/claude_desktop_config.json')}
Press ${bold('Enter')} to accept defaults. ${bold('Ctrl+C')} to cancel at any time.
`);

  // Detect claude CLI
  const claudeInstalled = isCliInstalled('claude');
  if (claudeInstalled) {
    console.log(`  ${green('✓')} claude CLI detected on PATH`);
  } else {
    console.log(`  ${yellow('⚠')}  claude CLI not found on PATH`);
    console.log(`  ${dim('Install Claude Code from:')} ${cyan('https://claude.ai/download')}`);
  }

  const serverCfg = await askMcpServerConfig();

  console.log(`${bold('Writing config...')}`);

  let existing = readJsonConfig(configFile);
  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.sulcus = serverCfg;

  try {
    writeJsonConfig(configFile, existing);
  } catch (err) {
    console.log(`  ${red('✗')} Failed to write ${cyan(configFile)}: ${err.message}`);
    rl.close();
    process.exit(1);
  }

  console.log(`  ${green('✓')} Written to ${cyan(configFile.replace(os.homedir(), '~'))}`);
  console.log();

  printMcpSummary('Claude CLI / Claude Code', configFile, serverCfg);

  console.log(`  ${bold(green('✅  Configuration complete!'))} Restart Claude to pick up changes.`);
  console.log();

  rl.close();
}

// ─── OpenAI Codex wizard ──────────────────────────────────────────────────────

async function runOpenAIWizard() {
  const configFile = expandHome('~/.codex/config.toml');

  console.log(`
${bold(magenta('🧠  Sulcus → OpenAI Codex CLI Configuration Wizard'))}
${dim('────────────────────────────────────────────────────────')}
Configures Sulcus as an MCP server for ${cyan('OpenAI Codex CLI')}.
Config file: ${cyan('~/.codex/config.toml')}
Press ${bold('Enter')} to accept defaults. ${bold('Ctrl+C')} to cancel at any time.
`);

  // Detect codex CLI
  const codexInstalled = isCliInstalled('codex');
  if (codexInstalled) {
    console.log(`  ${green('✓')} codex CLI detected on PATH`);
  } else {
    console.log(`  ${yellow('⚠')}  codex CLI not found on PATH`);
    console.log(`  ${dim('Install from:')} ${cyan('https://github.com/openai/codex')}`);
  }

  const serverCfg = await askMcpServerConfig();

  console.log(`${bold('Writing config...')}`);

  // Read existing TOML and merge in the sulcus entry
  let existing = readTomlConfig(configFile);
  if (!existing.mcp_servers) existing.mcp_servers = {};
  existing.mcp_servers.sulcus = {
    command: serverCfg.command,
    args: serverCfg.args,
    ...(serverCfg.env && Object.keys(serverCfg.env).length > 0
      ? { env: serverCfg.env }
      : {}),
  };

  try {
    writeTomlConfig(configFile, existing);
  } catch (err) {
    console.log(`  ${red('✗')} Failed to write ${cyan(configFile)}: ${err.message}`);
    rl.close();
    process.exit(1);
  }

  console.log(`  ${green('✓')} Written to ${cyan(configFile.replace(os.homedir(), '~'))}`);
  console.log();

  printMcpSummary('OpenAI Codex CLI', configFile, serverCfg);

  console.log(`  ${bold(green('✅  Configuration complete!'))} Restart Codex to pick up changes.`);
  console.log();

  rl.close();
}

// ─── Gemini wizard ────────────────────────────────────────────────────────────

async function runGeminiWizard() {
  const configFile = expandHome('~/.gemini/settings.json');

  console.log(`
${bold(magenta('🧠  Sulcus → Google Gemini CLI Configuration Wizard'))}
${dim('──────────────────────────────────────────────────────────')}
Configures Sulcus as an MCP server for ${cyan('Google Gemini CLI')}.
Config file: ${cyan('~/.gemini/settings.json')}
Press ${bold('Enter')} to accept defaults. ${bold('Ctrl+C')} to cancel at any time.
`);

  // Detect gemini CLI
  const geminiInstalled = isCliInstalled('gemini');
  if (geminiInstalled) {
    console.log(`  ${green('✓')} gemini CLI detected on PATH`);
  } else {
    console.log(`  ${yellow('⚠')}  gemini CLI not found on PATH`);
    console.log(`  ${dim('Install from:')} ${cyan('https://github.com/google-gemini/gemini-cli')}`);
  }

  const serverCfg = await askMcpServerConfig();

  console.log(`${bold('Writing config...')}`);

  let existing = readJsonConfig(configFile);
  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.sulcus = serverCfg;

  try {
    writeJsonConfig(configFile, existing);
  } catch (err) {
    console.log(`  ${red('✗')} Failed to write ${cyan(configFile)}: ${err.message}`);
    rl.close();
    process.exit(1);
  }

  console.log(`  ${green('✓')} Written to ${cyan(configFile.replace(os.homedir(), '~'))}`);
  console.log();

  printMcpSummary('Google Gemini CLI', configFile, serverCfg);

  console.log(`  ${bold(green('✅  Configuration complete!'))} Restart Gemini CLI to pick up changes.`);
  console.log();

  rl.close();
}

// ─── openclaw.json discovery ──────────────────────────────────────────────────

function findOpenclawJson() {
  const candidates = [
    process.env.OPENCLAW_CONFIG_PATH,
    path.join(os.homedir(), '.openclaw', 'openclaw.json'),
    path.join(process.cwd(), 'openclaw.json'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = expandHome(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

// ─── Prebuilt binary download (dylibs for OpenClaw mode) ─────────────────────

function detectPlatform() {
  const plat = process.platform;
  const arch = process.arch;

  const ext = plat === 'darwin' ? '.dylib' : '.so';

  if (plat === 'darwin' && arch === 'arm64') return { platform: 'macos-arm64', ext };
  if (plat === 'darwin' && arch === 'x64')   return { platform: 'macos-x64',   ext };
  if (plat === 'linux'  && arch === 'x64')   return { platform: 'linux-x64',   ext };
  if (plat === 'linux'  && arch === 'arm64') return { platform: 'linux-arm64', ext };

  throw new Error(
    `Prebuilt binaries are not available for your platform (${plat}/${arch}).\n` +
    `  Supported: darwin/arm64, darwin/x64, linux/x64, linux/arm64`,
  );
}

function downloadFile(url, destFile, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    let hops = 0;

    function attempt(currentUrl) {
      if (hops > maxRedirects) {
        return reject(new Error('Too many redirects while downloading'));
      }
      hops++;

      const parsed = new URL(currentUrl);
      const opts = {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers:  { 'User-Agent': 'sulcus-configure/1.0' },
      };

      const req = https.request(opts, (res) => {
        const { statusCode, headers: resHeaders } = res;

        if (
          (statusCode === 301 || statusCode === 302 ||
           statusCode === 307 || statusCode === 308) &&
          resHeaders.location
        ) {
          res.resume();
          return attempt(resHeaders.location);
        }

        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} for ${currentUrl}`));
        }

        const total   = parseInt(resHeaders['content-length'] || '0', 10);
        let received  = 0;
        let lastPct   = -1;

        const out = fs.createWriteStream(destFile);

        res.on('data', (chunk) => {
          received += chunk.length;
          out.write(chunk);

          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            if (pct !== lastPct && pct % 5 === 0) {
              lastPct = pct;
              process.stdout.write(`\r    Downloading... ${pct}%   `);
            }
          } else {
            if (received % (64 * 1024) === 0) process.stdout.write('.');
          }
        });

        res.on('end', () => {
          out.end(() => {
            process.stdout.write(`\r    Downloaded ${(received / 1024 / 1024).toFixed(1)} MB    \n`);
            resolve();
          });
        });

        res.on('error', (err) => {
          out.destroy();
          reject(err);
        });
      });

      req.on('error', reject);
      req.end();
    }

    attempt(url);
  });
}

async function downloadAndInstallBinaries(resolvedLibDir, dylibNames) {
  let platformInfo;
  try {
    platformInfo = detectPlatform();
  } catch (err) {
    console.log(`  ${yellow('⚠')}  ${err.message}`);
    return false;
  }

  const { platform, ext } = platformInfo;
  const displayDir = resolvedLibDir.replace(os.homedir(), '~');
  const tarUrl = `https://github.com/digitalforgeca/sulcus/releases/latest/download/sulcus-${platform}.tar.gz`;

  console.log();
  console.log(`  ${yellow('⚠')}  Native libraries not found at ${cyan(displayDir)}`);
  console.log(`  ${dim(`Download prebuilt binaries for ${bold(platform)}?`)}`);

  const doDownload = await askYN(`Download prebuilt binaries for ${platform}?`, true);
  if (!doDownload) {
    console.log(`  ${dim('Skipped. Install dylibs manually to use Sulcus.')}`);
    return false;
  }

  try {
    fs.mkdirSync(resolvedLibDir, { recursive: true });
  } catch (err) {
    console.log(`  ${red('✗')} Cannot create ${cyan(resolvedLibDir)}: ${err.message}`);
    console.log(`  ${dim('Try running with appropriate permissions.')}`);
    return false;
  }


  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'sulcus-'));
  const tarPath = path.join(tmpDir, `sulcus-${platform}.tar.gz`);

  console.log(`  ${dim(`→ ${tarUrl}`)}`);
  process.stdout.write(`    Downloading...`);

  try {
    await downloadFile(tarUrl, tarPath);
  } catch (err) {
    console.log(`  ${red('✗')} Download failed: ${err.message}`);
    console.log(`  ${dim('Check your internet connection or download manually:')}`);
    console.log(`    ${cyan(tarUrl)}`);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    return false;
  }

  console.log(`    Extracting...`);
  try {
    execSync(`tar xzf ${JSON.stringify(tarPath)} -C ${JSON.stringify(tmpDir)}`, { stdio: 'pipe' });
  } catch (err) {
    console.log(`  ${red('✗')} Extraction failed: ${err.message}`);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    return false;
  }

  let allInstalled = true;
  for (const lib of dylibNames) {
    const srcFile  = path.join(tmpDir, lib + ext);
    const destFile = path.join(resolvedLibDir, lib + ext);

    if (!fs.existsSync(srcFile)) {
      console.log(`  ${yellow('⚠')}  ${lib + ext} not found in tarball`);
      allInstalled = false;
      continue;
    }

    try {
      fs.copyFileSync(srcFile, destFile);
      console.log(`  ${green('✓')} Installed: ${dim(destFile)}`);
    } catch (err) {
      console.log(`  ${red('✗')} Failed to install ${lib + ext}: ${err.message}`);
      if (err.code === 'EACCES') {
        console.log(`  ${dim('Try running with appropriate permissions (e.g. sudo).')}`);
      }
      allInstalled = false;
    }
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  return allInstalled;
}

// ─── OpenClaw wizard (original, unchanged) ───────────────────────────────────

async function runOpenclawWizard() {
  console.log(`
${bold(magenta('🧠  Sulcus Configuration Wizard'))}
${dim('────────────────────────────────────────────')}
Configures the ${cyan('openclaw-sulcus')} plugin inside your ${cyan('openclaw.json')}.
Press ${bold('Enter')} to accept defaults. ${bold('Ctrl+C')} to cancel at any time.
`);

  // ── Step 1: Locate openclaw.json ─────────────────────────────────────────

  console.log(`${bold('Step 1 · Locate openclaw.json')}`);

  let configPath = findOpenclawJson();

  if (configPath) {
    console.log(`  ${green('✓')} Found: ${cyan(configPath)}\n`);
  } else {
    console.log(`  ${yellow('⚠')}  Could not find openclaw.json in the usual locations.`);
    console.log(`     Checked:`);
    if (process.env.OPENCLAW_CONFIG_PATH)
      console.log(`       • $OPENCLAW_CONFIG_PATH → ${process.env.OPENCLAW_CONFIG_PATH}`);
    console.log(`       • ~/.openclaw/openclaw.json`);
    console.log(`       • ./openclaw.json\n`);

    const choice = await ask(
      `  Enter full path to openclaw.json, or press Enter to create ~/.openclaw/openclaw.json:`,
      path.join(os.homedir(), '.openclaw', 'openclaw.json'),
    );
    configPath = expandHome(choice);

    if (!fs.existsSync(configPath)) {
      const dir = path.dirname(configPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({}, null, 2), 'utf8');
      console.log(`  ${green('✓')} Created: ${cyan(configPath)}\n`);
    } else {
      console.log(`  ${green('✓')} Using: ${cyan(configPath)}\n`);
    }
  }

  let existingConfig = {};
  try {
    existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.log(`  ${red('✗')} Failed to parse openclaw.json: ${err.message}`);
    console.log(`  Fix the JSON syntax and re-run the wizard.\n`);
    rl.close();
    process.exit(1);
  }

  // ── Step 2: Wizard questions ─────────────────────────────────────────────

  console.log(`${bold('Step 2 · Configure Sulcus')}`);
  console.log();

  console.log(`  ${bold('Backend mode:')}`);
  console.log(`    ${cyan('[1]')} Local only ${dim('(WASM + native dylibs, no network)')}`);
  console.log(`    ${cyan('[2]')} Cloud sync  ${dim('(local + server replication)')}`);
  const modeRaw = await ask(`  >`, '1');
  const cloudSync = modeRaw === '2';
  console.log();

  const libDirDefault = '~/.sulcus/lib';
  const libDirRaw = await ask(
    `  ${bold('Where are your native dylibs?')}`,
    libDirDefault,
  );
  const libDir = libDirRaw;
  console.log();

  const namespace = await ask(`  ${bold('Agent namespace:')}`, 'default');
  console.log();

  console.log(`  ${bold('Enable hooks:')}`);
  const injectAwareness = await askYN(
    'Inject memory awareness into prompts? (before_prompt_build)',
    false,
  );
  const autoRecall = await askYN(
    'Auto-recall memories on each turn? (before_agent_start)',
    false,
  );
  console.log();

  console.log(`  ${bold('Enable tools:')}`);
  const toolMemoryRecall    = await askYN('memory_recall    — search memories',               true);
  const toolMemoryStore     = await askYN('memory_store     — save memories',                 true);
  const toolMemoryStatus    = await askYN('memory_status    — check memory stats',            true);
  const toolConsolidate     = await askYN('consolidate      — cluster similar memories',      false);
  const toolExportMarkdown  = await askYN('export_markdown  — export memories as markdown',   false);
  const toolImportMarkdown  = await askYN('import_markdown  — import from markdown',          false);
  const toolEvalTriggers    = await askYN('evaluate_triggers — reactive trigger engine',      false);
  console.log();

  let serverUrl = '';
  let apiKey    = '';
  if (cloudSync) {
    console.log(`  ${bold('Cloud sync settings:')}`);
    serverUrl = await ask(`  Server URL:`, 'https://api.sulcus.ca');
    apiKey    = await ask(`  API Key:`,    '');
    console.log();
  }

  // ── Step 3: Build and write config ──────────────────────────────────────

  console.log(`${bold('Step 3 · Write openclaw.json')}`);

  const sulcusConfig = {
    libDir,
    namespace: namespace === 'default' ? undefined : namespace,
    ...(cloudSync && serverUrl ? { serverUrl } : {}),
    ...(cloudSync && apiKey    ? { apiKey }    : {}),
    hooks: {
      before_prompt_build: { action: 'inject_awareness', enabled: injectAwareness },
      before_agent_start:  { action: 'auto_recall',      enabled: autoRecall, limit: 5, minScore: 0.3 },
    },
    tools: {
      memory_recall:     { enabled: toolMemoryRecall },
      memory_store:      { enabled: toolMemoryStore },
      memory_status:     { enabled: toolMemoryStatus },
      consolidate:       { enabled: toolConsolidate },
      export_markdown:   { enabled: toolExportMarkdown },
      import_markdown:   { enabled: toolImportMarkdown },
      evaluate_triggers: { enabled: toolEvalTriggers },
    },
  };

  Object.keys(sulcusConfig).forEach(
    (k) => sulcusConfig[k] === undefined && delete sulcusConfig[k],
  );

  const merged = deepMerge(existingConfig, {
    plugins: {
      entries: {
        'openclaw-sulcus': {
          enabled: true,
          config: sulcusConfig,
        },
      },
    },
  });

  let written = false;
  try {
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    written = true;
  } catch (err) {
    console.log(`  ${red('✗')} Failed to write ${configPath}: ${err.message}\n`);
    rl.close();
    process.exit(1);
  }

  if (written) {
    console.log(`  ${green('✓')} Written to ${cyan(configPath)}`);
    console.log();

    console.log(`  ${dim('──── Summary ────────────────────────────────────')}`);
    console.log(`  Plugin:    ${cyan('openclaw-sulcus')}  ${green('enabled')}`);
    console.log(`  Backend:   ${cyan(cloudSync ? 'cloud sync' : 'local only')}`);
    console.log(`  Dylib dir: ${cyan(libDir)}`);
    console.log(`  Namespace: ${cyan(namespace)}`);
    if (cloudSync && serverUrl) console.log(`  Server:    ${cyan(serverUrl)}`);

    const enabledHooks = [];
    if (injectAwareness) enabledHooks.push('before_prompt_build');
    if (autoRecall)      enabledHooks.push('before_agent_start');
    console.log(`  Hooks:     ${enabledHooks.length ? cyan(enabledHooks.join(', ')) : dim('(none enabled)')}`);

    const enabledTools = [
      toolMemoryRecall    && 'memory_recall',
      toolMemoryStore     && 'memory_store',
      toolMemoryStatus    && 'memory_status',
      toolConsolidate     && 'consolidate',
      toolExportMarkdown  && 'export_markdown',
      toolImportMarkdown  && 'import_markdown',
      toolEvalTriggers    && 'evaluate_triggers',
    ].filter(Boolean);
    console.log(`  Tools:     ${enabledTools.length ? cyan(enabledTools.join(', ')) : dim('(none enabled)')}`);
    console.log(`  ${dim('─────────────────────────────────────────────────')}`);
    console.log();
  }

  // ── Step 4: Validate dylib path (+ auto-download if missing) ────────────

  console.log(`${bold('Step 4 · Validate')}`);

  const resolvedLibDir = expandHome(libDir);
  const dylibNames = ['libsulcus_store', 'libsulcus_vectors'];
  const ext = process.platform === 'darwin' ? '.dylib'
            : process.platform === 'win32'  ? '.dll'
            :                                 '.so';

  function checkDylibs() {
    if (!fs.existsSync(resolvedLibDir)) return false;
    return dylibNames.every((lib) => fs.existsSync(path.join(resolvedLibDir, lib + ext)));
  }

  let dylibsOk = checkDylibs();

  if (dylibsOk) {
    for (const lib of dylibNames) {
      console.log(`  ${green('✓')} Found: ${dim(path.join(resolvedLibDir, lib + ext))}`);
    }
  } else {
    const downloaded = await downloadAndInstallBinaries(resolvedLibDir, dylibNames);

    if (downloaded) {
      dylibsOk = checkDylibs();
      if (!dylibsOk) {
        console.log(`  ${yellow('⚠')}  Some dylibs still missing after installation.`);
      }
    } else if (!downloaded) {
      if (fs.existsSync(resolvedLibDir)) {
        for (const lib of dylibNames) {
          const full = path.join(resolvedLibDir, lib + ext);
          if (fs.existsSync(full)) {
            console.log(`  ${green('✓')} Found: ${dim(full)}`);
          } else {
            console.log(`  ${yellow('⚠')}  Missing: ${dim(full)}`);
          }
        }
      }
      console.log();
      console.log(`  ${yellow(bold('Native dylibs missing — Sulcus will not load.'))}`);
      console.log(`  Download manually from:`);
      console.log(`    ${cyan('https://github.com/digitalforgeca/sulcus/releases/latest')}`);
      console.log(`  Or visit: ${cyan('https://sulcus.ca/docs/install')}`);
    }
  }

  if (dylibsOk) {
    console.log(`  ${green('✓')} All dylibs present — Sulcus is ready to go.`);
  }

  console.log();
  console.log(`  ${bold(green('✅  Configuration complete!'))} Restart the OpenClaw gateway to pick up changes:`);
  console.log(`     ${cyan('openclaw gateway restart')}`);
  console.log();

  rl.close();
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function run() {
  const mode = detectMode();

  switch (mode) {
    case MODE_CLAUDE:  return runClaudeWizard();
    case MODE_OPENAI:  return runOpenAIWizard();
    case MODE_GEMINI:  return runGeminiWizard();
    default:           return runOpenclawWizard();
  }
}

run().catch((err) => {
  console.error(`\n${red('Fatal error:')} ${err.message}\n`);
  rl.close();
  process.exit(1);
});
