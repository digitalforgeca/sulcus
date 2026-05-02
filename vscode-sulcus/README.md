# Sulcus VS Code helper

Minimal VS Code extension to interact with a local `sulcus` sidecar.

Commands

- `Sulcus: Summarize Selection (local)` — call `sulcus summarize` on the active selection or document.
- `Sulcus: Add Memory (local)` — record selected text as a Sulcus memory (upserts node).
- `Sulcus: Show Active Index` — display `sulcus show-active` output.
- `Sulcus: Send Last Summary to SUMR` — if SUMR extension is installed, send last generated summary to SUMR.

Configuration

- `sulcus.binPath` — path to `sulcus` binary (default: `sulcus`).
- `sulcus.maxSummaryChars` — maximum chars requested from `sulcus` summarize (default: 500).

Usage

Extension ID: `your-publisher.sulcus-vscode` — replace `your-publisher` with your publisher ID when publishing.

1. Ensure `sulcus` is in your PATH (or set `sulcus.binPath`).
2. Run the commands from the command palette.

Extension API

- Available methods:
  - `summarizeSelection(): Promise<void>`
  - `addMemory(): Promise<void>`
  - `showActiveIndex(): Promise<void>`
  - `sendToSumr(): Promise<void>`
  - `getLastSummary(): string | undefined`
  - `showOutput(): void`

Example (from another extension)

```ts
const ext = vscode.extensions.getExtension("your-publisher.sulcus-vscode"); // replace with your publisher id
if (ext) {
  await ext.activate();
  const api = ext.exports as {
    summarizeSelection: () => Promise<void>;
    getLastSummary: () => string | undefined;
    // ...
  };
  await api.summarizeSelection();
  console.log(api.getLastSummary());
}
```

Notes

- This is a thin helper: `sulcus` still does the work. The extension just shells out and shows results.
- If SUMR is present, the extension can push generated summaries into SUMR's index via `sumr.importConversationSummary`.
