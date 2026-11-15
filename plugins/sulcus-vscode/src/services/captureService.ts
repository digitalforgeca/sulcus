import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { CreateMemoryParams, DecayClass, MemoryNode, MemoryType } from '../types';

export class CaptureService {
  private client: SulcusClient;

  constructor(client: SulcusClient) {
    this.client = client;
  }

  public updateClient(client: SulcusClient) {
    this.client = client;
  }

  public cleanText(text: string): string {
    if (!text) return '';

    // 1. Clean large code blocks & markdown code blocks
    let cleaned = text
      .replace(/```[\s\S]*?```/g, '[code block removed]')
      .replace(/`([^`]{50,})`/g, '[code snippet removed]');

    // 2. Remove typical conversational greetings / fillers
    cleaned = cleaned
      .replace(/^(sure|yes|hello|hi|ok|okay|no problem),? I can help (you )?with that\.?/i, '')
      .replace(/let me know if you (need|have) any(thing|one) else\.?$/i, '')
      .replace(/^i will remember this:?\s*/i, '')
      .replace(/^CRITICAL FACT TO REMEMBER PERMANENTLY:?\s*/i, '')
      .replace(/^Fact:?\s*/i, '')
      .replace(/^By the way:?\s*/i, '')
      .replace(/^I will remember this\.\s*/i, '')
      .trim();

    // 3. Truncate cleanly at a sentence boundary if too long (800 chars max)
    if (cleaned.length > 800) {
      const truncated = cleaned.substring(0, 800);
      const lastPeriod = truncated.lastIndexOf('.');
      if (lastPeriod > 400) {
        cleaned = truncated.substring(0, lastPeriod + 1);
      } else {
        cleaned = truncated + '...';
      }
    }

    return cleaned;
  }

  public async captureText(
    rawText: string,
    options?: {
      overrideType?: MemoryType;
      isPinned?: boolean;
      decayClass?: DecayClass;
      namespace?: string;
      tags?: string[];
    }
  ): Promise<{ node?: MemoryNode; stored: boolean; reason?: string }> {
    const cleaned = this.cleanText(rawText);
    if (!cleaned || cleaned.length < 10) {
      return { stored: false, reason: 'Text is too short after cleaning (<10 chars).' };
    }

    const config = this.client.getConfig();
    const targetNamespace = options?.namespace || config.namespace || 'default';

    // 1. SIU Quality Gate & Classification
    let memoryType: MemoryType = options?.overrideType || 'semantic';
    let isPinned = options?.isPinned ?? false;

    if (!options?.overrideType) {
      const siuRes = await this.client.labelWithSIU(cleaned, false);
      if (siuRes.quality !== 'store') {
        return {
          stored: false,
          reason: `SIU Quality Gate rejected text: ${siuRes.reason || 'Not considered valuable long-term knowledge'}`
        };
      }
      if (siuRes.memory_type) {
        memoryType = siuRes.memory_type;
      }
    }

    // Heuristics for critical keywords
    if (rawText.includes('CRITICAL FACT TO REMEMBER PERMANENTLY') || rawText.includes('PERMANENT RULE:')) {
      memoryType = 'fact';
      isPinned = true;
    } else if (rawText.startsWith('Fact:')) {
      memoryType = 'fact';
    } else if (rawText.startsWith('Preference:') || rawText.toLowerCase().includes('user prefers')) {
      memoryType = 'preference';
    }

    // 2. Persist to Sulcus
    const node = await this.client.createNode({
      label: cleaned,
      memory_type: memoryType,
      is_pinned: isPinned,
      decay_class: options?.decayClass || (isPinned ? 'glacial' : 'normal'),
      namespace: targetNamespace,
      tags: options?.tags
    });

    return { node, stored: true };
  }

  public async captureSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor selection to capture.');
      return;
    }

    const selectionText = editor.document.getText(editor.selection).trim();
    if (!selectionText) {
      vscode.window.showWarningMessage('Please highlight the text you want to capture into Sulcus.');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Sulcus: Evaluating and capturing memory via SIU...',
        cancellable: false
      },
      async () => {
        const result = await this.captureText(selectionText);
        if (result.stored && result.node) {
          vscode.window.showInformationMessage('Captured Memory Node');
        } else {
          vscode.window.showWarningMessage(`Sulcus capture skipped: ${result.reason || 'Unknown reason'}`);
        }
      }
    );
  }

  public async captureInteractive(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const initialText = editor ? editor.document.getText(editor.selection).trim() : '';

    const text = await vscode.window.showInputBox({
      title: 'Sulcus: Create Memory Node',
      prompt: 'Enter memory content, architectural fact, decision, or user preference',
      value: initialText,
      validateInput: (val) => (val && val.trim().length >= 10 ? null : 'Must be at least 10 characters')
    });

    if (!text) return;

    const memoryTypePick = await vscode.window.showQuickPick(
      [
        { label: 'Auto Classify', description: 'Automatic utility scoring', value: undefined },
        { label: 'Semantic Memory', description: 'Concepts and architecture', value: 'semantic' as MemoryType },
        { label: 'Fact Memory', description: 'Invariants and endpoints', value: 'fact' as MemoryType },
        { label: 'Preference Memory', description: 'User coding style', value: 'preference' as MemoryType },
        { label: 'Procedural Memory', description: 'Runbooks and steps', value: 'procedural' as MemoryType },
        { label: 'Episodic Memory', description: 'Milestones and summaries', value: 'episodic' as MemoryType }
      ],
      { title: 'Select Memory Type' }
    );

    if (!memoryTypePick) return;

    const pinPick = await vscode.window.showQuickPick(
      [
        { label: 'Normal Decay', description: 'Standard thermodynamic decay', value: false },
        { label: 'Pinned Permanent', description: 'Permanently retained node', value: true }
      ],
      { title: 'Select Pin Option' }
    );

    if (!pinPick) return;

    const decayPick = await vscode.window.showQuickPick(
      [
        { label: 'Normal Decay', description: 'Standard decay curve', value: 'normal' as DecayClass },
        { label: 'Slow Decay', description: 'Long half life', value: 'slow' as DecayClass },
        { label: 'Glacial Decay', description: 'Minimal decay curve', value: 'glacial' as DecayClass },
        { label: 'Fast Decay', description: 'Rapid decay curve', value: 'fast' as DecayClass }
      ],
      { title: 'Select Decay Class' }
    );

    if (!decayPick) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Persisting Memory Node',
        cancellable: false
      },
      async () => {
        const result = await this.captureText(text, {
          overrideType: memoryTypePick.value,
          isPinned: pinPick.value,
          decayClass: decayPick.value
        });

        if (result.stored && result.node) {
          vscode.window.showInformationMessage('Created Memory Node');
        } else {
          vscode.window.showErrorMessage('Failed Creating Memory');
        }
      }
    );
  }
}
