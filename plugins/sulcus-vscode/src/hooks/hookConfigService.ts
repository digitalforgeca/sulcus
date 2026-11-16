import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class HookConfigService {
  private extensionContext: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.extensionContext = context;
  }

  public isHooksConfigured(): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return false;
    const hookConfigPath = path.join(folders[0].uri.fsPath, '.github', 'hooks', 'sulcus.json');
    return fs.existsSync(hookConfigPath);
  }

  public resolveSulcusCommand(): string {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.sulcus', 'bin', 'sulcus'),
      path.join(home, '.cargo', 'bin', 'sulcus'),
      '/opt/homebrew/bin/sulcus',
      '/usr/local/bin/sulcus'
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return 'sulcus';
  }

  public async configureHooks(silent = false): Promise<boolean> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      if (!silent) {
        vscode.window.showErrorMessage('No Workspace Open');
      }
      return false;
    }

    const rootDir = folders[0].uri.fsPath;
    const githubDir = path.join(rootDir, '.github');
    const hooksDir = path.join(githubDir, 'hooks');
    const legacyScriptsDir = path.join(hooksDir, 'scripts', 'sulcus');

    try {
      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
      }
      if (fs.existsSync(legacyScriptsDir)) {
        fs.rmSync(legacyScriptsDir, { recursive: true, force: true });
      }

      const mkHook = (eventName: string, timeoutSec = 5) => [
        {
          type: 'command',
          command: `SULCUS_MODEL_CACHE_DIR="$HOME/.sulcus/models/fastembed" PATH="$HOME/.sulcus/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" sulcus hook --harness vscode ${eventName}`,
          timeoutSec
        }
      ];

      const configJson = {
        version: 1,
        hooks: {
          SessionStart: mkHook('SessionStart', 5),
          UserPromptSubmit: mkHook('UserPromptSubmit', 5),
          PreToolUse: mkHook('PreToolUse', 2),
          PostToolUse: mkHook('PostToolUse', 3),
          PreCompact: mkHook('PreCompact', 5),
          Stop: mkHook('Stop', 5)
        }
      };

      const hookConfigFile = path.join(hooksDir, 'sulcus.json');
      fs.writeFileSync(hookConfigFile, JSON.stringify(configJson, null, 2) + '\n', 'utf8');

      const instructionsFile = path.join(githubDir, 'copilot-instructions.md');
      const memoryAnchor = [
        '# Sulcus Memory Directives',
        '',
        'Sulcus proactively injects relevant memory blocks into working context before each prompt response.',
        '',
        '- `<sulcus-memories>`: Authoritative architectural facts, patterns, and durable decisions. Treat these as verified project truth.',
        '- Explicit tools: Use `sulcus_recall`, `sulcus_capture`, `sulcus_boost`, and `sulcus_forget` (plus Sulcus MCP tools when connected) for manual memory operations.',
        ''
      ].join('\n');

      if (!fs.existsSync(instructionsFile)) {
        fs.writeFileSync(instructionsFile, memoryAnchor, 'utf8');
      } else {
        const currentContent = fs.readFileSync(instructionsFile, 'utf8');
        if (!currentContent.includes('Sulcus Memory Directives') && !currentContent.includes('<sulcus-memories>')) {
          fs.writeFileSync(instructionsFile, currentContent.trimEnd() + '\n\n' + memoryAnchor, 'utf8');
        }
      }

      if (!silent) {
        vscode.window.showInformationMessage('Configured Sulcus Hooks');
      }
      return true;
    } catch {
      if (!silent) {
        vscode.window.showErrorMessage('Hook Setup Failed');
      }
      return false;
    }
  }

  public async autoEnsureHooks(): Promise<void> {
    const config = vscode.workspace.getConfiguration('sulcus');
    const autoConfigure = config.get<boolean>('autoConfigureHooks', true);
    if (!autoConfigure) return;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    const rootPath = folders[0].uri.fsPath;
    const gitDir = path.join(rootPath, '.git');
    if (!fs.existsSync(gitDir)) return;

    const hookConfigFile = path.join(rootPath, '.github', 'hooks', 'sulcus.json');
    if (!fs.existsSync(hookConfigFile)) {
      await this.configureHooks(true);
    }
  }
}
