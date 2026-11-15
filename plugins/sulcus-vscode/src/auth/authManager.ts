import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SulcusClient } from '../api/sulcusClient';
import { DaemonManager } from '../api/daemonManager';

export class AuthManager implements vscode.UriHandler {
  private client: SulcusClient;
  private daemon: DaemonManager;
  private currentServer?: http.Server;
  private pendingState?: string;
  private authTimeout?: NodeJS.Timeout;
  private onAuthSuccessCallback?: () => void;

  constructor(client: SulcusClient, daemon: DaemonManager, onAuthSuccess?: () => void) {
    this.client = client;
    this.daemon = daemon;
    this.onAuthSuccessCallback = onAuthSuccess;
  }

  public update(client: SulcusClient, daemon: DaemonManager) {
    this.client = client;
    this.daemon = daemon;
  }

  public handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
    // Handle vscode://sulcus.sulcus-vscode/auth?key=...&state=...
    try {
      if (uri.path === '/auth' || uri.path === 'auth' || uri.path === '') {
        const queryParams = new URLSearchParams(uri.query);
        const key = queryParams.get('key') || queryParams.get('api_key') || queryParams.get('token');
        const state = queryParams.get('state');
        const namespace = queryParams.get('namespace') || 'default';

        if (this.pendingState && state && state !== this.pendingState) {
          vscode.window.showErrorMessage('State Mismatch Error');
          return;
        }

        if (key) {
          this.completeAuth(key, namespace);
          vscode.window.showInformationMessage('Connected Sulcus Account');
        }
      }
    } catch (err: any) {
      vscode.window.showErrorMessage('Authentication Error Occurred');
    }
  }

  public async signIn(): Promise<void> {
    // Cleanup any existing pending flow
    this.cleanup();

    const config = this.client.getConfig();
    const state = crypto.randomBytes(16).toString('hex');
    this.pendingState = state;

    // Start local loopback HTTP server on an available port
    const port = await this.startLoopbackServer(state);
    if (!port) {
      // Fall back to manual input or direct deep link if loopback server could not bind
      vscode.window.showWarningMessage('Browser Handshake Initiated');
    }

    const baseWebUrl = (config.serverUrl && !config.serverUrl.includes('127.0.0.1'))
      ? config.serverUrl.replace(/api\./, '').replace(/\/+$/, '')
      : 'https://sulcus.ca';

    const handshakeUrl = `${baseWebUrl}/auth/handshake?client=vscode&state=${state}&port=${port || 0}&redirect_uri=${encodeURIComponent('vscode://sulcus.sulcus-vscode/auth')}`;

    // Set 3 minute timeout
    this.authTimeout = setTimeout(() => {
      this.cleanup();
      vscode.window.showWarningMessage('Authentication Timed Out');
    }, 180000);

    // Open user browser
    await vscode.env.openExternal(vscode.Uri.parse(handshakeUrl));

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Authorizing Sulcus Account',
        cancellable: true
      },
      async (_progress, token) => {
        token.onCancellationRequested(() => {
          this.cleanup();
          vscode.window.showInformationMessage('Authentication Cancelled');
        });

        // Keep progress alive while waiting
        return new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            if (!this.pendingState) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);
        });
      }
    );
  }

  private startLoopbackServer(expectedState: string): Promise<number | null> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url || '/', `http://127.0.0.1`);
          if (reqUrl.pathname === '/callback') {
            const key = reqUrl.searchParams.get('key') || reqUrl.searchParams.get('api_key') || reqUrl.searchParams.get('token');
            const state = reqUrl.searchParams.get('state');
            const namespace = reqUrl.searchParams.get('namespace') || 'default';
            const serverUrl = reqUrl.searchParams.get('server_url') || undefined;

            if (state !== expectedState) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<html><body style="background:#0b0f19;color:#ff4d4f;font-family:sans-serif;text-align:center;padding:40px;">
                <h2>Authentication Error: State mismatch</h2>
                <p>Please try signing in again from VS Code.</p>
              </body></html>`);
              return;
            }

            if (!key) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<html><body style="background:#0b0f19;color:#ff4d4f;font-family:sans-serif;text-align:center;padding:40px;">
                <h2>Missing API key</h2>
              </body></html>`);
              return;
            }

            // Success response with styled confirmation
            res.writeHead(200, {
              'Content-Type': 'text/html',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Sulcus Authenticated</title>
  <style>
    body {
      background: #080c14;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 40px;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .icon {
      color: #00F0FF;
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 8px 0;
      color: #ffffff;
    }
    p {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 20px 0;
    }
    .badge {
      display: inline-block;
      background: rgba(0, 240, 255, 0.1);
      border: 1px solid rgba(0, 240, 255, 0.3);
      color: #00F0FF;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">S</div>
    <h1>Connected to VS Code</h1>
    <p>Your Sulcus credentials have been securely transmitted to the extension. You can now close this tab and return to your editor.</p>
    <div class="badge">Namespace: ${namespace}</div>
  </div>
</body>
</html>`);

            this.completeAuth(key, namespace, serverUrl);
          } else {
            res.writeHead(404);
            res.end();
          }
        } catch {
          res.writeHead(500);
          res.end();
        }
      });

      // Try port 4204, or let OS choose ephemeral port (0)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.currentServer = server;
          resolve(addr.port);
        } else {
          resolve(null);
        }
      });

      server.on('error', () => {
        resolve(null);
      });
    });
  }

  private completeAuth(key: string, namespace: string = 'default', serverUrl?: string) {
    this.cleanup();

    // 1. Update VS Code settings
    const wsConfig = vscode.workspace.getConfiguration('sulcus');
    wsConfig.update('apiKey', key, vscode.ConfigurationTarget.Global);
    if (namespace) {
      wsConfig.update('namespace', namespace, vscode.ConfigurationTarget.Global);
    }
    if (serverUrl) {
      wsConfig.update('serverUrl', serverUrl, vscode.ConfigurationTarget.Global);
    }

    // 2. Persist to ~/.config/sulcus/sulcus.ini for CLI/Daemon parity
    this.saveToIni(key, namespace, serverUrl);

    // 3. Update active in-memory client
    const updatedConfig = {
      ...this.client.getConfig(),
      apiKey: key,
      namespace: namespace || this.client.getConfig().namespace
    };
    if (serverUrl) {
      updatedConfig.serverUrl = serverUrl;
    }
    this.client.updateConfig(updatedConfig);
    this.daemon.updateConfig(updatedConfig);

    // 4. Trigger UI callback
    if (this.onAuthSuccessCallback) {
      this.onAuthSuccessCallback();
    }

    vscode.window.showInformationMessage('Authenticated Sulcus Account');
  }

  private saveToIni(apiKey: string, namespace: string, serverUrl?: string) {
    try {
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, '.config', 'sulcus');
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      const iniPath = path.join(configDir, 'sulcus.ini');
      let lines: string[] = [];

      if (fs.existsSync(iniPath)) {
        lines = fs.readFileSync(iniPath, 'utf8').split('\n');
      }

      let keySet = false;
      let nsSet = false;
      let urlSet = false;

      const newLines = lines.map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('server_api_key')) {
          keySet = true;
          return `server_api_key = ${apiKey}`;
        }
        if (trimmed.startsWith('namespace')) {
          nsSet = true;
          return `namespace = ${namespace}`;
        }
        if (serverUrl && trimmed.startsWith('server_url')) {
          urlSet = true;
          return `server_url = ${serverUrl}`;
        }
        return line;
      });

      if (!keySet) newLines.push(`server_api_key = ${apiKey}`);
      if (!nsSet) newLines.push(`namespace = ${namespace}`);
      if (serverUrl && !urlSet) newLines.push(`server_url = ${serverUrl}`);

      fs.writeFileSync(iniPath, newLines.join('\n'), 'utf8');
    } catch {
      // Ignore disk write failure
    }
  }

  public async signOut(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Sign Out Account',
      { modal: true },
      'Sign Out'
    );

    if (confirm !== 'Sign Out') return;

    const wsConfig = vscode.workspace.getConfiguration('sulcus');
    await wsConfig.update('apiKey', '', vscode.ConfigurationTarget.Global);

    // Clean sulcus.ini
    try {
      const iniPath = path.join(os.homedir(), '.config', 'sulcus', 'sulcus.ini');
      if (fs.existsSync(iniPath)) {
        const lines = fs.readFileSync(iniPath, 'utf8').split('\n');
        const newLines = lines.filter((l) => !l.trim().startsWith('server_api_key'));
        fs.writeFileSync(iniPath, newLines.join('\n'), 'utf8');
      }
    } catch {}

    const updatedConfig = {
      ...this.client.getConfig(),
      apiKey: ''
    };
    this.client.updateConfig(updatedConfig);
    this.daemon.updateConfig(updatedConfig);

    if (this.onAuthSuccessCallback) {
      this.onAuthSuccessCallback();
    }

    vscode.window.showInformationMessage('Signed Out Account');
  }

  public cleanup() {
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = undefined;
    }
    if (this.currentServer) {
      try {
        this.currentServer.close();
      } catch {}
      this.currentServer = undefined;
    }
    this.pendingState = undefined;
  }
}
