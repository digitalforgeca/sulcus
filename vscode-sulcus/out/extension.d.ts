import * as vscode from "vscode";
export type SulcusAPI = {
    summarizeSelection: () => Promise<void>;
    addMemory: () => Promise<void>;
    showActiveIndex: () => Promise<void>;
    sendToSumr: () => Promise<void>;
    describeTools: () => Promise<void>;
    getLastSummary: () => string | undefined;
    showOutput: () => void;
};
export declare function activate(context: vscode.ExtensionContext): SulcusAPI;
export declare function deactivate(): void;
