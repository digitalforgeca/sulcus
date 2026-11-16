# Copilot Memory Instructions

You have access to the **Sulcus** thermodynamic memory engine via MCP.

1. **Recall Before Implementing**:
   - Call `build_context` or `search_memory` when starting a task or switching topics to surface architectural decisions (`semantic`), user preferences (`preference`), and verified workflows (`procedural`).
2. **Honor Injected Memory Context (`<sulcus-memories>` -> `expand_memory`)**:
   - Treat `<sulcus-memories>` blocks and reactive trigger alerts (`trigger.notify`) surfaced in tool outputs as verified project context, and call `expand_memory(node_id)` whenever a Map pointer (`UUID` or `ccr:<hex>`) needs full Territory detail.
3. **Store High-Signal Decisions**:
   - Use `store_memory` to persist architectural decisions, root-cause fixes, and user preferences in clean plain text (never raw markdown headers or code blocks).
