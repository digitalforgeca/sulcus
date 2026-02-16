import * as vscode from "vscode";
import { spawn } from "child_process";

let output: vscode.OutputChannel | undefined;
let lastSummary: string | undefined;

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
    // sulcus-local summarize reads stdin when no text arg provided
    const out = await runSulcus(["summarize"], text);
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
  const bin = cfg<string>("binPath", "sulcus-local");
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, ["add-memory", summary, "100.0"]);
      let stderr = "";
      proc.on("error", (err: any) =>
        reject(new Error(`failed to start ${bin}: ${err.message}`)),
      );
      proc.stderr.on("data", (b) => (stderr += b.toString()));
      proc.on("close", (code) => {
        if (code !== 0)
          return reject(new Error(stderr || `sulcus add-memory exit ${code}`));
        resolve();
      });
    });
    vscode.window.showInformationMessage("Sulcus: memory recorded locally");
  } catch (e: any) {
    vscode.window.showErrorMessage(`Sulcus add-memory failed: ${e.message}`);
  }
}

async function showActiveIndex() {
  try {
    const out = await runSulcus(["show-active"]);
    const oc = ensureOutput();
    oc.appendLine("--- sulcus active index ---");
    oc.appendLine(out + "\n");
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
    const out = await runSulcus(["describe-tools"]);
    let pretty = out;
    try {
      pretty = JSON.stringify(JSON.parse(out), null, 2);
    } catch (_) {}
    const oc = ensureOutput();
    oc.appendLine("--- sulcus tools manifest ---");
    oc.appendLine(pretty + "\n");
    oc.show(true);
    vscode.window.showInformationMessage("Sulcus: tools manifest shown");
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Sulcus describe-tools failed: ${e.message}`,
    );
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
  if (output) output.dispose();
}
