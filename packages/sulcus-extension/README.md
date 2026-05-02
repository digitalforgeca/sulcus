# SULCUS Browser Extension PoC

This is the "Zero-Friction" acquisition funnel for SULCUS.

## Architecture

This extension leverages the `@sulcus/mem` WASM package. It runs entirely inside the browser without requiring a native Rust binary.

1.  **Background Service Worker (`background.js`)**: Loads the WASM module, initializes `PGlite` (which uses `IndexedDB` for persistent storage), and loads the `transformers.js` embedding model.
2.  **Content Script (`content.js`)**: Injects into AI chat interfaces (e.g., Claude.ai, ChatGPT). It intercepts queries, queries the VMMU via message passing, and autonomously records episodic memory.

## Development

```bash
npm install
npm run build
```

Then load the `dist` folder as an unpacked extension in Chrome/Brave.
