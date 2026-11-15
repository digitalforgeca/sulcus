# Sulcus Memory & Reactive Trigger Rules for Cline & Roo Code

1. **Task Start Recall**:
   - Before planning or editing files, call `build_context` or `search_memory` on the `sulcus` MCP server to recall project architecture (`semantic`), user preferences (`preference`), and verified procedures (`procedural`).
2. **Reactive Triggers**:
   - Honor reactive trigger alerts (`trigger.notify`) surfaced in Sulcus MCP tool responses.
3. **Turn & Solution Capture**:
   - When a bug root cause is resolved or an architectural decision is finalized, call `store_memory` with clean plain text (no markdown headers or code blocks).
