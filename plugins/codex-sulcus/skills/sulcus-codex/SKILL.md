---
name: sulcus-codex
description: >
  Sulcus persistent memory integration for Codex. Automatically retrieve relevant
  memories at the start of each task, store key learnings when tasks complete,
  and capture session state before context is lost. Use the Sulcus MCP tools
  (add_memory, search_memory, forget_memory, etc.) for all memory operations.
  Sulcus memories have thermodynamic heat — frequently used memories stay hot,
  unused ones naturally cool and fade. The knowledge graph links entities across
  memories for richer context.
---

# Sulcus Memory Protocol for Codex

You have access to persistent memory via the Sulcus MCP tools. Follow this protocol to maintain context across sessions.

## On every new task

1. Call `search_memory` with a query related to the current task or project to load relevant context (or use `build_context` for an assembled prompt block).
2. Review returned memories — note their heat values (higher = more active/relevant).
3. If appropriate, call `list_hot_nodes` to see your most active memories right now.

## After completing significant work

Extract key learnings and store them using the `add_memory` tool:

- **Decisions made** → memory_type: `semantic`
- **Strategies that worked** → memory_type: `procedural`
- **Failed approaches** → memory_type: `procedural` (document what NOT to do)
- **User preferences observed** → memory_type: `preference`
- **Environment/setup discoveries** → memory_type: `semantic`
- **Conventions established** → memory_type: `semantic`
- **Events and milestones** → memory_type: `episodic`

Memories can be as detailed as needed — include full context, reasoning, code snippets, file paths, and examples. Longer, searchable memories are more valuable than vague one-liners.

## Before losing context

If context is about to be compacted or the session is ending, store a comprehensive session summary:

```
## Session Summary

### User's Goal
[What the user originally asked for]

### What Was Accomplished
[Numbered list of tasks completed]

### Key Decisions Made
[Architectural choices, trade-offs discussed]

### Files Created or Modified
[Important file paths with what changed]

### Current State
[What is in progress, pending items, next steps]
```

Store as memory_type: `episodic`.

## Memory types and decay

| Type | Decay Rate | Best For |
|------|-----------|----------|
| `episodic` | Fast | Events, session logs, what happened |
| `semantic` | Slow | Knowledge, concepts, learned facts |
| `fact` | Slow | Atomic verified facts, stable data points |
| `preference` | Slower | User preferences, style, opinions |
| `procedural` | Slowest | How-tos, workflows, step-by-step instructions |
| `synthesis` | Slowest | Consolidated insights, derived patterns |

## Memory hygiene

- Do NOT write to MEMORY.md or any file-based memory. Use Sulcus MCP tools exclusively.
- Only store genuinely useful learnings. Skip trivial interactions.
- Use specific, searchable language in memory content.
- Use `upsert_node` with a high `current_heat` to raise heat on important memories.
- Use `commit_memory` with `connected_node_ids` to link related memories in the knowledge graph.
- Pin critical memories with `pin_node` to prevent decay.
