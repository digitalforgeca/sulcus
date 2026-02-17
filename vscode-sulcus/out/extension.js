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
const readline = __importStar(require("readline"));
let output;
let lastSummary;
// Persistent daemon + request/response plumbing
let daemonProcess;
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
    if (!daemonProcess || !daemonProcess.stdin) {
        throw new Error('sulcus-local daemon not running');
    }
    const id = messageId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        try {
            daemonProcess.stdin.write(JSON.stringify(payload) + '\n', (err) => {
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
                reject(new Error('timeout waiting for sulcus-local response'));
            }
        }, cfg('requestTimeoutMs', 10000));
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
        const res = await sendMcpRequest('tools/call', { name: 'summarize', arguments: { text, max_chars: maxChars } });
        const contentText = res?.content?.[0]?.text || '{}';
        const inner = JSON.parse(contentText);
        const out = inner.summary ?? '';
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
        const res = await sendMcpRequest('tools/call', { name: 'add_memory', arguments: { content: summary } });
        const contentText = res?.content?.[0]?.text || '{}';
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
        const res = await sendMcpRequest('resources/read', { uri: 'memory://active_index', limit: 20 });
        const contents = res?.contents ?? [];
        const text = contents[0]?.text ?? '[]';
        const arr = JSON.parse(text);
        const oc = ensureOutput();
        oc.appendLine('--- sulcus active index ---');
        oc.appendLine(JSON.stringify(arr, null, 2) + '\n');
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
        const res = await sendMcpRequest('tools/list', {});
        const tools = res?.tools ?? [];
        const pretty = JSON.stringify({ tools }, null, 2);
        const oc = ensureOutput();
        oc.appendLine('--- sulcus tools manifest ---');
        oc.appendLine(pretty + '\n');
        oc.show(true);
        vscode.window.showInformationMessage('Sulcus: tools manifest shown');
    }
    catch (e) {
        vscode.window.showErrorMessage(`Sulcus describe-tools failed: ${e.message}`);
    }
}
function activate(context) {
    // start persistent sulcus-local daemon
    const bin = cfg("binPath", "sulcus-local");
    try {
        daemonProcess = (0, child_process_1.spawn)(bin, ["serve"], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
        ensureOutput().appendLine(`Started sulcus-local daemon (${bin} serve)`);
        // pipe stderr to OutputChannel
        if (daemonProcess.stderr) {
            daemonProcess.stderr.on("data", (b) => ensureOutput().appendLine(b.toString()));
        }
        // listen for JSON-RPC lines on stdout
        if (daemonProcess.stdout) {
            const rl = readline.createInterface({ input: daemonProcess.stdout });
            rl.on("line", (line) => {
                try {
                    const obj = JSON.parse(line);
                    const id = obj && obj.id;
                    if (typeof id === "number" && pendingRequests.has(id)) {
                        const { resolve } = pendingRequests.get(id);
                        pendingRequests.delete(id);
                        resolve(obj.result);
                        return;
                    }
                    // if id is string, ignore here (we only track numeric requests from this extension)
                }
                catch (err) {
                    // ignore non-json output
                }
            });
        }
        daemonProcess.on("exit", (code, sig) => {
            ensureOutput().appendLine(`sulcus-local daemon exited code=${code} signal=${sig}`);
            // reject all pending
            for (const { reject } of pendingRequests.values()) {
                try {
                    reject(new Error('sulcus-local daemon exited'));
                }
                catch (_) { }
            }
            pendingRequests.clear();
            daemonProcess = undefined;
        });
    }
    catch (e) {
        ensureOutput().appendLine(`failed to spawn sulcus-local daemon: ${e.message}`);
    }
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