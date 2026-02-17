import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";

let output: vscode.OutputChannel | undefined;
let lastSummary: string | undefined;

// Persistent daemon + request/response plumbing
let daemonProcess: ChildProcess | undefined;
let messageId = 1;
const pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

function cfg<T>(key: string, fallback: T): T {
  return vscode.workspace
    .getConfiguration("sulcus")
    .get<T>(key, fallback as any);
}

function ensureOutput(): vscode.OutputChannel {
  if (!output) output = vscode.window.createOutputChannel("Sulcus");
  return output;
}

async function runSulcus(args: string[], input?: string): Promise<string> {
  // kept for backward-compat but commands now use the persistent daemon via sendMcpRequest
  const bin = cfg<string>("binPath", "sulcus-local");
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b) => (stdout += b.toString()));
    proc.stderr.on("data", (b) => (stderr += b.toString()));
    proc.on("error", (err: any) =>
      reject(new Error(`failed to start ${bin}: ${err.message}`)),
    );
    proc.on("close", (code) => {
      if (code !== 0)
        return reject(new Error(stderr || `sulcus exited ${code}`));
      resolve(stdout.trim());
    });
    if (input) proc.stdin.write(input);
    proc.stdin.end();
  });
}

async function sendMcpRequest(method: string, params?: any): Promise<any> {
  if (!daemonProcess || !daemonProcess.stdin) {
    throw new Error('sulcus-local daemon not running');
  }
  const id = messageId++;
  const payload = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    try {
      daemonProcess!.stdin!.write(JSON.stringify(payload) + '\n', (err) => {
        if (err) {
          pendingRequests.delete(id);
          return reject(err);
        }
      });
    } catch (err) {
      pendingRequests.delete(id);
      return reject(err);
    }
    // timeout
    const to = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('timeout waiting for sulcus-local response'));
      }
    }, cfg<number>('requestTimeoutMs', 10000));
    // clear timeout on resolution is handled by the receiver
  });
}

async function summarizeSelection() {
  const editor = vscode.window.activeTextEditor;
  const selectionText = editor
    ? editor.document.getText(editor.selection).trim()
    : "";
  const defaultText =
    selectionText || (editor ? editor.document.getText() : "");
  const text =
    defaultText ||
    (await vscode.window.showInputBox({
      prompt: "Text to summarize for Sulcus (local)",
    }));
  if (!text) return;
  const maxChars = cfg<number>("maxSummaryChars", 500);
  try {
    const res = await sendMcpRequest('tools/call', { name: 'summarize', arguments: { text, max_chars: maxChars } });
    const contentText = res?.content?.[0]?.text || '{}';
    const inner = JSON.parse(contentText);
    const out = inner.summary ?? '';
    lastSummary = out;
    ensureOutput().appendLine("--- sulcus summary ---");
    ensureOutput().appendLine(out + "\n");
    ensureOutput().show(true);
    vscode.window.showInformationMessage(
      "Sulcus: summary ready (Output channel)",
    );
  } catch (e: any) {
    vscode.window.showErrorMessage(`Sulcus summarize failed: ${e.message}`);
  }
}

async function addMemory() {
  const editor = vscode.window.activeTextEditor;
  const selectionText = editor
    ? editor.document.getText(editor.selection).trim()
    : "";
  const text =
    selectionText ||
    (await vscode.window.showInputBox({
      prompt: "Text to add to Sulcus memory",
    }));
  if (!text) return;
  // keep payload small (SqliteStorage will truncate summary to 200 chars)
  const summary = text.length > 200 ? text.slice(0, 200) : text;
  try {
    const res = await sendMcpRequest('tools/call', { name: 'add_memory', arguments: { content: summary } });
    const contentText = res?.content?.[0]?.text || '{}';
    const inner = JSON.parse(contentText);
    if (inner.node_id) {
      vscode.window.showInformationMessage("Sulcus: memory recorded locally");
    } else {
      vscode.window.showWarningMessage("Sulcus: add_memory completed (no node_id returned)");
    }
  } catch (e: any) {
    vscode.window.showErrorMessage(`Sulcus add-memory failed: ${e.message}`);
  }
}

async function showActiveIndex() {
  try {
    const res = await sendMcpRequest('resources/read', { uri: 'memory://active_index', limit: 20 });
    const contents = res?.contents ?? [];
    const text = contents[0]?.text ?? '[]';
    const arr = JSON.parse(text);
    const oc = ensureOutput();
    oc.appendLine('--- sulcus active index ---');
    oc.appendLine(JSON.stringify(arr, null, 2) + '\n');
    oc.show(true);
  } catch (e: any) {
    vscode.window.showErrorMessage(`Sulcus show-active failed: ${e.message}`);
  }
}

async function sendToSumr() {
  if (!lastSummary) {
    vscode.window.showWarningMessage(
      "No summary available — run Sulcus: Summarize Selection first",
    );
    return;
  }
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes("sumr.importConversationSummary")) {
    vscode.window.showErrorMessage(
      "SUMR extension not available in this workspace",
    );
    return;
  }

  const short =
    lastSummary.length > 140 ? lastSummary.slice(0, 140) + "…" : lastSummary;
  try {
    await vscode.commands.executeCommand("sumr.importConversationSummary", {
      summary: lastSummary,
      file:
        vscode.window.activeTextEditor?.document.uri.toString() || undefined,
      shortSummary: short,
      persist: true,
    });
    vscode.window.showInformationMessage("Sent summary to SUMR");
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to send to SUMR: ${e.message}`);
  }
}

async function describeTools() {
  try {
    const res = await sendMcpRequest('tools/list', {});
    const tools = res?.tools ?? [];
    const pretty = JSON.stringify({ tools }, null, 2);
    const oc = ensureOutput();
    oc.appendLine('--- sulcus tools manifest ---');
    oc.appendLine(pretty + '\n');
    oc.show(true);
    vscode.window.showInformationMessage('Sulcus: tools manifest shown');
  } catch (e: any) {
    vscode.window.showErrorMessage(`Sulcus describe-tools failed: ${e.message}`);
  }
}

export type SulcusAPI = {
  summarizeSelection: () => Promise<void>;
  addMemory: () => Promise<void>;
  showActiveIndex: () => Promise<void>;
  sendToSumr: () => Promise<void>;
  describeTools: () => Promise<void>;
  getLastSummary: () => string | undefined;
  showOutput: () => void;
};

export function activate(context: vscode.ExtensionContext): SulcusAPI {
  // start persistent sulcus-local daemon
  const bin = cfg<string>("binPath", "sulcus-local");
  try {
    daemonProcess = spawn(bin, ["serve"], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    ensureOutput().appendLine(`Started sulcus-local daemon (${bin} serve)`);
    // pipe stderr to OutputChannel
    if (daemonProcess.stderr) {
      daemonProcess.stderr.on("data", (b) => ensureOutput().appendLine(b.toString()));
    }
    // listen for JSON-RPC lines on stdout
    if (daemonProcess.stdout) {
      const rl = readline.createInterface({ input: daemonProcess.stdout });
      rl.on("line", (line: string) => {
        try {
          const obj = JSON.parse(line);
          const id = obj && obj.id;
          if (typeof id === "number" && pendingRequests.has(id)) {
            const { resolve } = pendingRequests.get(id)!;
            pendingRequests.delete(id);
            resolve(obj.result);
            return;
          }
          // if id is string, ignore here (we only track numeric requests from this extension)
        } catch (err) {
          // ignore non-json output
        }
      });
    }
    daemonProcess.on("exit", (code, sig) => {
      ensureOutput().appendLine(`sulcus-local daemon exited code=${code} signal=${sig}`);
      // reject all pending
      for (const { reject } of pendingRequests.values()) {
        try { reject(new Error('sulcus-local daemon exited')); } catch (_) {}
      }
      pendingRequests.clear();
      daemonProcess = undefined;
    });
  } catch (e: any) {
    ensureOutput().appendLine(`failed to spawn sulcus-local daemon: ${e.message}`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sulcus.summarizeSelection",
      summarizeSelection,
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("sulcus.addMemory", addMemory),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("sulcus.showActiveIndex", showActiveIndex),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("sulcus.sendToSumr", sendToSumr),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("sulcus.describeTools", describeTools),
  );

  // stable public API exposed to other extensions
  const api: SulcusAPI = {
    summarizeSelection,
    addMemory,
    showActiveIndex,
    sendToSumr,
    describeTools,
    getLastSummary: () => lastSummary,
    showOutput: () => ensureOutput().show(true),
  };

  ensureOutput().appendLine("Sulcus VS Code helper activated");
  return api;
}

export function deactivate() {
  if (daemonProcess) {
    try {
      daemonProcess.kill();
    } catch (e) {
      /* ignore */
    }
    daemonProcess = undefined;
  }
  if (output) output.dispose();
}
