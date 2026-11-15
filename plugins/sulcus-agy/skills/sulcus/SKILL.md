---
name: sulcus
description: "Allows the agent to understand and leverage the Sulcus persistent memory and context layer."
---

# Sulcus Persistent Memory Skill

This skill explains how the **Sulcus** persistent memory and context engine (`sulcus-agy` v1.3.0) is integrated into your environment.

## Overview
Sulcus is a proactive, local-first Semantic VMMU (Virtual Memory Management Unit) designed to retain key user preferences, architectural decisions, error resolutions, and procedures across sessions.

Instead of flat key-value storage, every incoming memory passes through **MemPalace Preparation** (`sulcus-core::ingest`) and unified **System 1 (`VCR` — Value · Classification · Retrieval)**:
1. **Value (`V`)**: Scores utility and signal density so conversational filler is rejected before storage.
2. **Classification (`C`)**: Classifies memory into `episodic`, `semantic`, `preference`, `fact`, or `procedural` (via built-in System 1 weights or swappable open-weight cartridges) to set its thermodynamic decay profile and natural half-life.
3. **Retrieval (`R`)**: Combines vector similarity, lexical/entity matching, Personalized PageRank, and thermodynamic heat so relevant Map pointers surface automatically while raw Territory stays paged out until faulted in.

## Proactive Engine: Pure-Rust AGY Lifecycle Boundary
Memory cannot rely on an agent remembering to search or save. `sulcus-agy` runs across Antigravity's **6 supported lifecycle events** (`SessionStart`, `PreInvocation`, `PostInvocation`, `Stop`, `PreToolUse`, `PostToolUse`) via the compiled `<15ms` `sulcus hook --harness agy <Event>` subcommand:
- **Hydration & Compaction Detection (`PreInvocation`)**: Uses `lastUserInput` in $O(1)$ on normal turns, detects AGY context compaction via `initialNumSteps` and `<CONTEXT_SUMMARY>` digests to reset `surfaced_context.json`, and injects `<sulcus-memories>` via `injectSteps[].systemMessage` (with optional `metadata.user_markdown` UI badges and zero deprecated `ephemeralMessage` fields).
- **Error-to-Resolution Learning (`PreToolUse` + `PostToolUse`)**: Skips disk I/O on read-only tools, snapshots file mutations into private `0700 ~/.sulcus/run/` state, captures `PostToolUse.error` failures, and pairs retries that succeed into `[learn:candidate]` error-resolution memories.
- **Turn Capture & Continuation-Aware Flush (`PostInvocation` + `Stop`)**: Extracts completed turns and flushes session state on `Stop` when `continuationActive == false` and `fullyIdle == true` (preserving continuity across `/goal` and `/loop` auto-continuations).
- **MCP Tools**: Serve as on-demand tools when you actively run deep graph queries, inspect AST symbols, configure deterministic triggers, or pin critical memories mid-turn.

## Bidirectional `/learn` × Sulcus Promotion Workflow
Sulcus handles *ambient, thermodynamic memory* across sessions, while Antigravity Customizations (Rules and Skills) codify *strict, deterministic invariants and reusable workflows*:
1. **Automatic Candidate Hydration on `/learn`**: Whenever the user invokes `/learn`, `PreInvocation` automatically queries unpromoted cross-session lessons (`/api/v1/local/learn/candidates`), filters out rules already present in `AGENTS.md`, `GEMINI.md`, or `.agents/rules/*.md`, and injects `<sulcus-learn-candidates>` (tagged `target: rule` vs `target: skill`).
2. **Propose Before Writing**: Review `<sulcus-learn-candidates>` alongside the current session transcript, confirm with the user, and write concise invariants to `.agents/rules/<topic>.md` (or `AGENTS.md`) and multi-step workflows to `.agents/skills/<name>/SKILL.md` (or `~/.gemini/config/skills/<name>/SKILL.md`).
3. **Automatic Reconciliation**: When `edit_file` or `write_file` saves a rule file or `SKILL.md`, `PostToolUse` automatically reconciles matching Sulcus candidates (`[promoted:rule]` / `[promoted:skill]`) so they are never re-proposed, and indexes newly authored `SKILL.md` files into Sulcus Dynamic Skills VMMU (`skills_index`)! Users can also inspect candidates anytime via `sulcus learn`.

## Explicit Memory Retention Tuning & Pinning
Use **`store_memory`** / **`record_memory`** when explicit in-turn retention control is needed:
- **`is_pinned`**: Set to `true` (`structural_lock`) to freeze a memory permanently against decay and pruning.
- **`memory_type`**: Assign `episodic`, `semantic`, `preference`, `fact`, or `procedural` (`soft_prior` guiding decay half-life).
- **`decay_class`**: Override decay speed (`fast`, `normal`, `slow`, `glacial`).
- **`initial_heat` / `min_heat`**: Set starting salience or establish a heat floor.

## Reactive Memory Triggers (Deterministic Condition Hooks)
Triggers are **100% deterministic condition-driven hooks** — there is no background NL guesswork daemon. When a user says *"Remind me of X when Y happens"* or asks for an automated memory reaction, translate their intent explicitly using **`create_trigger`** (`list_triggers`, `update_trigger`, `delete_trigger`, `trigger_history`):
- **Conditions**:
  - **Memory & Thermodynamic**: `on_store`, `on_recall`, `on_boost`, `on_decay`, `on_threshold` (`below` | `above` | `either` | `band`), `on_relate`.
  - **Telemetry & Lifecycle**: `on_solution` (fires when `PostToolUse` pairs a tool failure with its fix), `on_milestone` (fires on compaction/consolidation synthesis).
- **Actions**: `pin`, `boost`, `notify`, `tag`, `deprecate`, `webhook`.

## AST Workspace Mapping & Symbol Indexing
Sulcus includes a local Tree-sitter AST workspace & symbol index built on Semantic VMMU Map/Territory + Caveman Compression:
- **`project_map`**: Inspect repository architecture (`detail: "skeleton" | "standard" | "full"`, `doc_mode: "caveman" | "verbatim" | "summary" | "none"`).
- **`find_symbol`**: Locate functions, methods, structs, traits, classes, or types across the workspace before broad text grep.
- **`get_outline`**: Inspect complete AST signatures, `[Lstart-Lend]` spans, docstrings, imports, and call edges before paging in raw bodies.
- **`get_references`**: Trace cross-file definitions, callers, and module importers.

## Configuration & Hook Toggles
Credentials and preferences load from `~/.config/sulcus/sulcus.ini` (or `SULCUS_API_KEY`, `SULCUS_SERVER_URL`, `SULCUS_NAMESPACE`). Optional `[hooks]` toggle in `sulcus.ini`:
- `learn_ui_nudges = false` (default; set `true` or `SULCUS_LEARN_UI_NUDGE=1` to show a 0-token `metadata.user_markdown` badge on `PostInvocation` when `>= 2` `/learn` candidates are ready).
