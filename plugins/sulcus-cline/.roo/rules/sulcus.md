# Cline Memory Rules

1. **Task Start Recall & Map -> Territory**:
   - Before planning or editing files, call `search_memory` or `build_context` on the `sulcus` MCP server to recall architecture (`semantic`), preferences (`preference`), and verified procedures (`procedural`).
   - Call `expand_memory(node_id)` whenever a Map pointer (`UUID` or `ccr:<hex>`) needs full Territory detail.
2. **Reactive Triggers**:
   - Honor reactive trigger alerts (`trigger.notify`) surfaced in Sulcus MCP tool responses.
3. **Turn & Solution Capture**:
   - Persist durable architectural decisions, verified facts, and bug root causes with `store_memory`, or refine existing entries with `update_memory` instead of writing duplicates.
