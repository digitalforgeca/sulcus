import * as vscode from 'vscode';
import * as path from 'path';
import { SulcusClient } from './api/sulcusClient';
import { DaemonManager } from './api/daemonManager';
import { RecallService } from './services/recallService';
import { CaptureService } from './services/captureService';
import { RulePromotionService } from './services/rulePromotionService';
import { MemoryPreviewProvider } from './services/memoryPreviewProvider';
import { MemoryTreeProvider } from './views/memoryTreeProvider';
import { StatusTreeProvider } from './views/statusTreeProvider';
import { GraphTreeProvider } from './views/graphTreeProvider';
import { LedgerTreeProvider } from './views/ledgerTreeProvider';
import { registerLanguageModelTools } from './tools/lmTools';
import { registerCommands } from './commands/commands';
import { AuthManager } from './auth/authManager';
import { McpConfigService } from './mcp/mcpConfigService';
import { HookConfigService } from './hooks/hookConfigService';
import { getSulcusConfig } from './config/config';
import { SulcusConfiguration } from './types';
import { sanitizeThreeWords } from './utils/format';

let outputChannel: vscode.OutputChannel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let daemonManager: DaemonManager | undefined;
let sulcusClient: SulcusClient | undefined;
let authManager: AuthManager | undefined;
let previewProvider: MemoryPreviewProvider | undefined;
let memoryProvider: MemoryTreeProvider | undefined;
let statusProvider: StatusTreeProvider | undefined;
let graphProvider: GraphTreeProvider | undefined;
let ledgerProvider: LedgerTreeProvider | undefined;
let statusTimer: NodeJS.Timeout | undefined;

export interface SulcusAPI {
  client: SulcusClient;
  daemon: DaemonManager;
  auth: AuthManager;
  recallService: RecallService;
  captureService: CaptureService;
  recallPrompt: (query: string, context?: string) => Promise<any>;
  captureText: (text: string) => Promise<any>;
  showOutput: () => void;
}

async function updateStatusBar() {
  if (!statusBarItem || !sulcusClient || !daemonManager) return;

  const isUp = await daemonManager.isDaemonHealthy();
  const config = sulcusClient.getConfig();

  if (isUp) {
    let count = 0;
    try {
      const stats = await sulcusClient.getDashboardStats();
      if (stats && Array.isArray(stats.namespace_counts)) {
        const found = stats.namespace_counts.find((n: any) => n.namespace === config.namespace);
        count = found ? found.count : 0;
      }
      if (count === 0) {
        const paginated = await sulcusClient.listNodesPaginated(config.namespace, 1, 0);
        count = paginated.total;
      }
    } catch {
      // ignore
    }

    const safeNs = sanitizeThreeWords(config.namespace, 'default');
    statusBarItem.text = `$(server) Sulcus ${safeNs} ${count}`;
    statusBarItem.tooltip = 'Click Configure Instance';
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = `$(circle-slash) Sulcus Daemon Offline`;
    statusBarItem.tooltip = 'Click Configure Instance';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<SulcusAPI> {
  outputChannel = vscode.window.createOutputChannel('Sulcus');
  outputChannel.appendLine('Activating Sulcus Memory Context Sidecar');

  const config = getSulcusConfig();
  sulcusClient = new SulcusClient(config);
  daemonManager = new DaemonManager(config, outputChannel);

  const recallService = new RecallService(sulcusClient);
  const captureService = new CaptureService(sulcusClient);
  const promotionService = new RulePromotionService(sulcusClient);
  const mcpService = new McpConfigService(sulcusClient, daemonManager);
  const hookService = new HookConfigService(context);

  previewProvider = new MemoryPreviewProvider(sulcusClient);
  memoryProvider = new MemoryTreeProvider(sulcusClient, previewProvider);
  statusProvider = new StatusTreeProvider(sulcusClient, daemonManager, hookService);
  graphProvider = new GraphTreeProvider(sulcusClient);
  ledgerProvider = new LedgerTreeProvider(sulcusClient);

  authManager = new AuthManager(sulcusClient, daemonManager, () => {
    updateStatusBar().catch(() => {});
    memoryProvider?.refresh();
    statusProvider?.refresh();
    graphProvider?.refresh();
    ledgerProvider?.refresh();
  });

  // Register Virtual Document Content Provider for sulcus-memory://<id>.md
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(MemoryPreviewProvider.scheme, previewProvider)
  );

  // Register URI Handler
  context.subscriptions.push(vscode.window.registerUriHandler(authManager));

  // Register Tree Views
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('sulcus.views.memories', memoryProvider),
    vscode.window.registerTreeDataProvider('sulcus.views.status', statusProvider),
    vscode.window.registerTreeDataProvider('sulcus.views.graph', graphProvider),
    vscode.window.registerTreeDataProvider('sulcus.views.ledger', ledgerProvider)
  );

  // Register Status Bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'sulcus.openQuickMenu';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Periodic status bar & view refresh
  statusTimer = setInterval(() => {
    updateStatusBar().catch(() => {});
  }, 10000);

  // Initial update
  updateStatusBar().catch(() => {});

  // Register Commands
  registerCommands(
    context,
    sulcusClient,
    daemonManager,
    authManager,
    mcpService,
    hookService,
    recallService,
    captureService,
    promotionService,
    memoryProvider,
    statusProvider,
    graphProvider,
    ledgerProvider,
    previewProvider,
    outputChannel
  );

  // Auto-provision lifecycle hooks in workspace if enabled
  hookService.autoEnsureHooks().catch(() => {});

  // Register MCP Server Definition Provider if supported by VS Code
  if ((vscode as any).lm && typeof (vscode as any).lm.registerMcpServerDefinitionProvider === 'function') {
    try {
      const provider = {
        provideMcpServerDefinitions: async () => {
          const cfg = sulcusClient?.getConfig() || config;
          const isUp = await daemonManager?.isDaemonHealthy();
          if (isUp) {
            return [
              {
                id: 'sulcus-local-sse',
                label: 'Sulcus Memory Local',
                transport: {
                  type: 'sse',
                  url: `http://127.0.0.1:${cfg.daemonPort || 4203}/sse`
                }
              }
            ];
          }
          return [];
        }
      };
      context.subscriptions.push(
        (vscode as any).lm.registerMcpServerDefinitionProvider('sulcus', provider)
      );
    } catch {
      // ignore if experimental api differs
    }
  }

  // Register Language Model Tools (Copilot / LM API)
  registerLanguageModelTools(context, sulcusClient, recallService, captureService);

  // Register Copilot Chat Participant if available
  if ((vscode as any).chat && typeof (vscode as any).chat.createChatParticipant === 'function') {
    try {
      const participant = (vscode as any).chat.createChatParticipant('sulcus.memory', async (request: any, _chatContext: any, stream: any) => {
        const query = request.prompt || 'project architecture decisions preferences';
        const recallRes = await recallService.recallForPrompt(query);
        if (recallRes.formattedBlock) {
          stream.markdown(recallRes.formattedBlock);
        } else {
          stream.markdown('No Relevant Memories');
        }
      });
      context.subscriptions.push(participant);
    } catch {
      // Chat API unavailable
    }
  }

  // Record file saves to Activity Ledger
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const currentConfig = sulcusClient?.getConfig() || config;
      const rel = vscode.workspace.asRelativePath(doc.uri);
      const folders = vscode.workspace.workspaceFolders;
      const rootPath = folders && folders.length ? folders[0].uri.fsPath : process.cwd();
      const content = doc.getText();

      const ledgerBody = {
        namespace: currentConfig.namespace || 'default',
        session_id: `vscode-${process.pid}`,
        workspace_root: rootPath,
        tool_name: 'write_file',
        tool_args: { Path: doc.uri.fsPath },
        files_touched: [rel],
        pre_state: { existed_before: true },
        post_state: { content_snapshot: content.length <= 131072 ? content : null }
      };

      try {
        await sulcusClient?.recordLedger(ledgerBody);
        ledgerProvider?.refresh();
      } catch {
        // ignore background record error
      }
    })
  );

  // Auto-start local daemon if enabled
  if (config.autoStartDaemon) {
    daemonManager.ensureDaemonRunning().then((isHealthy) => {
      if (isHealthy) {
        outputChannel?.appendLine('Sulcus daemon verified ready');
      }
      updateStatusBar().catch(() => {});
      memoryProvider?.refresh();
      statusProvider?.refresh();
      graphProvider?.refresh();
      ledgerProvider?.refresh();
    }).catch(() => {});
  }

  // Watch for configuration updates
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sulcus')) {
        const newConfig = getSulcusConfig();
        sulcusClient?.updateConfig(newConfig);
        daemonManager?.updateConfig(newConfig);
        authManager?.update(sulcusClient!, daemonManager!);
        recallService.updateClient(sulcusClient!);
        captureService.updateClient(sulcusClient!);
        promotionService.updateClient(sulcusClient!);
        previewProvider?.updateClient(sulcusClient!);
        memoryProvider?.updateClient(sulcusClient!);
        statusProvider?.update(sulcusClient!, daemonManager!);
        graphProvider?.updateClient(sulcusClient!);
        ledgerProvider?.updateClient(sulcusClient!);
        updateStatusBar().catch(() => {});
      }
    })
  );

  outputChannel.appendLine('Sulcus VS Code extension ready');

  return {
    client: sulcusClient,
    daemon: daemonManager,
    auth: authManager,
    recallService,
    captureService,
    recallPrompt: (query, ctx) => recallService.recallForPrompt(query, ctx),
    captureText: (text) => captureService.captureText(text),
    showOutput: () => outputChannel?.show(true)
  };
}

export function deactivate() {
  if (statusTimer) {
    clearInterval(statusTimer);
  }
  if (authManager) {
    authManager.cleanup();
  }
  if (daemonManager) {
    daemonManager.stopDaemon().catch(() => {});
  }
  if (outputChannel) {
    outputChannel.dispose();
  }
}
