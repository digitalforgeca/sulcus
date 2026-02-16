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
let output;
let lastSummary;
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
        // sulcus-local summarize reads stdin when no text arg provided
        const out = await runSulcus(["summarize"], text);
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
    const bin = cfg("binPath", "sulcus-local");
    try {
        await new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)(bin, ["add-memory", summary, "100.0"]);
            let stderr = "";
            proc.on("error", (err) => reject(new Error(`failed to start ${bin}: ${err.message}`)));
            proc.stderr.on("data", (b) => (stderr += b.toString()));
            proc.on("close", (code) => {
                if (code !== 0)
                    return reject(new Error(stderr || `sulcus add-memory exit ${code}`));
                resolve();
            });
        });
        vscode.window.showInformationMessage("Sulcus: memory recorded locally");
    }
    catch (e) {
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
        const out = await runSulcus(["describe-tools"]);
        let pretty = out;
        try {
            pretty = JSON.stringify(JSON.parse(out), null, 2);
        }
        catch (_) { }
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
    if (output)
        output.dispose();
}
//# sourceMappingURL=extension.js.map