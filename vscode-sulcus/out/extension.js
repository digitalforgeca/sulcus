"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
// MCP SDK (SSE) transport
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/client/sse.js");
// Node EventSource polyfill required by the SDK
const EventSource = require("eventsource");
global.EventSource = EventSource;
let output;
let lastSummary;
// Persistent daemon handle (we may still spawn the binary but do not pipe IO)
let daemonProcess;
// MCP client instance (preferred transport)
let mcpClient;
// legacy fallback plumbing kept for compatibility
let messageId = 1;
const pendingRequests = new Map();
function cfg(key, fallback) {
    return vscode.workspace
        .getConfiguration("sulcus")
        .get(key, fallback);
}
function ensureOutput() {
    if (!output)
        output = vscode.window.createOutputChannel("Sulcus");
    return output;
}
async function runSulcus(args, input) {
    // kept for backward-compat but commands now use the persistent daemon via sendMcpRequest
    const bin = cfg("binPath", "sulcus-local");
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (b) => (stdout += b.toString()));
        proc.stderr.on("data", (b) => (stderr += b.toString()));
        proc.on("error", (err) => reject(new Error(`failed to start ${bin}: ${err.message}`)));
        proc.on("close", (code) => {
            if (code !== 0)
                return reject(new Error(stderr || `sulcus exited ${code}`));
            resolve(stdout.trim());
        });
        if (input)
            proc.stdin.write(input);
        proc.stdin.end();
    });
}
async function sendMcpRequest(method, params) {
    // Prefer the MCP SDK client when connected
    if (mcpClient) {
        switch (method) {
            case "tools/call":
                return await mcpClient.callTool({ name: params.name, arguments: params.arguments });
            case "resources/read":
                return await mcpClient.readResource({ uri: params.uri, limit: params.limit });
            case "tools/list":
                return await mcpClient.listTools();
            default:
                // Fall back to a raw request for other methods
                return await mcpClient.request({ method, params });
        }
    }
    // Legacy stdio-based fallback (kept for backward compatibility)
    if (!daemonProcess || !daemonProcess.stdin) {
        throw new Error("sulcus-local daemon not running");
    }
    const id = messageId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        try {
            daemonProcess.stdin.write(JSON.stringify(payload) + "\n", (err) => {
                if (err) {
                    pendingRequests.delete(id);
                    return reject(err);
                }
            });
        }
        catch (err) {
            pendingRequests.delete(id);
            return reject(err);
        }
        // timeout
        const to = setTimeout(() => {
            if (pendingRequests.has(id)) {
                pendingRequests.delete(id);
                reject(new Error("timeout waiting for sulcus-local response"));
            }
        }, cfg("requestTimeoutMs", 10000));
        // clear timeout on resolution is handled by the receiver
    });
}
async function summarizeSelection() {
    const editor = vscode.window.activeTextEditor;
    const selectionText = editor
        ? editor.document.getText(editor.selection).trim()
        : "";
    const defaultText = selectionText || (editor ? editor.document.getText() : "");
    const text = defaultText ||
        (await vscode.window.showInputBox({
            prompt: "Text to summarize for Sulcus (local)",
        }));
    if (!text)
        return;
    const maxChars = cfg("maxSummaryChars", 500);
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
        vscode.window.showInformationMessage("Sulcus: summary ready (Output channel)");
    }
    catch (e) {
        vscode.window.showErrorMessage(`Sulcus summarize failed: ${e.message}`);
    }
}
async function addMemory() {
    const editor = vscode.window.activeTextEditor;
    const selectionText = editor
        ? editor.document.getText(editor.selection).trim()
        : "";
    const text = selectionText ||
        (await vscode.window.showInputBox({
            prompt: "Text to add to Sulcus memory",
        }));
    if (!text)
        return;
    // keep payload small (SqliteStorage will truncate summary to 200 chars)
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
        }
        else {
            vscode.window.showWarningMessage("Sulcus: add_memory completed (no node_id returned)");
        }
    }
    catch (e) {
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
    }
    catch (e) {
        vscode.window.showErrorMessage(`Sulcus show-active failed: ${e.message}`);
    }
}
async function sendToSumr() {
    if (!lastSummary) {
        vscode.window.showWarningMessage("No summary available — run Sulcus: Summarize Selection first");
        return;
    }
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes("sumr.importConversationSummary")) {
        vscode.window.showErrorMessage("SUMR extension not available in this workspace");
        return;
    }
    const short = lastSummary.length > 140 ? lastSummary.slice(0, 140) + "…" : lastSummary;
    try {
        await vscode.commands.executeCommand("sumr.importConversationSummary", {
            summary: lastSummary,
            file: vscode.window.activeTextEditor?.document.uri.toString() || undefined,
            shortSummary: short,
            persist: true,
        });
        vscode.window.showInformationMessage("Sent summary to SUMR");
    }
    catch (e) {
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
    }
    catch (e) {
        vscode.window.showErrorMessage(`Sulcus describe-tools failed: ${e.message}`);
    }
}
function activate(context) {
    // Establish MCP SSE connection to `sulcus-local` using the official SDK.
    // If the sidecar isn't reachable, spawn it (do NOT pipe stdio) and retry.
    const bin = cfg("binPath", "sulcus-local");
    async function ensureMcpConnected() {
        const transport = new sse_js_1.SSEClientTransport(new URL("http://127.0.0.1:8173/sse"));
        const client = new index_js_1.Client({ name: "vscode-sulcus", version: "1.0.0" }, { capabilities: { tools: {}, resources: {} } });
        try {
            await client.connect(transport);
            mcpClient = client;
            ensureOutput().appendLine("Connected to sulcus-local via MCP SSE");
            // warm tool metadata
            await mcpClient.listTools().catch(() => { });
            return;
        }
        catch (err) {
            ensureOutput().appendLine("sulcus-local unreachable via SSE; attempting to spawn daemon...");
            // spawn daemon but do not pipe IO
            if (!daemonProcess) {
                daemonProcess = (0, child_process_1.spawn)(bin, ["serve"], { env: process.env, stdio: "ignore", detached: true });
                try {
                    daemonProcess.unref();
                }
                catch (_) { }
                ensureOutput().appendLine(`Spawned sulcus-local daemon (${bin} serve)`);
                daemonProcess.on("exit", (code, sig) => {
                    ensureOutput().appendLine(`sulcus-local daemon exited code=${code} signal=${sig}`);
                    if (mcpClient && typeof mcpClient.close === "function") {
                        try {
                            mcpClient.close();
                        }
                        catch (_) { }
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
                    ensureOutput().appendLine("Connected to sulcus-local via MCP SSE (spawned)");
                    await mcpClient.listTools().catch(() => { });
                    return;
                }
                catch (_) {
                    // continue retrying
                }
            }
            ensureOutput().appendLine("Failed to connect to sulcus-local via SSE after spawn attempts");
        }
    }
    ensureMcpConnected().catch((err) => ensureOutput().appendLine(`sulcus: MCP connect error: ${err?.message || err}`));
    context.subscriptions.push(vscode.commands.registerCommand("sulcus.summarizeSelection", summarizeSelection));
    context.subscriptions.push(vscode.commands.registerCommand("sulcus.addMemory", addMemory));
    context.subscriptions.push(vscode.commands.registerCommand("sulcus.showActiveIndex", showActiveIndex));
    context.subscriptions.push(vscode.commands.registerCommand("sulcus.sendToSumr", sendToSumr));
    context.subscriptions.push(vscode.commands.registerCommand("sulcus.describeTools", describeTools));
    // stable public API exposed to other extensions
    const api = {
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
function deactivate() {
    if (daemonProcess) {
        try {
            daemonProcess.kill();
        }
        catch (e) {
            /* ignore */
        }
        daemonProcess = undefined;
    }
    if (output)
        output.dispose();
}
//# sourceMappingURL=extension.js.map