import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { RecallService } from '../services/recallService';
import { CaptureService } from '../services/captureService';
import { MemoryType } from '../types';

export function registerLanguageModelTools(
  context: vscode.ExtensionContext,
  client: SulcusClient,
  recallService: RecallService,
  captureService: CaptureService
) {
  const lm = (vscode as any).lm;
  if (!lm || typeof lm.registerTool !== 'function') {
    return;
  }

  // 1. sulcus_recall Tool
  try {
    context.subscriptions.push(
      lm.registerTool('sulcus_recall', {
        async invoke(
          options: { input: { query: string; context?: string; limit?: number } },
          _token: vscode.CancellationToken
        ) {
          const { query, context: ctx, limit } = options.input;
          const result = await recallService.recallForPrompt(query, ctx, limit);
          return new (vscode as any).LanguageModelToolResult([
            new (vscode as any).LanguageModelTextPart(
              result.formattedBlock || 'No relevant memories found in Sulcus.'
            )
          ]);
        }
      })
    );
  } catch {
    // Tool already registered or LM API mismatch
  }

  // 2. sulcus_capture Tool
  try {
    context.subscriptions.push(
      lm.registerTool('sulcus_capture', {
        async invoke(
          options: {
            input: {
              text: string;
              memory_type?: MemoryType;
              is_pinned?: boolean;
              tags?: string[];
            };
          },
          _token: vscode.CancellationToken
        ) {
          const { text, memory_type, is_pinned, tags } = options.input;
          const res = await captureService.captureText(text, {
            overrideType: memory_type,
            isPinned: is_pinned,
            tags
          });

          if (res.stored && res.node) {
            return new (vscode as any).LanguageModelToolResult([
              new (vscode as any).LanguageModelTextPart(
                `Successfully recorded memory into Sulcus (ID: ${res.node.id}, Type: ${res.node.memory_type}, Pinned: ${res.node.is_pinned})`
              )
            ]);
          } else {
            return new (vscode as any).LanguageModelToolResult([
              new (vscode as any).LanguageModelTextPart(
                `Sulcus skipped recording: ${res.reason || 'Not evaluated as long-term knowledge'}`
              )
            ]);
          }
        }
      })
    );
  } catch {
    // Tool already registered or LM API mismatch
  }

  // 3. sulcus_boost Tool
  try {
    context.subscriptions.push(
      lm.registerTool('sulcus_boost', {
        async invoke(
          options: { input: { node_id: string; strength?: number } },
          _token: vscode.CancellationToken
        ) {
          const { node_id, strength } = options.input;
          const ok = await client.sendFeedback({
            node_id,
            feedback_type: 'boost',
            strength: strength || 0.15
          });
          return new (vscode as any).LanguageModelToolResult([
            new (vscode as any).LanguageModelTextPart(
              ok ? `Boosted heat for memory node ${node_id}` : `Failed to boost memory node ${node_id}`
            )
          ]);
        }
      })
    );
  } catch {
    // Tool already registered or LM API mismatch
  }

  // 4. sulcus_forget Tool
  try {
    context.subscriptions.push(
      lm.registerTool('sulcus_forget', {
        async invoke(
          options: { input: { node_id: string } },
          _token: vscode.CancellationToken
        ) {
          const { node_id } = options.input;
          const ok = await client.deleteNode(node_id);
          return new (vscode as any).LanguageModelToolResult([
            new (vscode as any).LanguageModelTextPart(
              ok ? `Successfully removed memory node ${node_id}` : `Failed to delete memory node ${node_id}`
            )
          ]);
        }
      })
    );
  } catch {
    // Tool already registered or LM API mismatch
  }
}
