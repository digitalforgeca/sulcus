// @ts-nocheck
/**
 * engine-manager.ts — Sulcus local engine lifecycle management.
 *
 * Responsibilities:
 *  - discoverSulcusBinary(): find the sulcus binary on this system
 *  - downloadSulcusBinary(): fetch from GitHub releases when not found
 *  - SulcusEngineManager: spawn, probe, wait-for-ready, stop the local engine
 *
 * Phase 1a: Binary discovery (discoverSulcusBinary)
 * Phase 1b: Process management (SulcusEngineManager)
 * Phase 4c: Auto-download (downloadSulcusBinary)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync, createWriteStream } from "node:fs";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { homedir, platform, arch } from "node:os";
import * as http from "node:http";
import * as https from "node:https";
import { createGunzip } from "node:zlib";

/** Logger interface matching the plugin API logger. */
export interface EngineManagerLogger {
  info(msg: string): void;
  warn(msg: string): void;
  debug(msg: string): void;
}

/** Options for discoverSulcusBinary. */
export interface DiscoverOptions {
  /** Explicit path from plugin config (highest priority). */
  configuredPath?: string;
  /** Directory containing this plugin file (for <plugin-dir>/bin/sulcus). */
  pluginDir?: string;
  logger?: EngineManagerLogger;
}

/** Result of binary discovery. */
export interface DiscoverResult {
  /** Resolved path to the sulcus binary, or null if not found. */
  path: string | null;
  /** Ordered list of locations checked, for diagnostic logging. */
  checked: string[];
}

/**
 * Discover the sulcus binary using the canonical search order:
 *
 *   1. pluginConfig.local.binaryPath  (from OpenClaw UI config)
 *   2. $SULCUS_BIN                    (environment variable)
 *   2.5 npm optional dep              (@digitalforgestudios/sulcus-<platform>/bin/sulcus)
 *   3. `which sulcus`                 (system PATH)
 *   4. ~/.sulcus/bin/sulcus           (user install)
 *   5. <plugin-dir>/bin/sulcus        (bundled with plugin)
 *
 * Returns the first path that exists and is executable, or null.
 * All checked paths are logged for diagnostics.
 */
export function discoverSulcusBinary(opts: DiscoverOptions = {}): DiscoverResult {
  const { configuredPath, pluginDir, logger } = opts;
  const checked: string[] = [];

  const dbg = (msg: string) => logger?.debug(`[engine-manager] ${msg}`);
  const inf = (msg: string) => logger?.info(`[engine-manager] ${msg}`);
  const wrn = (msg: string) => logger?.warn(`[engine-manager] ${msg}`);

  // Helper: test if a path is a regular file we can execute.
  function isExecutable(p: string): boolean {
    if (!p || !existsSync(p)) return false;
    try {
      // Access check: F_OK (exists) + X_OK (executable)
      execSync(`test -f "${p}" && test -x "${p}"`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  // 1. Explicitly configured path (highest priority — user knows best).
  if (configuredPath) {
    const candidate = configuredPath.replace(/^~/, homedir());
    checked.push(`config: ${candidate}`);
    dbg(`checking configured path: ${candidate}`);
    if (isExecutable(candidate)) {
      inf(`found sulcus binary via config: ${candidate}`);
      return { path: candidate, checked };
    }
    wrn(`configured binaryPath not executable: ${candidate}`);
  }

  // 2. $SULCUS_BIN environment variable.
  const envBin = process.env.SULCUS_BIN;
  if (envBin) {
    const candidate = envBin.replace(/^~/, homedir());
    checked.push(`$SULCUS_BIN: ${candidate}`);
    dbg(`checking $SULCUS_BIN: ${candidate}`);
    if (isExecutable(candidate)) {
      inf(`found sulcus binary via $SULCUS_BIN: ${candidate}`);
      return { path: candidate, checked };
    }
    wrn(`$SULCUS_BIN not executable: ${candidate}`);
  }

  // 2.5. npm optional dependency — @digitalforgestudios/sulcus-<platform>/bin/sulcus
  // Installed automatically when the user `npm install`s the main plugin on a
  // supported platform. This check runs before PATH so a project-local install
  // (node_modules) wins over a stale system binary.
  {
    const osPlatform = platform();      // 'linux', 'darwin', ...
    const cpuArch    = arch();          // 'x64', 'arm64', ...
    const pkgSuffix = osPlatform === "linux" && cpuArch === "x64"   ? "linux-x64"
                    : osPlatform === "linux" && cpuArch === "arm64"  ? "linux-arm64"
                    : osPlatform === "darwin" && cpuArch === "x64"   ? "darwin-x64"
                    : osPlatform === "darwin" && cpuArch === "arm64" ? "darwin-arm64"
                    : null;

    if (pkgSuffix) {
      const pkgName = `@digitalforgestudios/sulcus-${pkgSuffix}`;
      try {
        // require.resolve gives us the path to bin/sulcus inside the optional dep.
        const candidate = require.resolve(`${pkgName}/bin/sulcus`);
        checked.push(`npm optional dep ${pkgName}: ${candidate}`);
        dbg(`checking optional dep ${pkgName}: ${candidate}`);
        if (isExecutable(candidate)) {
          inf(`found sulcus binary via npm optional dep ${pkgName}: ${candidate}`);
          return { path: candidate, checked };
        }
        dbg(`optional dep binary not yet executable (postinstall pending?): ${candidate}`);
      } catch {
        // Package not installed — normal when on an unsupported platform or CI.
        checked.push(`npm optional dep ${pkgName}: (not installed)`);
        dbg(`optional dep ${pkgName} not installed`);
      }
    }
  }

  // 3. `which sulcus` — system PATH lookup.
  {
    let whichPath: string | null = null;
    try {
      whichPath = execSync("which sulcus 2>/dev/null", { encoding: "utf8" }).trim();
    } catch {
      whichPath = null;
    }
    const candidate = whichPath || "";
    checked.push(`which sulcus: ${candidate || "(not found)"}`);
    dbg(`which sulcus → ${candidate || "(not found)"}`);
    if (candidate && isExecutable(candidate)) {
      inf(`found sulcus binary in PATH: ${candidate}`);
      return { path: candidate, checked };
    }
  }

  // 4. ~/.sulcus/bin/sulcus — user install directory.
  {
    const candidate = join(homedir(), ".sulcus", "bin", "sulcus");
    checked.push(`~/.sulcus/bin/sulcus: ${candidate}`);
    dbg(`checking ~/.sulcus/bin/sulcus: ${candidate}`);
    if (isExecutable(candidate)) {
      inf(`found sulcus binary in user install dir: ${candidate}`);
      return { path: candidate, checked };
    }
  }

  // 5. <plugin-dir>/bin/sulcus — bundled alongside this plugin.
  if (pluginDir) {
    const candidate = join(pluginDir, "bin", "sulcus");
    checked.push(`<plugin-dir>/bin/sulcus: ${candidate}`);
    dbg(`checking plugin-bundled binary: ${candidate}`);
    if (isExecutable(candidate)) {
      inf(`found sulcus binary bundled with plugin: ${candidate}`);
      return { path: candidate, checked };
    }
  }

  // Not found — log all checked locations so the user can diagnose.
  wrn(
    `sulcus binary not found. Checked:\n` +
      checked.map((c) => `  - ${c}`).join("\n") +
      `\nInstall sulcus to one of these locations or set SULCUS_BIN.`
  );
  return { path: null, checked };
}

// ─────────────────────────────────────────────────────────────────────────────────
// downloadSulcusBinary
// ─────────────────────────────────────────────────────────────────────────────────

/** The GitHub repo used for binary releases. */
export const SULCUS_RELEASE_REPO = "mcdoolz/sulcus";

/** Detect the current platform/arch and map to a release asset name. */
export function detectReleasePlatform(): string | null {
  const os = platform(); // 'linux', 'darwin', 'win32', ...
  const cpu = arch();    // 'x64', 'arm64', 'ia32', ...

  if (os === "linux"  && cpu === "x64")   return "linux-x64";
  if (os === "linux"  && cpu === "arm64") return "linux-arm64";
  if (os === "darwin" && cpu === "x64")   return "macos-x64";
  if (os === "darwin" && cpu === "arm64") return "macos-arm64";

  // Unsupported platform
  return null;
}

/** Options for downloadSulcusBinary. */
export interface DownloadOptions {
  /**
   * Semver version tag to download (e.g. "1.0.0"). If omitted, the
   * function fetches the latest release from GitHub.
   */
  version?: string;
  /**
   * Platform string (e.g. "linux-x64"). Defaults to auto-detected current platform.
   */
  platform?: string;
  /**
   * Destination path for the binary. Defaults to `~/.sulcus/bin/sulcus`.
   */
  destPath?: string;
  /**
   * GitHub repo in "owner/name" format. Defaults to SULCUS_RELEASE_REPO.
   */
  repo?: string;
  logger?: EngineManagerLogger;
}

/** Result of downloadSulcusBinary. */
export interface DownloadResult {
  ok: boolean;
  /** Path the binary was written to. */
  path?: string;
  error?: string;
}

/**
 * Download the pre-built sulcus binary from GitHub releases.
 *
 * Flow:
 *  1. Detect platform (linux-x64, linux-arm64, macos-x64, macos-arm64).
 *  2. Resolve version: explicit > latest release tag via GitHub API.
 *  3. Construct release URL: `https://github.com/{repo}/releases/download/bin-v{version}/sulcus-{platform}.tar.gz`
 *  4. Stream-download the tarball.
 *  5. Extract with `tar xz` piped from stdin (avoids writing temp file).
 *  6. chmod +x the resulting binary.
 *
 * Returns { ok: true, path } on success or { ok: false, error } on failure.
 *
 * Safety: autoInstall defaults to false in plugin config — the user must opt
 * in before this function is ever called.
 */
export async function downloadSulcusBinary(opts: DownloadOptions = {}): Promise<DownloadResult> {
  const log = opts.logger ?? { info: () => {}, warn: () => {}, debug: () => {} };
  const repo = opts.repo ?? SULCUS_RELEASE_REPO;
  const destPath = (opts.destPath ?? join(homedir(), ".sulcus", "bin", "sulcus")).replace(/^~/, homedir());
  const targetPlatform = opts.platform ?? detectReleasePlatform();

  if (!targetPlatform) {
    const err = `unsupported platform: ${platform()}/${arch()} — no pre-built binary available`;
    log.warn(`[engine-manager/download] ${err}`);
    return { ok: false, error: err };
  }

  // ── Resolve version ─────────────────────────────────────────────────────

  let version = opts.version;
  if (!version) {
    log.info(`[engine-manager/download] fetching latest release version from GitHub...`);
    try {
      version = await fetchLatestVersion(repo, log);
    } catch (e: unknown) {
      const err = `failed to fetch latest release: ${e instanceof Error ? e.message : String(e)}`;
      log.warn(`[engine-manager/download] ${err}`);
      return { ok: false, error: err };
    }
  }

  // ── Build URL ────────────────────────────────────────────────────────────

  const assetName = `sulcus-${targetPlatform}.tar.gz`;
  const releaseTag = `bin-v${version}`;
  const downloadUrl = `https://github.com/${repo}/releases/download/${releaseTag}/${assetName}`;

  log.info(`[engine-manager/download] downloading sulcus ${version} for ${targetPlatform}`);
  log.info(`[engine-manager/download] URL: ${downloadUrl}`);

  // ── Ensure destination directory ─────────────────────────────────────────

  const destDir = join(destPath, "..");
  try {
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
      log.debug(`[engine-manager/download] created dest dir: ${destDir}`);
    }
  } catch (e: unknown) {
    const err = `failed to create dest dir ${destDir}: ${e instanceof Error ? e.message : String(e)}`;
    log.warn(`[engine-manager/download] ${err}`);
    return { ok: false, error: err };
  }

  // ── Download + extract ───────────────────────────────────────────────────

  try {
    await downloadAndExtract(downloadUrl, destDir, log);
  } catch (e: unknown) {
    const err = `download/extract failed: ${e instanceof Error ? e.message : String(e)}`;
    log.warn(`[engine-manager/download] ${err}`);
    return { ok: false, error: err };
  }

  // ── Verify binary exists + chmod +x ─────────────────────────────────────

  if (!existsSync(destPath)) {
    const err = `binary not found at ${destPath} after extraction — tarball may have unexpected structure`;
    log.warn(`[engine-manager/download] ${err}`);
    return { ok: false, error: err };
  }

  try {
    chmodSync(destPath, 0o755);
    log.info(`[engine-manager/download] chmod +x ${destPath}`);
  } catch (e: unknown) {
    const err = `chmod +x failed on ${destPath}: ${e instanceof Error ? e.message : String(e)}`;
    log.warn(`[engine-manager/download] ${err}`);
    return { ok: false, error: err };
  }

  log.info(`[engine-manager/download] ✅ sulcus ${version} installed at ${destPath}`);
  return { ok: true, path: destPath };
}

/**
 * Fetch the latest binary release version from GitHub API.
 * Looks for the most recent tag matching `bin-v*`.
 */
async function fetchLatestVersion(repo: string, log: EngineManagerLogger): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${repo}/releases`;
    log.debug(`[engine-manager/download] GET ${url}`);
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": "openclaw-sulcus-plugin",
          "Accept": "application/vnd.github+json",
        },
        timeout: 10_000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString("utf-8"); });
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`GitHub API returned ${res.statusCode}: ${body.substring(0, 200)}`));
            return;
          }
          try {
            const releases: Array<{ tag_name: string; prerelease: boolean; draft: boolean }> = JSON.parse(body);
            // Find the latest non-draft, non-prerelease tag matching bin-v*
            const binRelease = releases.find(
              (r) => r.tag_name.startsWith("bin-v") && !r.prerelease && !r.draft
            );
            if (!binRelease) {
              reject(new Error(`no binary release found for repo ${repo} (looked for bin-v* tags)`));
              return;
            }
            const version = binRelease.tag_name.replace(/^bin-v/, "");
            log.debug(`[engine-manager/download] latest binary release: ${binRelease.tag_name} → ${version}`);
            resolve(version);
          } catch (e) {
            reject(new Error(`failed to parse GitHub releases response: ${e instanceof Error ? e.message : String(e)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("GitHub API request timed out after 10s")); });
    req.end();
  });
}

/**
 * Stream-download a tarball from a URL (following up to 5 redirects) and
 * extract it to destDir using `tar xz -C <destDir>`.
 */
async function downloadAndExtract(url: string, destDir: string, log: EngineManagerLogger): Promise<void> {
  const resolvedUrl = await followRedirects(url, 5, log);

  return new Promise((resolve, reject) => {
    log.debug(`[engine-manager/download] streaming tarball from ${resolvedUrl} → tar xz -C ${destDir}`);

    const parsed = new URL(resolvedUrl);
    const transport = parsed.protocol === "https:" ? https : http;

    const req = (transport as typeof https).request(
      resolvedUrl,
      { method: "GET", timeout: 60_000 },
      (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`download failed: HTTP ${res.statusCode} from ${resolvedUrl}`));
          res.resume();
          return;
        }

        // Pipe: HTTP response → tar xz → destDir
        const tar = spawn("tar", ["xz", "-C", destDir], { stdio: ["pipe", "ignore", "pipe"] });
        let tarErr = "";
        tar.stderr?.on("data", (d: Buffer) => { tarErr += d.toString(); });
        tar.on("close", (code: number | null) => {
          if (code !== 0) {
            reject(new Error(`tar exited with code ${code}: ${tarErr.substring(0, 300)}`));
          } else {
            log.debug("[engine-manager/download] tar extraction complete");
            resolve();
          }
        });

        res.pipe(tar.stdin!);
        res.on("error", (e: Error) => { tar.stdin?.destroy(); reject(e); });
        tar.stdin?.on("error", () => { /* ignore broken pipe if tar exits first */ });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("download timed out after 60s")); });
    req.end();
  });
}

/**
 * Follow HTTP redirects and return the final URL (no body read).
 * GitHub releases use S3 redirects (302 → 302 → 200).
 */
async function followRedirects(url: string, maxRedirects: number, log: EngineManagerLogger): Promise<string> {
  let current = url;
  for (let i = 0; i < maxRedirects; i++) {
    const parsed = new URL(current);
    const transport = parsed.protocol === "https:" ? https : http;
    const location = await new Promise<string | null>((resolve, reject) => {
      const req = (transport as typeof https).request(
        current,
        { method: "HEAD", timeout: 10_000 },
        (res) => {
          res.resume();
          const { statusCode, headers } = res;
          if (statusCode && statusCode >= 300 && statusCode < 400 && headers.location) {
            resolve(headers.location);
          } else {
            resolve(null); // final URL
          }
        },
      );
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error(`HEAD timed out: ${current}`)); });
      req.end();
    });
    if (!location) {
      log.debug(`[engine-manager/download] resolved URL: ${current}`);
      return current;
    }
    log.debug(`[engine-manager/download] redirect ${i + 1}: ${location}`);
    current = location;
  }
  return current; // give up following, try the last URL directly
}

// ─────────────────────────────────────────────────────────────────────────────
// SulcusEngineManager
// ─────────────────────────────────────────────────────────────────────────────

/** Runtime directory for PID and port files. */
const RUN_DIR = join(homedir(), ".sulcus", "run");

/** Options for SulcusEngineManager construction. */
export interface EngineManagerOptions {
  /** Path to the sulcus binary. Use discoverSulcusBinary() to find it. */
  binaryPath: string;
  /** Port to serve on. Default: 8765. */
  port?: number;
  /** Path to a sulcus config file. Passed as `--config <path>`. */
  configPath?: string;
  /** Extra environment variables to set on the child process. */
  env?: Record<string, string>;
  /** How long (ms) to wait for the engine to become ready. Default: 15000. */
  readyTimeoutMs?: number;
  /** Logger instance. */
  logger?: EngineManagerLogger;
}

/** Result of SulcusEngineManager.start(). */
export interface StartResult {
  ok: boolean;
  port: number;
  pid: number;
  /** True if we adopted an already-running engine on this port. */
  adopted: boolean;
  error?: string;
}

/**
 * Manages the lifecycle of the local Sulcus engine process.
 *
 * Responsibilities:
 *  - start()       — spawn `sulcus serve`, write PID + port files
 *  - stop()        — SIGTERM → wait 5s → SIGKILL, clean up PID file
 *  - probe()       — HTTP GET to confirm engine is accepting requests
 *  - waitForReady()— exponential backoff probe until engine responds
 *  - isOurs()      — confirm the engine was spawned by this instance
 */
export class SulcusEngineManager {
  private binaryPath: string;
  private configPath: string | undefined;
  private basePort: number;
  private extraEnv: Record<string, string>;
  private readyTimeoutMs: number;
  private logger: EngineManagerLogger;

  /** The spawned child process (null if we adopted an existing engine). */
  private child: ChildProcess | null = null;
  /** Port actually in use (set after start()). */
  private activePort: number | null = null;
  /** PID we wrote to the PID file (set after start()). */
  private activePid: number | null = null;

  constructor(opts: EngineManagerOptions) {
    this.binaryPath = opts.binaryPath;
    this.configPath = opts.configPath;
    this.basePort = opts.port ?? 8765;
    this.extraEnv = opts.env ?? {};
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 15_000;
    this.logger = opts.logger ?? { info: () => {}, warn: () => {}, debug: () => {} };
  }

  /** Current port the engine is serving on, or null if not started. */
  get port(): number | null { return this.activePort; }

  /** Endpoint URL for the engine (e.g. "http://localhost:8765"). */
  get endpoint(): string | null {
    return this.activePort !== null ? `http://localhost:${this.activePort}` : null;
  }

  // ── File helpers ───────────────────────────────────────────────────────

  private get pidFile(): string { return join(RUN_DIR, "sulcus.pid"); }
  private get portFile(): string { return join(RUN_DIR, "port"); }

  private ensureRunDir(): void {
    if (!existsSync(RUN_DIR)) {
      mkdirSync(RUN_DIR, { recursive: true });
    }
  }

  private writePidFile(pid: number): void {
    this.ensureRunDir();
    writeFileSync(this.pidFile, String(pid), "utf-8");
  }

  private writePortFile(port: number): void {
    this.ensureRunDir();
    writeFileSync(this.portFile, String(port), "utf-8");
  }

  private removePidFile(): void {
    try { if (existsSync(this.pidFile)) unlinkSync(this.pidFile); } catch { /* best effort */ }
  }

  private readPidFile(): number | null {
    try {
      const raw = readFileSync(this.pidFile, "utf-8").trim();
      const n = parseInt(raw, 10);
      return isNaN(n) ? null : n;
    } catch { return null; }
  }

  // ── Port management ────────────────────────────────────────────────────

  /**
   * Check if a TCP port is in use (any process, not necessarily sulcus).
   * Uses /dev/tcp trick via shell — reliable on Linux/macOS.
   */
  private isPortBusy(port: number): boolean {
    try {
      execSync(`bash -c 'echo > /dev/tcp/127.0.0.1/${port}' 2>/dev/null`, { timeout: 500, stdio: "ignore" });
      return true; // connection succeeded → port busy
    } catch {
      return false; // connection refused / timeout → port free
    }
  }

  /**
   * Find a free port starting from basePort.
   * If the occupied port already speaks the Sulcus API, we adopt it.
   * Returns { port, adopt } where adopt=true means reuse the existing engine.
   */
  private async selectPort(): Promise<{ port: number; adopt: boolean }> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = this.basePort + attempt;
      if (!this.isPortBusy(candidate)) {
        return { port: candidate, adopt: false };
      }
      // Port busy — does it speak Sulcus?
      this.logger.debug(`[engine-manager] port ${candidate} busy — probing for existing Sulcus engine`);
      const isSulcus = await this.probePort(candidate);
      if (isSulcus) {
        this.logger.info(`[engine-manager] port ${candidate} has a running Sulcus engine — adopting it`);
        return { port: candidate, adopt: true };
      }
      this.logger.debug(`[engine-manager] port ${candidate} busy with non-Sulcus service, trying ${candidate + 1}`);
    }
    throw new Error(`[engine-manager] no free port found in range ${this.basePort}–${this.basePort + 9}`);
  }

  // ── Probe ──────────────────────────────────────────────────────────────

  /**
   * HTTP GET to the engine's hot_nodes endpoint. Returns true if it responds
   * with 2xx (engine is up and accepting requests).
   */
  async probePort(port: number, timeoutMs = 1500): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/v1/agent/hot_nodes?limit=1",
          method: "GET",
          timeout: timeoutMs,
        },
        (res) => {
          // Consume the response to free the socket.
          res.resume();
          resolve(res.statusCode !== undefined && res.statusCode < 500);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  /**
   * Probe the active port. Returns true if the engine is responding.
   */
  async probe(): Promise<boolean> {
    if (this.activePort === null) return false;
    return this.probePort(this.activePort);
  }

  /**
   * Poll with exponential backoff until the engine responds or timeout elapses.
   * Backoff: 100ms → 200ms → 400ms → 800ms → 1600ms → … (capped at 3s).
   */
  async waitForReady(maxMs?: number): Promise<boolean> {
    const deadline = Date.now() + (maxMs ?? this.readyTimeoutMs);
    let delay = 100;
    while (Date.now() < deadline) {
      const ok = await this.probe();
      if (ok) {
        this.logger.info(`[engine-manager] engine ready on port ${this.activePort}`);
        return true;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(delay, remaining, 3000)));
      delay = Math.min(delay * 2, 3000);
    }
    this.logger.warn(`[engine-manager] engine did not become ready within ${maxMs ?? this.readyTimeoutMs}ms`);
    return false;
  }

  // ── isOurs() ───────────────────────────────────────────────────────────

  /**
   * Returns true if this manager instance spawned the engine AND the process
   * is still running. Returns false if we adopted an existing engine.
   */
  isOurs(): boolean {
    if (this.child === null || this.activePid === null) return false;
    try {
      // signal 0 = existence check, throws if process is gone
      process.kill(this.activePid, 0);
      return true;
    } catch {
      return false;
    }
  }

  // ── start() ────────────────────────────────────────────────────────────

  /**
   * Start the local Sulcus engine.
   *
   *  1. Select a port (or adopt an existing engine on the base port).
   *  2. Build the child env: inherit process.env + SULCUS_MCP_ADDR override.
   *  3. Spawn `sulcus [--config <path>] serve` as a detached child.
   *  4. Write PID and port files.
   *  5. Wait for the engine to become ready.
   */
  async start(): Promise<StartResult> {
    const { port, adopt } = await this.selectPort();
    this.activePort = port;

    if (adopt) {
      // An existing Sulcus engine is already on this port — reuse it.
      this.child = null;
      const existingPid = this.readPidFile() ?? -1;
      this.activePid = existingPid;
      this.writePortFile(port);
      this.logger.info(`[engine-manager] adopted existing engine (port: ${port}, pid: ${existingPid})`);
      return { ok: true, port, pid: existingPid, adopted: true };
    }

    // Build args: sulcus [--config <path>] serve
    const args: string[] = [];
    if (this.configPath) {
      args.push("--config", this.configPath);
    }
    args.push("serve");

    // Build env: inherit everything, then layer our overrides.
    const childEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...this.extraEnv,
      SULCUS_MCP_ADDR: `127.0.0.1:${port}`,
    };

    this.logger.info(`[engine-manager] spawning: ${this.binaryPath} ${args.join(" ")} (port: ${port})`);

    const child = spawn(this.binaryPath, args, {
      env: childEnv,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"], // capture stderr for error reporting
    });

    this.child = child;
    const pid = child.pid ?? 0;
    this.activePid = pid;

    // Forward stderr to logger so startup errors are visible.
    let stderrBuffer = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderrBuffer += text;
      // Log each complete line as it arrives
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) this.logger.debug(`[sulcus-engine] ${line}`);
      }
    });

    child.on("error", (err: Error) => {
      this.logger.warn(`[engine-manager] child process error: ${err.message}`);
    });

    child.on("exit", (code: number | null, signal: string | null) => {
      this.logger.info(`[engine-manager] engine exited (code: ${code ?? "null"}, signal: ${signal ?? "none"})`);
      this.removePidFile();
      this.child = null;
      this.activePid = null;
    });

    // Allow the Node.js process to exit even if the child is still running.
    child.unref();

    // Write runtime files.
    this.writePidFile(pid);
    this.writePortFile(port);

    // Wait for the engine to accept connections.
    const ready = await this.waitForReady();
    if (!ready) {
      const lastLines = stderrBuffer.trim() || "(no stderr captured)";
      this.logger.warn(`[engine-manager] engine failed to start. Last stderr: ${lastLines}`);
      return {
        ok: false,
        port,
        pid,
        adopted: false,
        error: `engine did not become ready within ${this.readyTimeoutMs}ms. stderr: ${lastLines.substring(0, 300)}`,
      };
    }

    this.logger.info(`[engine-manager] engine started ✅ (port: ${port}, pid: ${pid})`);
    return { ok: true, port, pid, adopted: false };
  }

  // ── stop() ─────────────────────────────────────────────────────────────

  /**
   * Gracefully stop the engine.
   *
   *  1. Send SIGTERM.
   *  2. Wait up to 5 seconds for the process to exit.
   *  3. Send SIGKILL if it hasn't exited.
   *  4. Remove the PID file.
   *
   * Safe to call if the engine was adopted (no-op — we don't own it).
   */
  async stop(): Promise<void> {
    if (!this.isOurs()) {
      this.logger.info("[engine-manager] stop() called on adopted/unowned engine — skipping");
      this.activePort = null;
      this.activePid = null;
      return;
    }

    const pid = this.activePid!;
    this.logger.info(`[engine-manager] stopping engine (pid: ${pid}) with SIGTERM`);

    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }

    // Wait up to 5s for graceful exit.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        process.kill(pid, 0); // still running?
      } catch {
        // Process gone — clean up.
        this.logger.info(`[engine-manager] engine exited gracefully (pid: ${pid})`);
        this.removePidFile();
        this.child = null;
        this.activePort = null;
        this.activePid = null;
        return;
      }
    }

    // Still running after 5s — force kill.
    this.logger.warn(`[engine-manager] engine did not exit after 5s — sending SIGKILL (pid: ${pid})`);
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    this.removePidFile();
    this.child = null;
    this.activePort = null;
    this.activePid = null;
  }
}
