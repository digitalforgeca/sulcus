import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SulcusClient } from '../api/sulcusClient';
import { DaemonManager } from '../api/daemonManager';

export class McpConfigService {
  private client: SulcusClient;
  private daemon: DaemonManager;

  constructor(client: SulcusClient, daemon: DaemonManager) {
    this.client = client;
    this.daemon = daemon;
  }

  public update(client: SulcusClient, daemon: DaemonManager) {
    this.client = client;
    this.daemon = daemon;
  }

  public async configureMcp(): Promise<void> {
    const transportPick = await vscode.window.showQuickPick(
      [
        {
          label: 'Zero Secret Proxy',
          description: 'Recommended Proxy',
          detail: 'Reads ~/.config/sulcus/sulcus.ini without writing tokens to .vscode/mcp.json',
          transport: 'mcp-proxy'
        },
        {
          label: 'Local Daemon SSE',
          description: 'Port 4203 SSE',
          detail: 'Fast local transport',
          transport: 'local-sse'
        }
      ],
      { title: 'Select Transport Method' }
    );

    if (!transportPick) return;

    const locationPick = await vscode.window.showQuickPick(
      [
        {
          label: 'Current Workspace Config',
          description: 'Active project folder',
          detail: 'Project MCP file',
          target: 'workspace-vscode'
        },
        {
          label: 'Cursor Workspace Config',
          description: 'Cursor project folder',
          detail: 'Cursor MCP file',
          target: 'workspace-cursor'
        },
        {
          label: 'Global User Config',
          description: 'User home directory',
          detail: 'Global MCP file',
          target: 'global-vscode'
        }
      ],
      { title: 'Select Target Configuration' }
    );

    if (!locationPick) return;

    const config = this.client.getConfig();
    const binPath = this.daemon.findSulcusBinary() || 'sulcus';

    let targetFilePath = '';
    if (locationPick.target === 'workspace-vscode') {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('No Workspace Open');
        return;
      }
      const vscodeDir = path.join(folders[0].uri.fsPath, '.vscode');
      if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true });
      targetFilePath = path.join(vscodeDir, 'mcp.json');
    } else if (locationPick.target === 'workspace-cursor') {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('No Workspace Open');
        return;
      }
      const cursorDir = path.join(folders[0].uri.fsPath, '.cursor');
      if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
      targetFilePath = path.join(cursorDir, 'mcp.json');
    } else {
      const globalVscodeDir = path.join(os.homedir(), '.vscode');
      if (!fs.existsSync(globalVscodeDir)) fs.mkdirSync(globalVscodeDir, { recursive: true });
      targetFilePath = path.join(globalVscodeDir, 'mcp.json');
    }

    // Read existing config if present
    let mcpJson: any = { servers: {} };
    if (fs.existsSync(targetFilePath)) {
      try {
        mcpJson = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'));
        if (!mcpJson.servers && !mcpJson.mcpServers) {
          mcpJson.servers = {};
        }
      } catch {
        mcpJson = { servers: {} };
      }
    }

    const isCursorFormat = locationPick.target === 'workspace-cursor' || mcpJson.mcpServers !== undefined;
    const serverKey = isCursorFormat ? 'mcpServers' : 'servers';
    if (!mcpJson[serverKey]) mcpJson[serverKey] = {};

    if (transportPick.transport === 'local-sse') {
      mcpJson[serverKey]['sulcus'] = {
        type: 'sse',
        url: `http://127.0.0.1:${config.daemonPort || 4203}/sse`
      };
    } else {
      mcpJson[serverKey]['sulcus'] = {
        type: 'stdio',
        command: binPath,
        args: ['mcp-proxy']
      };
    }

    fs.writeFileSync(targetFilePath, JSON.stringify(mcpJson, null, 2), 'utf8');

    const doc = await vscode.workspace.openTextDocument(targetFilePath);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('Configured Sulcus MCP');
  }
}
