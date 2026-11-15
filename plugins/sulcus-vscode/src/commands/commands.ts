import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { DaemonManager } from '../api/daemonManager';
import { RecallService } from '../services/recallService';
import { CaptureService } from '../services/captureService';
import { RulePromotionService } from '../services/rulePromotionService';
import { MemoryTreeProvider, MemoryItem } from '../views/memoryTreeProvider';
import { StatusTreeProvider } from '../views/statusTreeProvider';
import { GraphTreeProvider } from '../views/graphTreeProvider';
import { LedgerTreeProvider } from '../views/ledgerTreeProvider';
import { AuthManager } from '../auth/authManager';
import { McpConfigService } from '../mcp/mcpConfigService';
import { HookConfigService } from '../hooks/hookConfigService';
import { setSulcusNamespace, setSulcusServerUrl, setSulcusApiKey } from '../config/config';
import { MemoryNode } from '../types';
import { sanitizeThreeWords, formatButton } from '../utils/format';
import { MemoryPreviewProvider } from '../services/memoryPreviewProvider';
import { MemoryMapPanel } from '../views/memoryMapPanel';

export function registerCommands(
  context: vscode.ExtensionContext,
  client: SulcusClient,
  daemon: DaemonManager,
  authManager: AuthManager,
  mcpService: McpConfigService,
  hookService: HookConfigService,
  recallService: RecallService,
  captureService: CaptureService,
  promotionService: RulePromotionService,
  memoryProvider: MemoryTreeProvider,
  statusProvider: StatusTreeProvider,
  graphProvider: GraphTreeProvider,
  ledgerProvider: LedgerTreeProvider,
  previewProvider: MemoryPreviewProvider,
  outputChannel: vscode.OutputChannel
) {
  function refreshAll() {
    memoryProvider.refresh();
    statusProvider.refresh();
    graphProvider.refresh();
    ledgerProvider.refresh();
  }

  // ── Open Virtual Memory Document ───────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.openMemoryDetail', async (node?: MemoryNode) => {
      if (!node?.id) return;
      previewProvider.cacheNode(node);
      const uri = vscode.Uri.parse(`${MemoryPreviewProvider.scheme}://${node.id}.md`);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
    })
  );

  // ── Auto-Recall Commands ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.recallContext', async () => {
      const editor = vscode.window.activeTextEditor;
      let defaultQuery = editor ? editor.document.getText(editor.selection).trim() : '';
      if (!defaultQuery && editor) {
        defaultQuery = editor.document.lineAt(editor.selection.active.line).text.trim();
      }

      const query = await vscode.window.showInputBox({
        title: 'Recall Memory Context',
        prompt: 'Enter Recall Topic',
        value: defaultQuery || ''
      });

      if (!query) return;

      const result = await recallService.recallForPrompt(query);
      if (!result.formattedBlock) {
        vscode.window.showInformationMessage('No Memories Found');
        return;
      }

      outputChannel.clear();
      outputChannel.appendLine(result.formattedBlock);
      outputChannel.show(true);

      const copyBtn = formatButton('copy', 'Copy');
      const insertBtn = formatButton('plus', 'Insert');

      const choice = await vscode.window.showInformationMessage(
        'Sulcus Recalled Memories',
        copyBtn,
        insertBtn
      );

      if (choice === copyBtn) {
        await vscode.env.clipboard.writeText(result.formattedBlock);
        vscode.window.showInformationMessage('Copied To Clipboard');
      } else if (choice === insertBtn && editor) {
        editor.edit((editBuilder) => {
          editBuilder.insert(editor.selection.active, result.formattedBlock + '\n');
        });
      }
    })
  );

  // ── Capture Commands ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.captureSelection', async () => {
      await captureService.captureSelection();
      vscode.window.showInformationMessage('Captured Sulcus Memory');
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.addMemoryInteractive', async () => {
      await captureService.captureInteractive();
      refreshAll();
    })
  );

  // ── Search & Filter Commands ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.filterMemories', async () => {
      const q = await vscode.window.showInputBox({
        title: 'Filter Active Memories',
        prompt: 'Enter Filter Text'
      });
      memoryProvider.setFilter(q || undefined);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.clearFilter', () => {
      memoryProvider.setFilter(undefined);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.searchMemories', async () => {
      const q = await vscode.window.showInputBox({
        title: 'Search Sulcus Memories',
        prompt: 'Enter Search Query'
      });
      if (!q) return;

      const results = await client.search({ query: q, limit: 25 });
      if (!results || results.length === 0) {
        vscode.window.showInformationMessage('No Memories Found');
        return;
      }

      const picks = results.map((r) => {
        const node = r.node || (r as any);
        const heat = Math.round((node.current_heat ?? 0) * 100);
        return {
          label: sanitizeThreeWords(node.label || node.pointer_summary || 'Memory Result'),
          description: sanitizeThreeWords(`${heat} heat ${node.memory_type || 'memory'}`),
          detail: node.label,
          node: node as MemoryNode
        };
      });

      const selected = await vscode.window.showQuickPick(picks, {
        title: 'Select Memory Result',
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (selected) {
        const action = await vscode.window.showQuickPick(
          [
            { label: 'Inspect Memory', iconPath: new vscode.ThemeIcon('open-preview'), action: 'open' },
            { label: 'Copy Content', iconPath: new vscode.ThemeIcon('copy'), action: 'copy' },
            { label: 'Boost Heat', iconPath: new vscode.ThemeIcon('flame'), action: 'boost' },
            { label: 'Toggle Pin', iconPath: new vscode.ThemeIcon('pin'), action: 'pin' },
            { label: 'Forget Node', iconPath: new vscode.ThemeIcon('trash'), action: 'forget' }
          ],
          { title: 'Select Node Action' }
        );

        if (action?.action === 'open') {
          vscode.commands.executeCommand('sulcus.openMemoryDetail', selected.node);
        } else if (action?.action === 'copy') {
          await vscode.env.clipboard.writeText(selected.node.label);
          vscode.window.showInformationMessage('Copied To Clipboard');
        } else if (action?.action === 'boost') {
          await client.sendFeedback({ node_id: selected.node.id, feedback_type: 'boost', strength: 0.15 });
          vscode.window.showInformationMessage('Boosted Memory Heat');
          refreshAll();
        } else if (action?.action === 'pin') {
          await client.patchNode(selected.node.id, { is_pinned: !selected.node.is_pinned });
          vscode.window.showInformationMessage('Updated Memory Pin');
          refreshAll();
        } else if (action?.action === 'forget') {
          await client.deleteNode(selected.node.id);
          vscode.window.showInformationMessage('Deleted Memory Node');
          refreshAll();
        }
      }
    })
  );

  // ── Node Actions from TreeView ────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.boostMemory', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (!node?.id) return;
      await client.sendFeedback({ node_id: node.id, feedback_type: 'boost', strength: 0.15 });
      vscode.window.showInformationMessage('Boosted Memory Heat');
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.retractMemory', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (!node?.id) return;
      await client.sendFeedback({ node_id: node.id, feedback_type: 'retract', strength: 0.15 });
      vscode.window.showInformationMessage('Retracted Memory Heat');
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.pinMemory', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (!node?.id) return;
      const newPin = !node.is_pinned;
      await client.patchNode(node.id, { is_pinned: newPin, decay_class: newPin ? 'glacial' : 'normal' });
      vscode.window.showInformationMessage('Updated Memory Pin');
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.forgetMemory', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (!node?.id) return;
      const deleteBtn = formatButton('trash', 'Delete');
      const dismissBtn = formatButton('close', 'Dismiss');

      const confirm = await vscode.window.showWarningMessage(
        'Delete Memory Node',
        { modal: true },
        deleteBtn,
        dismissBtn
      );
      if (confirm === deleteBtn) {
        await client.deleteNode(node.id);
        vscode.window.showInformationMessage('Deleted Memory Node');
        refreshAll();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.copyMemoryId', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (node?.id) {
        await vscode.env.clipboard.writeText(node.id);
        vscode.window.showInformationMessage('Copied Identifier');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.copyMemoryText', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (node?.label) {
        await vscode.env.clipboard.writeText(node.label);
        vscode.window.showInformationMessage('Copied Content');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.promoteToRule', async (item?: MemoryItem | MemoryNode) => {
      const node = item instanceof MemoryItem ? item.node : item;
      if (node) {
        await promotionService.promoteMemoryToRule(node);
        vscode.window.showInformationMessage('Promoted To Rule');
        refreshAll();
      }
    })
  );

  // ── Namespace & Engine Controls ───────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.switchNamespace', async () => {
      const namespaces = await client.listNamespaces();
      const current = client.getConfig().namespace || 'default';

      const items = namespaces.map((ns) => ({
        label: sanitizeThreeWords(`Namespace ${ns}`),
        description: ns === current ? 'Active Selection' : undefined,
        iconPath: new vscode.ThemeIcon('server'),
        namespace: ns
      }));

      items.push({
        label: 'Create Custom Namespace',
        description: undefined,
        iconPath: new vscode.ThemeIcon('plus'),
        namespace: '__new__'
      });

      const selected = await vscode.window.showQuickPick(items, {
        title: 'Select Active Namespace'
      });

      if (!selected) return;

      let targetNs = selected.namespace;
      if (targetNs === '__new__') {
        const input = await vscode.window.showInputBox({
          title: 'Enter Namespace Name',
          prompt: 'Namespace Word'
        });
        if (!input) return;
        targetNs = input.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      }

      if (targetNs && targetNs !== current) {
        await setSulcusNamespace(targetNs);
        vscode.window.showInformationMessage('Switched Active Namespace');
        refreshAll();
      }
    })
  );

  // ── Activity Ledger Undo ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.undoLastTurn', async () => {
      const config = client.getConfig();
      try {
        const res = await client.undoTurn(config.namespace, 1);
        if (res && res.verified) {
          vscode.window.showInformationMessage('Rewound Activity Turn');
        } else {
          vscode.window.showInformationMessage('Triggered Activity Rewind');
        }
        refreshAll();
      } catch {
        vscode.window.showErrorMessage('Undo Failed');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.openDashboard', async () => {
      const baseUrl = await client.resolveTargetBaseUrl();
      await vscode.env.openExternal(vscode.Uri.parse(baseUrl));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.startDaemon', async () => {
      const ok = await daemon.startDaemon();
      if (ok) {
        vscode.window.showInformationMessage('Daemon Started Ready');
      } else {
        vscode.window.showErrorMessage('Daemon Start Failed');
      }
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.restartDaemon', async () => {
      const ok = await daemon.restartDaemon();
      if (ok) {
        vscode.window.showInformationMessage('Daemon Restarted Ready');
      } else {
        vscode.window.showErrorMessage('Daemon Restart Failed');
      }
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.configureMcp', async () => {
      await mcpService.configureMcp();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.configureHooks', async () => {
      await hookService.configureHooks(false);
      refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.signIn', async () => {
      await authManager.signIn();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.signOut', async () => {
      await authManager.signOut();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.refreshMemories', () => {
      refreshAll();
    })
  );

  // ── Memory Map Webview ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.openMemoryMap', () => {
      MemoryMapPanel.createOrShow(context.extensionUri, client, previewProvider);
    })
  );

  // ── Configure Instance Helper Functions ──────────────────────────────
  async function configureInstanceMode() {
    const currentUrl = client.getConfig().serverUrl;
    const isLocal = currentUrl.includes('127.0.0.1') || currentUrl.includes('localhost');

    const modePicks = [
      {
        label: 'Local Daemon Mode',
        description: isLocal ? 'Active Current Mode' : 'Port 4203 Daemon',
        detail: 'Local Offline Database',
        iconPath: new vscode.ThemeIcon('device-desktop'),
        mode: 'local'
      },
      {
        label: 'Cloud SaaS Mode',
        description: !isLocal ? 'Active Current Mode' : 'Remote API Endpoint',
        detail: 'Managed Cloud Storage',
        iconPath: new vscode.ThemeIcon('cloud'),
        mode: 'cloud'
      }
    ];

    const selected = await vscode.window.showQuickPick(modePicks, {
      title: 'Select Instance Mode'
    });

    if (!selected) return;

    if (selected.mode === 'local') {
      await setSulcusServerUrl('http://127.0.0.1:4203');
      client.updateConfig({ serverUrl: 'http://127.0.0.1:4203' });
      vscode.window.showInformationMessage('Switched Local Mode');
    } else {
      await setSulcusServerUrl('https://api.sulcus.ca');
      client.updateConfig({ serverUrl: 'https://api.sulcus.ca' });
      vscode.window.showInformationMessage('Switched Cloud Mode');
    }
    refreshAll();
  }

  async function configureAccessKey() {
    const currentKey = client.getConfig().apiKey || '';
    const newKey = await vscode.window.showInputBox({
      title: 'Cloud Access Key',
      prompt: 'Enter API Key',
      value: currentKey,
      password: true
    });

    if (newKey !== undefined) {
      await setSulcusApiKey(newKey.trim());
      client.updateConfig({ apiKey: newKey.trim() });
      vscode.window.showInformationMessage('Saved Access Key');
      refreshAll();
    }
  }

  // ── Configure Instance Command ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.configureInstance', async () => {
      const config = client.getConfig();
      const safeNs = sanitizeThreeWords(config.namespace, 'default');
      const isDaemonUp = await daemon.isDaemonHealthy();
      const isLocal = config.serverUrl.includes('127.0.0.1') || config.serverUrl.includes('localhost');
      const modeDesc = isLocal ? 'Local Daemon Mode' : 'Cloud SaaS Mode';

      const items = [
        {
          label: 'Switch Active Namespace',
          description: `Current ${safeNs}`,
          detail: 'Select Project Namespace',
          iconPath: new vscode.ThemeIcon('symbol-namespace'),
          action: 'switchNs'
        },
        {
          label: 'Switch Instance Mode',
          description: modeDesc,
          detail: 'Toggle Local Cloud',
          iconPath: new vscode.ThemeIcon('server'),
          action: 'switchMode'
        },
        {
          label: 'Configure MCP Server',
          description: 'Agent Tools Setup',
          detail: 'Configure Copilot Integration',
          iconPath: new vscode.ThemeIcon('tools'),
          action: 'mcp'
        },
        {
          label: 'Configure Agent Hooks',
          description: hookService.isHooksConfigured() ? 'Hooks Configured Active' : 'Hooks Not Configured',
          detail: 'Provision Copilot Hooks',
          iconPath: new vscode.ThemeIcon('plug'),
          action: 'hooks'
        },
        {
          label: 'Configure Access Key',
          description: config.apiKey ? 'Key Configured Active' : 'No Key Set',
          detail: 'Set Cloud Credentials',
          iconPath: new vscode.ThemeIcon('key'),
          action: 'apiKey'
        },
        {
          label: 'Restart Daemon Process',
          description: isDaemonUp ? 'Daemon Online Healthy' : 'Daemon Offline Stopped',
          detail: 'Restart Sulcus Daemon',
          iconPath: new vscode.ThemeIcon('refresh'),
          action: 'restartDaemon'
        },
        {
          label: 'Open Extension Settings',
          description: 'Visual Studio Configuration',
          detail: 'Adjust Sulcus Preferences',
          iconPath: new vscode.ThemeIcon('gear'),
          action: 'settings'
        }
      ];

      const pick = await vscode.window.showQuickPick(items, {
        title: 'Configure Sulcus Instance',
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (!pick) return;

      switch (pick.action) {
        case 'switchNs':
          vscode.commands.executeCommand('sulcus.switchNamespace');
          break;
        case 'switchMode':
          await configureInstanceMode();
          break;
        case 'mcp':
          vscode.commands.executeCommand('sulcus.configureMcp');
          break;
        case 'hooks':
          vscode.commands.executeCommand('sulcus.configureHooks');
          break;
        case 'apiKey':
          await configureAccessKey();
          break;
        case 'restartDaemon':
          vscode.commands.executeCommand('sulcus.restartDaemon');
          break;
        case 'settings':
          vscode.commands.executeCommand('workbench.action.openSettings', '@ext:sulcus.sulcus-vscode');
          break;
      }
    })
  );

  // ── Status Bar Quick Popout Menu ───────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sulcus.openQuickMenu', async () => {
      const config = client.getConfig();
      const safeNs = sanitizeThreeWords(config.namespace, 'default');
      const isDaemonUp = await daemon.isDaemonHealthy();
      const isLocal = config.serverUrl.includes('127.0.0.1') || config.serverUrl.includes('localhost');
      const modeDesc = isLocal ? 'Local Daemon Mode' : 'Cloud SaaS Mode';

      const items = [
        {
          label: 'Open Memory Map',
          description: 'Interactive Graph Visualizer',
          detail: 'Explore Knowledge Graph',
          iconPath: new vscode.ThemeIcon('graph'),
          action: 'openMap'
        },
        {
          label: 'Switch Active Namespace',
          description: `Current ${safeNs}`,
          detail: 'Select Project Namespace',
          iconPath: new vscode.ThemeIcon('symbol-namespace'),
          action: 'switchNs'
        },
        {
          label: 'Switch Instance Mode',
          description: modeDesc,
          detail: 'Toggle Local Cloud',
          iconPath: new vscode.ThemeIcon('server'),
          action: 'switchMode'
        },
        {
          label: 'Configure MCP Server',
          description: 'Agent Tools Setup',
          detail: 'Configure Copilot Integration',
          iconPath: new vscode.ThemeIcon('tools'),
          action: 'mcp'
        },
        {
          label: 'Configure Agent Hooks',
          description: hookService.isHooksConfigured() ? 'Hooks Configured Active' : 'Hooks Not Configured',
          detail: 'Provision Copilot Hooks',
          iconPath: new vscode.ThemeIcon('plug'),
          action: 'hooks'
        },
        {
          label: 'Configure Access Key',
          description: config.apiKey ? 'Key Configured Active' : 'No Key Set',
          detail: 'Set Cloud Credentials',
          iconPath: new vscode.ThemeIcon('key'),
          action: 'apiKey'
        },
        {
          label: 'Restart Daemon Process',
          description: isDaemonUp ? 'Daemon Online Healthy' : 'Daemon Offline Stopped',
          detail: 'Restart Sulcus Daemon',
          iconPath: new vscode.ThemeIcon('refresh'),
          action: 'restartDaemon'
        },
        {
          label: 'Search Sulcus Memories',
          description: 'Fast Memory Lookup',
          detail: 'Query Memory Store',
          iconPath: new vscode.ThemeIcon('search'),
          action: 'search'
        },
        {
          label: 'Open Extension Settings',
          description: 'Visual Studio Configuration',
          detail: 'Adjust Sulcus Preferences',
          iconPath: new vscode.ThemeIcon('gear'),
          action: 'settings'
        }
      ];

      const pick = await vscode.window.showQuickPick(items, {
        title: 'Sulcus Quick Menu',
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (!pick) return;

      switch (pick.action) {
        case 'openMap':
          vscode.commands.executeCommand('sulcus.openMemoryMap');
          break;
        case 'switchNs':
          vscode.commands.executeCommand('sulcus.switchNamespace');
          break;
        case 'switchMode':
          await configureInstanceMode();
          break;
        case 'mcp':
          vscode.commands.executeCommand('sulcus.configureMcp');
          break;
        case 'hooks':
          vscode.commands.executeCommand('sulcus.configureHooks');
          break;
        case 'apiKey':
          await configureAccessKey();
          break;
        case 'restartDaemon':
          vscode.commands.executeCommand('sulcus.restartDaemon');
          break;
        case 'search':
          vscode.commands.executeCommand('sulcus.searchMemories');
          break;
        case 'settings':
          vscode.commands.executeCommand('workbench.action.openSettings', '@ext:sulcus.sulcus-vscode');
          break;
      }
    })
  );
}
