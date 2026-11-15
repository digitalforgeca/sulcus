---
name: sulcus
description: "Persistent semantic memory, Map-to-Territory expansion, local AST navigation, procedural skills, Activity Ledger undo, and reactive triggers via Sulcus."
---

# Sulcus Memory & Context Skill (`sulcus-agy`)

Sulcus is your persistent Semantic VMMU (Virtual Memory Management Unit). `sulcus-agy` lifecycle hooks (`SessionStart`, `PreInvocation`, `PostInvocation`, `PreToolUse`, `PostToolUse`, `Stop`) automatically inject relevant **Map** pointers (`<sulcus-memories>`) before turns and capture verified outcomes after turns. Use the **21 canonical Sulcus MCP tools** whenever you need full **Territory** detail, targeted recall, durable memory curation, AST symbol navigation, or selective undo.

## 1. How to Read `<sulcus-memories>` (Map -> Territory)
- `<sulcus-memories>` entries are compact **Map pointers** (`~40-80` tokens each) showing `[type] summary` and a `node_id` or `[ccr:<hex>]` handle.
- **Decision rule**:
  - If the Map summary already answers your question, apply it directly without mentioning internal memory IDs to the user.
  - If an entry is truncated, references a `[ccr:<hex>]` handle, or requires exact code/commands/line-by-line detail, call **`expand_memory(node_id="<uuid-or-ccr>", lines="1-80")`** to load the full **Territory** and reinforce its recall heat.

## 2. When to Call Each Sulcus MCP Tool

### Memory Lifecycle (6 Tools)
- **`search_memory`** (`query`, optional `memory_type`, `namespace`, `tier`, `time_from`, `time_to`, `limit`):
  - Call when switching subsystems, investigating how something was built previously, or checking past decisions not already surfaced in `<sulcus-memories>`.
  - Pass `tier: "all"` when searching older archived history.
- **`expand_memory`** (`node_id`, optional `lines`):
  - Call to retrieve the full uncompacted Territory for any memory UUID or `ccr:<hex>` handle from `<sulcus-memories>`, `search_memory`, or `reduce_output`.
- **`store_memory`** (`content`, optional `memory_type`, `label`, `pointer_summary`, `is_pinned`, `namespace`, `tags`, `path`):
  - Call explicitly for **high-signal durable knowledge**: user directives (`preference`), verified system truths (`fact`), architectural decisions (`semantic`), reusable runbooks (`procedural`), or non-obvious root causes (`episodic`).
  - **Hygiene**: Do **not** manually re-save routine turn chatter (hooks already capture session flow), and **never** store secrets, tokens, or credentials.
- **`update_memory`** (`node_id`, optional `content`, `pointer_summary`, `memory_type`, `is_pinned`, `action: "boost" | "deprecate"`, `strength`):
  - Call instead of `store_memory` whenever an existing rule, port, path, or architecture decision evolves. Use `action: "boost"` to reinforce critical context or `action: "deprecate"` to cool superseded notes.
- **`forget_memory`** (`node_id`, optional `purge_cold`):
  - Call to permanently delete erroneous, obsolete, or user-retracted memories (and optionally purge cold decayed entries when `purge_cold: true`).
- **`relate_memories`** (`source_id`, `target_id`, optional `label`, `weight`):
  - Call to link causally or architecturally connected memories (e.g. `"caused_by"`, `"supersedes"`, `"depends_on"`).

### Context, Discovery & Dynamic Skills (4 Tools)
- **`build_context`** (`prompt`, optional `namespace`, `token_budget`): Assemble a token-budgeted `<sulcus_context>` XML brief (e.g. when preparing context for a subagent).
- **`list_memories`** (optional `limit`, `namespace`, `memory_type`): Inspect the hottest active memories in the current working set.
- **`list_namespaces`**: Discover available project/domain namespaces and memory counts before cross-namespace queries.
- **`use_skill`** (`action: "list" | "search" | "load" | "ingest"`, optional `skill`, `procedure`, `query`, `markdown`): Search indexed playbooks and load (`action: "load"`) only the specific procedure needed on demand.

### Local Code AST Navigation (4 Tools)
Prefer structural Tree-sitter AST queries over broad text greps when exploring unfamiliar code:
- **`project_map`**: Inspect workspace crates/packages, entrypoints, symbol counts, and CCR handles (`detail: "skeleton" | "standard" | "full"`).
- **`find_symbol`**: Locate functions, methods, structs, traits, classes, or types with exact `[Lstart-Lend]` spans.
- **`get_outline`**: Parse a file (`path`) or inline snippet (`content`) into complete syntactic signatures, spans, imports, and call edges before reading raw function bodies.
- **`get_references`**: Trace cross-file symbol definitions, callers, and module importers.

### Activity Ledger, Output Compression & Reactive Triggers (7 Tools)
- **`list_activity_ledger`** / **`undo_activity`**: Inspect recorded file/tool mutations and selectively revert specific turns (`seq_ids`, `last_n`, `query`, `dry_run`) while preserving subsequent non-overlapping edits.
- **`reduce_output`** (`output`, optional `command`, `content_type`, `store_handle`): Compress verbose build/test logs or large JSON/diff payloads by 80–95% while keeping full text expandable via `expand_memory`.
- **`create_trigger`** / **`list_triggers`** / **`update_trigger`** / **`delete_trigger`**: Register deterministic reactive rules (`on_store`, `on_recall`, `on_boost`, `on_decay`, `on_threshold`, `on_relate` -> `notify`, `boost`, `pin`, `tag`, `deprecate`, `webhook`) when the user asks for standing memory reminders or policies. Pass `include_history: true` to `list_triggers` to audit recent firings.

## 3. Thermodynamic Memory Types & Default Half-Lives
| `memory_type` | Default Half-Life | Best Used For |
|---|---|---|
| `episodic` | **24 hours** | Session milestones, debugging traces, temporary task state |
| `semantic` | **30 days** | Module architecture, domain concepts, design tradeoffs |
| `synthesis` | **60 days** | Consolidated lessons distilled across multiple episodic turns |
| `preference` | **90 days** | User workflow directives, coding style, communication rules |
| `procedural` | **180 days** | Verified build/test/deploy recipes and step-by-step runbooks |
| `fact` | **365 days** | Verified constants, ports, schema invariants, endpoints |

*(Set `is_pinned: true` on non-negotiable invariants that must never decay.)*

## 4. Bidirectional `/learn` Promotion Workflow
1. When the user invokes `/learn`, `PreInvocation` injects unpromoted cross-session lessons in `<sulcus-learn-candidates>` (`target: rule` vs `target: skill`).
2. Review candidates with the user, then codify concise invariants in `.agents/rules/<topic>.md` (or `AGENTS.md`) and multi-step procedures in `.agents/skills/<name>/SKILL.md`.
3. `PostToolUse` automatically marks promoted candidates reconciled and indexes authored `SKILL.md` files for `use_skill`.
