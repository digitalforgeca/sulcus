import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";

// MCP SDK (SSE) transport
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
// Node EventSource polyfill required by the SDK
const EventSource = require("eventsource");
(global as any).EventSource = EventSource;

let output: vscode.OutputChannel | undefined;
let lastSummary: string | undefined;

// Persistent daemon handle (we may still spawn the binary but do not pipe IO)
let daemonProcess: ChildProcess | undefined;

// MCP client instance (preferred transport)
let mcpClient: any | undefined;

// legacy fallback plumbing kept for compatibility
let messageId = 1;
const pendingRequests = new Map<
  number,
  { resolve: Function; reject: Function }
>();

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
  const bin = cfg<string>("binPath", "sulcus");
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
  // Prefer the MCP SDK client when connected
  if (mcpClient) {
    switch (method) {
      case "tools/call":
        return await mcpClient.callTool({
          name: params.name,
          arguments: params.arguments,
        });
      case "resources/read":
        return await mcpClient.readResource({
          uri: params.uri,
          limit: params.limit,
        });
      case "tools/list":
        return await mcpClient.listTools();
      default:
        // Fall back to a raw request for other methods
        return await mcpClient.request({ method, params });
    }
  }

  // Legacy stdio-based fallback (kept for backward compatibility)
  if (!daemonProcess || !daemonProcess.stdin) {
    throw new Error("sulcus daemon not running");
  }
  const id = messageId++;
  const payload = { jsonrpc: "2.0", id, method, params };
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    try {
      daemonProcess!.stdin!.write(JSON.stringify(payload) + "\n", (err) => {
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
    const to = setTimeout(
      () => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error("timeout waiting for sulcus response"));
        }
      },
      cfg<number>("requestTimeoutMs", 10000),
    );
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
    const res = await sendMcpRequest("tools/call", {
      name: "summarize",
      arguments: { text, max_chars: maxChars },
    });
    const contentText = res?.content?.[0]?.text || "{}";
    const inner = JSON.parse(contentText);
    const out = inner.summary ?? "";
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
  // keep payload small (LocalStorage will truncate summary to 200 chars)
  const summary = text.length > 200 ? text.slice(0, 200) : text;
  try {
    const res = await sendMcpRequest("tools/call", {
      name: "add_memory",
      arguments: { content: summary },
    });
    const contentText = res?.content?.[0]?.text || "{}";
    const inner = JSON.parse(contentText);
    if (inner.node_id) {
      vscode.window.showInformationMessage("Sulcus: memory recorded locally");
    } else {
      vscode.window.showWarningMessage(
        "Sulcus: add_memory completed (no node_id returned)",
      );
    }
  } catch (e: any) {
    vscode.window.showErrorMessage(`Sulcus add-memory failed: ${e.message}`);
  }
}

async function showActiveIndex() {
  try {
    const res = await sendMcpRequest("resources/read", {
      uri: "memory://active_index",
      limit: 20,
    });
    const contents = res?.contents ?? [];
    const text = contents[0]?.text ?? "[]";
    const arr = JSON.parse(text);
    const oc = ensureOutput();
    oc.appendLine("--- sulcus active index ---");
    oc.appendLine(JSON.stringify(arr, null, 2) + "\n");
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
    const res = await sendMcpRequest("tools/list", {});
    const tools = res?.tools ?? [];
    const pretty = JSON.stringify({ tools }, null, 2);
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
  // Establish MCP SSE connection to `sulcus` using the official SDK.
  // If the sidecar isn't reachable, spawn it (do NOT pipe stdio) and retry.
  const bin = cfg<string>("binPath", "sulcus");

  async function ensureMcpConnected() {
    const transport = new SSEClientTransport(
      new URL("http://127.0.0.1:8173/sse"),
    );
    const client = new Client(
      { name: "vscode-sulcus", version: "1.0.0" },
      { capabilities: {} as any },
    );

    try {
      await client.connect(transport);
      mcpClient = client;
      ensureOutput().appendLine("Connected to sulcus via MCP SSE");
      // warm tool metadata
      await mcpClient.listTools().catch(() => {});
      return;
    } catch (err) {
      ensureOutput().appendLine(
        "sulcus unreachable via SSE; attempting to spawn daemon...",
      );
      // spawn daemon but do not pipe IO
      if (!daemonProcess) {
        daemonProcess = spawn(bin, ["serve"], {
          env: process.env,
          stdio: "ignore",
          detached: true,
        });
        try {
          daemonProcess.unref();
        } catch (_) {}
        ensureOutput().appendLine(`Spawned sulcus daemon (${bin} serve)`);
        daemonProcess.on("exit", (code, sig) => {
          ensureOutput().appendLine(
            `sulcus daemon exited code=${code} signal=${sig}`,
          );
          if (mcpClient && typeof mcpClient.close === "function") {
            try {
              mcpClient.close();
            } catch (_) {}
          }
          mcpClient = undefined;
          daemonProcess = undefined;
        });
      }

      // retry connect with backoff
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
        try {
          await client.connect(transport);
          mcpClient = client;
          ensureOutput().appendLine(
            "Connected to sulcus via MCP SSE (spawned)",
          );
          await mcpClient.listTools().catch(() => {});
          return;
        } catch (_) {
          // continue retrying
        }
      }
      ensureOutput().appendLine(
        "Failed to connect to sulcus via SSE after spawn attempts",
      );
    }
  }

  ensureMcpConnected().catch((err) =>
    ensureOutput().appendLine(
      `sulcus: MCP connect error: ${err?.message || err}`,
    ),
  );

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
