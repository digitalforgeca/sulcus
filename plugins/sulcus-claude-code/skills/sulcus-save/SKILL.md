---
name: sulcus-save
description: Store, update, pin, or link durable knowledge in Sulcus memory. Use when the user says "remember this" or "save this", or after finalizing architectural decisions, resolving non-obvious bugs, learning user preferences, or establishing repeatable workflows.
allowed-tools: mcp__sulcus__store_memory, mcp__sulcus__update_memory, mcp__sulcus__forget_memory, mcp__sulcus__relate_memories, mcp__sulcus__create_trigger
---

# Sulcus Memory Storage & Curation

Store, refine, and organize persistent memories in Sulcus using the canonical lifecycle tools.

## Memory Types & Thermodynamic Half-Lives

Choose the right `memory_type` for what you are storing:

| Type | Default Half-Life | When to Use | Examples |
|------|-------------------|-------------|----------|
| `episodic` | **24 hours** | Session events, milestones, debugging traces | "Resolved flaky test timeout in worker pool" |
| `semantic` | **30 days** | Architecture, subsystem design, domain concepts | "Auth service validates JWTs via JWKS cache" |
| `preference` | **90 days** | User workflow rules, coding style, conventions | "User prefers functional React components and strict TypeScript" |
| `procedural` | **180 days** | Repeatable runbooks, build/test/deploy steps | "To run migrations locally: cargo sqlx migrate run" |
| `fact` | **365 days** | Verified invariants, ports, schema truths | "Local Sulcus daemon listens on 127.0.0.1:4203" |

## How to Store (`mcp__sulcus__store_memory`)

Call `mcp__sulcus__store_memory` with:
- `content` (required): Detailed, self-contained explanation (include root cause, file paths, and rationale — never store raw secrets or API keys).
- `memory_type`: One of `episodic`, `semantic`, `preference`, `procedural`, or `fact`.
- `label` (optional): Short Map summary (`~1` sentence).
- `is_pinned` (optional): Set `true` for permanent rules and critical invariants so they never decay.

## Update Instead of Duplicating (`mcp__sulcus__update_memory`)

- When an existing decision or fact changes, call `mcp__sulcus__update_memory(node_id="...", content="...", memory_type="...")` rather than storing a conflicting duplicate.
- To reinforce an existing memory's heat, call `mcp__sulcus__update_memory(node_id="...", action="boost", strength=0.3)`.
- To cool a superseded memory, call `mcp__sulcus__update_memory(node_id="...", action="deprecate")` or remove obsolete entries with `mcp__sulcus__forget_memory`.
- Link related memories with `mcp__sulcus__relate_memories(source_id="...", target_id="...", label="supersedes")`.

## Reactive Triggers (`mcp__sulcus__create_trigger`)

When the user asks for standing memory rules (e.g., *"Remind me of post-deploy checks whenever deployment memories are recalled"*), call `mcp__sulcus__create_trigger` with `event` (`on_store`, `on_recall`, `on_boost`, `on_decay`, `on_threshold`, `on_relate`), `filter_*`, and `action` (`notify`, `boost`, `pin`, `tag`, `deprecate`, `webhook`).
