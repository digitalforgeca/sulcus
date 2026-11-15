import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as vscode from 'vscode';
import { SulcusConfiguration } from '../types';

export class DaemonManager {
  private config: SulcusConfiguration;
  private daemonProcess?: ChildProcess;
  private outputChannel?: vscode.OutputChannel;
  private isStarting = false;

  constructor(config: SulcusConfiguration, outputChannel?: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
  }

  public updateConfig(config: SulcusConfiguration) {
    this.config = config;
  }

  private log(message: string) {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] [Sulcus Daemon] ${message}`;
    if (this.outputChannel) {
      this.outputChannel.appendLine(formatted);
    }
    try {
      const logDir = path.join(os.homedir(), '.sulcus');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      fs.appendFileSync(path.join(logDir, 'daemon_lifecycle.log'), `[${new Date().toISOString()}] ${message}\n`);
    } catch {
      // Ignore disk logging error
    }
  }

  public async isDaemonHealthy(): Promise<boolean> {
    const port = this.config.daemonPort || 4203;
    const url = `http://127.0.0.1:${port}/api/v1/admin/dashboard`;
    return new Promise((resolve) => {
      const req = http.get(url, (res) => {
        resolve(res.statusCode !== 502 && res.statusCode !== 404);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(400, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  public findSulcusBinary(): string | null {
    if (this.config.binPath && this.config.binPath !== 'sulcus') {
      if (fs.existsSync(this.config.binPath)) {
        return this.config.binPath;
      }
    }

    try {
      const bin = execSync('which sulcus', { encoding: 'utf8' }).trim();
      if (bin && fs.existsSync(bin)) {
        return bin;
      }
    } catch {
      // which failed
    }

    const homeDir = os.homedir();
    for (const candidate of [
      path.join(homeDir, '.sulcus', 'bin', 'sulcus'),
      path.join(homeDir, '.cargo', 'bin', 'sulcus'),
      '/opt/homebrew/bin/sulcus',
      '/usr/local/bin/sulcus'
    ]) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Dev mode fallback in sulcus repo
    const devRel = path.join(homeDir, 'dev', 'sulcus', 'target', 'release', 'sulcus');
    if (fs.existsSync(devRel)) return devRel;

    const devDbg = path.join(homeDir, 'dev', 'sulcus', 'target', 'debug', 'sulcus');
    if (fs.existsSync(devDbg)) return devDbg;

    return null;
  }

  public async ensureDaemonRunning(): Promise<boolean> {
    if (await this.isDaemonHealthy()) {
      return true;
    }

    if (!this.config.autoStartDaemon) {
      this.log('Auto-start daemon is disabled in settings.');
      return false;
    }

    return await this.startDaemon();
  }

  public async startDaemon(): Promise<boolean> {
    if (this.isStarting) {
      return false;
    }
    this.isStarting = true;

    try {
      if (await this.isDaemonHealthy()) {
        this.log('Sulcus daemon is already active and healthy.');
        return true;
      }

      const binPath = this.findSulcusBinary();
      if (!binPath) {
        this.log('Sulcus binary not found in PATH, ~/.cargo/bin, or workspace target build.');
        return false;
      }

      const sulcusDir = path.join(os.homedir(), '.sulcus');
      if (!fs.existsSync(sulcusDir)) {
        fs.mkdirSync(sulcusDir, { recursive: true });
      }

      const logFile = path.join(sulcusDir, 'daemon.log');
      const out = fs.openSync(logFile, 'a');
      const err = fs.openSync(logFile, 'a');

      // Inherit environment variables
      const childEnv = { ...process.env };
      if (this.config.serverUrl && !this.config.serverUrl.includes('127.0.0.1')) {
        childEnv.SULCUS_SERVER_URL = this.config.serverUrl;
      }
      if (this.config.apiKey) {
        childEnv.SULCUS_API_KEY = this.config.apiKey;
      }
      if (this.config.namespace) {
        childEnv.SULCUS_NAMESPACE = this.config.namespace;
      }

      this.log(`Spawning Sulcus background daemon: ${binPath} serve (port ${this.config.daemonPort || 4203})`);
      const child = spawn(binPath, ['serve'], {
        detached: true,
        stdio: ['ignore', out, err],
        env: childEnv
      });

      child.unref();
      this.daemonProcess = child;
      this.log(`Sulcus daemon spawned with PID ${child.pid}`);

      // Poll until ready (up to 5 seconds)
      const maxWait = 6000;
      const pollInterval = 250;
      const deadline = Date.now() + maxWait;

      while (Date.now() < deadline) {
        if (await this.isDaemonHealthy()) {
          this.log(`Sulcus daemon is now ready on port ${this.config.daemonPort || 4203}`);
          return true;
        }
        await new Promise((r) => setTimeout(r, pollInterval));
      }

      this.log('Sulcus daemon spawned but health check timed out. Check ~/.sulcus/daemon.log');
      return false;
    } finally {
      this.isStarting = false;
    }
  }

  public async stopDaemon(): Promise<void> {
    if (this.daemonProcess) {
      try {
        this.daemonProcess.kill('SIGTERM');
        this.log('Sent SIGTERM to spawned daemon process.');
      } catch (err: any) {
        this.log(`Error stopping daemon: ${err.message}`);
      }
      this.daemonProcess = undefined;
    }
  }

  public async restartDaemon(): Promise<boolean> {
    this.log('Restarting Sulcus daemon...');
    await this.stopDaemon();
    await new Promise((r) => setTimeout(r, 600));
    return await this.startDaemon();
  }
}
