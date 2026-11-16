# Sulcus Memory Rules

Sulcus provides persistent Semantic VMMU context, procedural skills, and local Tree-sitter AST navigation across turns.

## Map And Territory
- Treat `<sulcus-memories>` entries as compact **Map** pointers (`[type] summary` with a `node_id` or `ccr:<hex>` handle). Apply clear rules directly without exposing internal node IDs to the user.
- Call `expand_memory(node_id="<uuid-or-ccr>", lines="1-80")` whenever a Map pointer is truncated, carries a `ccr:<hex>` handle, or requires exact **Territory** code, commands, or line-level detail.
- When `<sulcus-skills>` surfaces an indexed playbook, call `use_skill(action="load", skill="<name>", procedure="<step>")` to load only the needed procedure on demand.

## AST Navigation
- Prefer structural AST tools over broad text greps when exploring unfamiliar code: `project_map` for workspace layout, `find_symbol` for exact `[Lstart-Lend]` spans, `get_outline` for file signatures before reading full bodies, and `get_references` for cross-file callers and imports.

## MCP Transport
- **`sulcus mcp-proxy`** is Sulcus's canonical zero-lock multi-window MCP transport, bridging stdio harnesses to the shared `http://127.0.0.1:4203/mcp` daemon (or remote `/mcp` with local AST execution).
- Always configure MCP harnesses with `"command": "sulcus", "args": ["mcp-proxy"]` — never legacy single-process `"args": ["stdio"]`.
