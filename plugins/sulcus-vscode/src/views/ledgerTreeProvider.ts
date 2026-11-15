import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { sanitizeThreeWords } from '../utils/format';

export class LedgerItem extends vscode.TreeItem {
  constructor(
    public readonly entry: any,
    public readonly isHeader: boolean = false
  ) {
    super(
      isHeader
        ? sanitizeThreeWords(entry.title || 'Ledger Entry')
        : sanitizeThreeWords(entry.tool_name || entry.event_type || 'Activity Turn'),
      vscode.TreeItemCollapsibleState.None
    );

    if (isHeader) {
      this.contextValue = 'ledgerHeader';
      this.iconPath = new vscode.ThemeIcon('list-flat');
      this.tooltip = sanitizeThreeWords(entry.title || 'Ledger Entry');
    } else {
      this.contextValue = 'ledgerTurn';
      const file = Array.isArray(entry.files_touched) && entry.files_touched[0]
        ? sanitizeThreeWords(entry.files_touched[0])
        : 'Workspace Change';
      this.description = file;
      this.tooltip = new vscode.MarkdownString(
        `### Activity Ledger Turn\n\n` +
        `**Tool**: \`${entry.tool_name || 'edit'}\`\n\n` +
        `**Namespace**: \`${entry.namespace || 'default'}\`\n\n` +
        `**Session**: \`${entry.session_id || 'unknown'}\`\n\n` +
        `**Timestamp**: \`${entry.timestamp || 'recent'}\`\n\n` +
        (entry.files_touched ? `**Files**: ${JSON.stringify(entry.files_touched)}\n\n` : '')
      );
      this.tooltip.isTrusted = true;
      this.iconPath = new vscode.ThemeIcon(
        entry.tool_name === 'write_file'
          ? 'edit'
          : entry.tool_name === 'delete'
          ? 'trash'
          : 'history'
      );
    }
  }
}

export class LedgerTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private client: SulcusClient;

  constructor(client: SulcusClient) {
    this.client = client;
  }

  public updateClient(client: SulcusClient) {
    this.client = client;
    this.refresh();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) return [];

    try {
      const config = this.client.getConfig();
      const entries = await this.client.getLedger(config.namespace, 25);

      if (!entries || entries.length === 0) {
        const empty = new vscode.TreeItem('No Ledger Records');
        empty.iconPath = new vscode.ThemeIcon('info');
        empty.description = 'Activity recorded here';
        empty.tooltip = 'Activity Recorded Here';
        return [empty];
      }

      return entries.map((e) => new LedgerItem(e, false));
    } catch {
      const err = new vscode.TreeItem('Ledger Offline');
      err.iconPath = new vscode.ThemeIcon('circle-slash');
      err.description = 'Daemon offline';
      err.tooltip = 'Ledger Offline Status';
      return [err];
    }
  }
}
