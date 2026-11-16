import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { MemoryNode, MemoryType } from '../types';
import { sanitizeThreeWords } from '../utils/format';
import { MemoryPreviewProvider } from '../services/memoryPreviewProvider';

export class MemoryItem extends vscode.TreeItem {
  constructor(
    public readonly node: MemoryNode,
    public readonly isCategory: boolean = false,
    public readonly categoryId?: string,
    public readonly count?: number,
    previewProvider?: MemoryPreviewProvider
  ) {
    super(
      isCategory
        ? sanitizeThreeWords(categoryId || 'Memory Group')
        : sanitizeThreeWords(node.label || node.pointer_summary || 'Memory Node'),
      isCategory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    if (isCategory) {
      this.contextValue = 'memoryCategory';
      if (typeof count === 'number') {
        this.description = `${count} nodes`;
      }
      this.tooltip = sanitizeThreeWords(categoryId || 'Memory Group');
      this.iconPath = new vscode.ThemeIcon(
        categoryId === 'Pinned Memories'
          ? 'pin'
          : categoryId === 'Hot Memories'
          ? 'flame'
          : categoryId === 'Recent Memories'
          ? 'history'
          : categoryId === 'Memory Types'
          ? 'tag'
          : categoryId === 'All Namespaces'
          ? 'folder'
          : 'symbol-folder'
      );
    } else {
      this.contextValue = 'memoryItem';
      const heatPercent = Math.round((node.current_heat ?? 0) * 100);
      this.description = `${heatPercent} heat`;
      this.tooltip = new vscode.MarkdownString(
        `### ${sanitizeThreeWords(node.memory_type)} Memory\n\n` +
        `**ID**: \`${node.id}\`\n\n` +
        `**Namespace**: \`${node.namespace || 'default'}\`\n\n` +
        `**Heat**: ${heatPercent}%\n\n` +
        `---\n\n${node.label || 'No content'}`
      );
      this.tooltip.isTrusted = true;

      // Ensure NO shield, NO brain, and NO emoji icons
      this.iconPath = new vscode.ThemeIcon(
        node.is_pinned
          ? 'pin'
          : node.memory_type === 'fact'
          ? 'symbol-constant'
          : node.memory_type === 'preference'
          ? 'heart'
          : node.memory_type === 'procedural'
          ? 'list-ordered'
          : node.memory_type === 'episodic'
          ? 'calendar'
          : node.memory_type === 'synthesis'
          ? 'sparkle'
          : 'symbol-variable'
      );

      // Cache node in preview provider and set click command to open document
      if (previewProvider) {
        previewProvider.cacheNode(node);
      }
      this.command = {
        command: 'sulcus.openMemoryDetail',
        title: 'Open Memory Detail',
        arguments: [node]
      };
    }
  }
}

export class MemoryTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: SulcusClient;
  private previewProvider: MemoryPreviewProvider;
  private filterQuery?: string;

  constructor(client: SulcusClient, previewProvider: MemoryPreviewProvider) {
    this.client = client;
    this.previewProvider = previewProvider;
  }

  public updateClient(client: SulcusClient) {
    this.client = client;
    this.refresh();
  }

  public setFilter(query?: string) {
    this.filterQuery = query;
    this.refresh();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const config = this.client.getConfig();
    const activeNs = config.namespace || 'default';

    // Root level: high level categories
    if (!element) {
      try {
        const stats = await this.client.getDashboardStats();
        const activeRes = await this.client.listNodesPaginated(activeNs, 100, 0, this.filterQuery);
        const pinnedCount = activeRes.items.filter((n) => n.is_pinned).length;
        const totalActive = activeRes.total || activeRes.items.length;

        const categories: vscode.TreeItem[] = [
          new MemoryItem({ id: 'pinned', label: 'Pinned Memories' }, true, 'Pinned Memories', pinnedCount, this.previewProvider),
          new MemoryItem({ id: 'hot', label: 'Hot Memories' }, true, 'Hot Memories', Math.min(20, totalActive), this.previewProvider),
          new MemoryItem({ id: 'recent', label: 'Recent Memories' }, true, 'Recent Memories', totalActive, this.previewProvider),
          new MemoryItem({ id: 'types', label: 'Memory Types' }, true, 'Memory Types', undefined, this.previewProvider),
          new MemoryItem({ id: 'namespaces', label: 'All Namespaces' }, true, 'All Namespaces', stats?.namespace_counts?.length || 1, this.previewProvider)
        ];

        return categories;
      } catch {
        const empty = new vscode.TreeItem('Offline Engine Status');
        empty.iconPath = new vscode.ThemeIcon('circle-slash');
        empty.description = 'Daemon offline';
        empty.tooltip = 'Offline Engine Status';
        return [empty];
      }
    }

    // Branch: Category items
    if (element instanceof MemoryItem && element.isCategory) {
      const cat = element.categoryId;

      if (cat === 'Pinned Memories') {
        const res = await this.client.listNodesPaginated(activeNs, 100, 0, this.filterQuery);
        const pinned = res.items.filter((n) => n.is_pinned);
        if (pinned.length === 0) {
          const empty = new vscode.TreeItem('No Pinned Memories');
          empty.iconPath = new vscode.ThemeIcon('info');
          empty.tooltip = 'No Pinned Memories';
          return [empty];
        }
        return pinned.map((n) => new MemoryItem(n, false, undefined, undefined, this.previewProvider));
      }

      if (cat === 'Hot Memories') {
        const hotNodes = await this.client.getHotNodes(activeNs, 20);
        if (hotNodes.length === 0) {
          const empty = new vscode.TreeItem('No Hot Memories');
          empty.iconPath = new vscode.ThemeIcon('info');
          empty.tooltip = 'No Hot Memories';
          return [empty];
        }
        return hotNodes.map((n) => new MemoryItem(n, false, undefined, undefined, this.previewProvider));
      }

      if (cat === 'Recent Memories') {
        const res = await this.client.listNodesPaginated(activeNs, 50, 0, this.filterQuery);
        if (res.items.length === 0) {
          const empty = new vscode.TreeItem('No Active Memories');
          empty.iconPath = new vscode.ThemeIcon('info');
          empty.tooltip = 'No Active Memories';
          return [empty];
        }
        return res.items.map((n) => new MemoryItem(n, false, undefined, undefined, this.previewProvider));
      }

      if (cat === 'Memory Types') {
        const types: Array<{ name: string; type: MemoryType }> = [
          { name: 'Fact Memories', type: 'fact' },
          { name: 'Preference Memories', type: 'preference' },
          { name: 'Procedural Memories', type: 'procedural' },
          { name: 'Episodic Memories', type: 'episodic' },
          { name: 'Semantic Memories', type: 'semantic' },
          { name: 'Synthesis Memories', type: 'synthesis' }
        ];

        return types.map((t) => {
          const item = new vscode.TreeItem(t.name, vscode.TreeItemCollapsibleState.Collapsed);
          item.contextValue = 'memoryTypeFolder';
          item.id = `type_${t.type}`;
          item.tooltip = t.name;
          item.iconPath = new vscode.ThemeIcon(
            t.type === 'fact' ? 'symbol-constant' :
            t.type === 'preference' ? 'heart' :
            t.type === 'procedural' ? 'list-ordered' :
            t.type === 'episodic' ? 'calendar' :
            t.type === 'synthesis' ? 'sparkle' : 'book'
          );
          return item;
        });
      }

      if (cat === 'All Namespaces') {
        const namespaces = await this.client.listNamespaces();
        return namespaces.map((ns) => {
          const safeNsLabel = sanitizeThreeWords(`Namespace ${ns}`);
          const item = new vscode.TreeItem(safeNsLabel, vscode.TreeItemCollapsibleState.Collapsed);
          item.contextValue = 'namespaceFolder';
          item.id = `ns_${ns}`;
          item.tooltip = safeNsLabel;
          item.iconPath = new vscode.ThemeIcon('server');
          return item;
        });
      }
    }

    // Branch: Memory Type Folder
    if (element.id && element.id.startsWith('type_')) {
      const type = element.id.replace('type_', '') as MemoryType;
      const res = await this.client.listNodesPaginated(activeNs, 50, 0, this.filterQuery, type);
      if (res.items.length === 0) {
        const empty = new vscode.TreeItem('No Typed Memories');
        empty.iconPath = new vscode.ThemeIcon('info');
        empty.tooltip = 'No Typed Memories';
        return [empty];
      }
      return res.items.map((n) => new MemoryItem(n, false, undefined, undefined, this.previewProvider));
    }

    // Branch: Namespace Folder
    if (element.id && element.id.startsWith('ns_')) {
      const ns = element.id.replace('ns_', '');
      const res = await this.client.listNodesPaginated(ns, 50, 0, this.filterQuery);
      if (res.items.length === 0) {
        const empty = new vscode.TreeItem('No Namespace Memories');
        empty.iconPath = new vscode.ThemeIcon('info');
        empty.tooltip = 'No Namespace Memories';
        return [empty];
      }
      return res.items.map((n) => new MemoryItem(n, false, undefined, undefined, this.previewProvider));
    }

    return [];
  }
}
