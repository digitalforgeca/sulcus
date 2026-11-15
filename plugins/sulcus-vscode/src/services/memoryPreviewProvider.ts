import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { MemoryNode } from '../types';
import { cleanMemoryLabel } from '../utils/format';

export class MemoryPreviewProvider implements vscode.TextDocumentContentProvider {
  static scheme = 'sulcus-memory';
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;
  private client: SulcusClient;
  private nodeCache: Map<string, MemoryNode> = new Map();

  constructor(client: SulcusClient) {
    this.client = client;
  }

  public updateClient(client: SulcusClient) {
    this.client = client;
    this.nodeCache.clear();
  }

  public cacheNode(node: MemoryNode) {
    if (node && node.id) {
      const cleanId = node.id.replace(/\.md$/i, '');
      const cleanNode = { ...node, id: cleanId };
      this.nodeCache.set(cleanId, cleanNode);
      const uri = vscode.Uri.parse(`${MemoryPreviewProvider.scheme}:///${cleanId}.md`);
      this._onDidChange.fire(uri);
    }
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const raw = (uri.authority || uri.path.replace(/^\//, '')).trim();
    const id = raw.replace(/\.md$/i, '');
    let node = this.nodeCache.get(id);

    if (!node) {
      try {
        node = await this.client.getNode(id);
        if (node) {
          this.nodeCache.set(id, node);
        }
      } catch {
        return `# Memory Not Found\n\nUnable to retrieve memory with ID \`${id}\`.`;
      }
    }

    if (!node) {
      return `# Memory Not Found\n\nUnable to retrieve memory with ID \`${id}\`.`;
    }

    const heat = node.current_heat !== undefined ? `${(node.current_heat * 100).toFixed(1)}%` : 'N/A';
    const pinned = node.is_pinned ? 'Yes' : 'No';
    const decay = node.decay_class || 'normal';
    const type = node.memory_type || 'semantic';
    const ns = node.namespace || 'default';
    const tags = Array.isArray(node.tags) && node.tags.length > 0 ? node.tags.join(', ') : 'None';
    const updated = node.updated_at || node.created_at || 'Unknown';
    const content = cleanMemoryLabel(node.label, node.pointer_summary);

    return `# Sulcus Memory Details

| Property | Value |
| --- | --- |
| Identifier | \`${node.id}\` |
| Memory Type | \`${type}\` |
| Memory Heat | \`${heat}\` |
| Pin Status | \`${pinned}\` |
| Decay Class | \`${decay}\` |
| Namespace | \`${ns}\` |
| Tags | \`${tags}\` |
| Updated | \`${updated}\` |

## Memory Content

${content || 'No content available'}
`;
  }
}
