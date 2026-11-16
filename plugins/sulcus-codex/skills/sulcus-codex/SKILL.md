---
name: sulcus-codex
description: >
  Sulcus persistent memory integration for Codex. Retrieve relevant Map pointers at task start,
  expand full Territory via expand_memory when needed, and store or update durable learnings
  using canonical Sulcus MCP tools (store_memory, search_memory, expand_memory, update_memory,
  forget_memory, relate_memories, list_memories).
---

# Codex Memory Protocol

You have access to persistent memory via Sulcus MCP tools. Follow this protocol to maintain context across sessions without bloating your prompt window.

## Task Start
1. Check any `<sulcus-memories>` pointers injected by Codex hooks first.
2. If you need deeper background on the subsystem or prior decisions, call `search_memory` (`query`, optional `memory_type`, `namespace`) or `list_memories` (`limit: 15`).
3. When a Map pointer is compressed (`ccr:<hex>`) or lacks exact detail, call `expand_memory(node_id: "...", lines: "1-80")` to load the full Territory.

## Storing Learnings
Persist durable insights using `store_memory` (or `update_memory` when modifying an existing memory):

| `memory_type` | Default Half-Life | Best For |
|---|---|---|
| `episodic` | **24 hours** | Session summaries, milestones, debugging traces |
| `semantic` | **30 days** | Architecture decisions, module boundaries, tradeoffs |
| `preference` | **90 days** | User preferences, coding style, workflow rules |
| `procedural` | **180 days** | Verified commands, build/test/deploy runbooks |
| `fact` | **365 days** | Verified constants, schema invariants, ports/URLs |

## Memory Hygiene
- Never write flat `MEMORY.md` files; use Sulcus MCP tools exclusively.
- Never store raw secrets, API keys, or credentials.
- Prefer `update_memory(node_id: "...", content: "...")` over storing duplicate or conflicting notes.
- Reinforce critical memories with `update_memory(node_id: "...", action: "boost")` or freeze permanent rules with `update_memory(node_id: "...", is_pinned: true)`.
- Connect related nodes in the knowledge graph with `relate_memories(source_id: "...", target_id: "...", label: "...")`.
- Compress noisy CLI logs or large JSON/diffs with `reduce_output` and rehydrate slices anytime via `expand_memory`.
- Answer directly without reciting internal memory UUIDs unless asked.
