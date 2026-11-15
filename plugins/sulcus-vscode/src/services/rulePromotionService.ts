import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MemoryNode } from '../types';
import { SulcusClient } from '../api/sulcusClient';

export class RulePromotionService {
  private client: SulcusClient;

  constructor(client: SulcusClient) {
    this.client = client;
  }

  public updateClient(client: SulcusClient) {
    this.client = client;
  }

  public async promoteMemoryToRule(node: MemoryNode): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('Please open a workspace folder to promote this memory into a project rule.');
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const defaultName = (node.label || 'rule')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .substring(0, 30)
      .replace(/^_+|_+$/g, '');

    const ruleName = await vscode.window.showInputBox({
      title: 'Promote Memory to Workspace Rule',
      prompt: 'Enter rule filename (will be saved in .agents/rules/)',
      value: `${defaultName || 'memory_rule'}.md`,
      validateInput: (v) => (v && v.endsWith('.md') ? null : 'Filename must end in .md')
    });

    if (!ruleName) return;

    const targetDir = path.join(rootPath, '.agents', 'rules');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, ruleName);
    const content = `# Rule: ${ruleName.replace(/\.md$/, '').replace(/_/g, ' ').toUpperCase()}

<!-- Promoted from Sulcus Memory Node (ID: ${node.id}, Type: ${node.memory_type || 'semantic'}) -->

${node.label}

## Directives
- Apply this rule across all agent interactions in this workspace.
- Retain this invariant as a hard operational constraint.
`;

    fs.writeFileSync(filePath, content, 'utf8');

    // Pin the source memory in Sulcus to freeze it
    try {
      await this.client.patchNode(node.id, { is_pinned: true, decay_class: 'glacial' });
    } catch {
      // Ignore patch failure
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('Promoted To Rule');
  }
}
