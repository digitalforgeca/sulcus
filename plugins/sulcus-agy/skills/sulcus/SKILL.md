---
name: sulcus
description: "Allows the agent to understand and leverage the Sulcus persistent memory and context layer."
---

# Sulcus Persistent Memory Skill

This skill explains how the **Sulcus** persistent memory and context engine is integrated into your environment.

## Overview
Sulcus is a proactive, local-first memory and context engine designed to retain key user preferences, system decisions, lessons learned, and procedures across sessions.

Instead of simple key-value storage, every memory is:
1. **Utility Scored (SIVU)**: Evaluated to check if it contains actual insights, facts, or instructions.
2. **Type Classified (SICU)**: Sorted into a type (episodic, semantic, preference, fact, procedural) which dictates its retention profile and natural half-life.
3. **Retained & Curated**: Fleeting details age out naturally and are consolidated by the curator; important, frequently-reinforced memories persist and surface.

## Proactive Engine: Why Plugins Over MCP
Memory cannot rely on an agent remembering to search or save. MCP tools are passive and only run when explicitly called mid-turn. They cannot prepare context before generation begins, nor can they capture knowledge after generation concludes without wasting reasoning tokens.

This plugin bridges that gap by running at the host runtime lifecycle boundary:
- **Automatic Recall (`recall.js`)**: Evaluates incoming context before model inference begins. It queries Sulcus for matching memories and connections, injecting them directly into the context window as an ephemeral `<sulcus-memories>` block. Zero tokens spent deciding whether to search.
- **Automatic Learning (`capture.js`)**: Runs in the background after the turn concludes. It filters out conversational filler and commits verified knowledge to the graph.
- **MCP Tools**: Serve as an on-demand investigative tool when the agent actively chooses to run deep queries or manually modify records during reasoning.

## Antigravity Rule Promotion Workflow
Sulcus handles *ambient, flexible memory* (e.g. preferences, past decisions) which decay over time. 
However, Antigravity Customizations (Rules and Skills) handle *strict, structural workflows* that must always be enforced.

If you observe that a Sulcus memory is critical enough that it must be applied unconditionally across a project, you should promote it to a hard Antigravity Rule:
1. Extract the concept from Sulcus.
2. Create a rule file in `.agents/rules/` (e.g. `.agents/rules/architecture.md`).
3. Add the appropriate trigger context (e.g., `trigger: path_match "*.rs"`).

## Chalice Telemetry Context
If working on gateway logic (e.g., Ganymede), note that the Chalice plugin operates over telemetry hooks. Because the CLI strips custom environment variables during hook execution, **do not rely on environment variables for agent correlation**. Instead, use the PPID (parent PID) mapping written to `~/.ganymede/data/pid_map/` to resolve context IDs for telemetry events.

## Explicit Memory Retention Tuning & Pinning
Unlike competing systems that rely purely on vector search with uncontrolled context windows, Sulcus provides precise control over the lifecycle of memories. As an agent, you can (and should) explicitly tune memory retention using the **`record_memory`** MCP tool when deeper in-turn intervention is needed.

When interacting with critical information, use `record_memory` to manually set:
- **`is_pinned`**: Set to `true` to freeze a memory. Pinned memories are immune to decay and are permanently retained. Use this for unchangeable facts, core identity traits, or strict workflows.
- **`memory_type`**: Assign specific types to control the base decay rate (e.g. `episodic` decays fast, while `semantic` or `procedural` decays much slower).
- **`decay_class`**: Override the default decay speed (`fast`, `normal`, `slow`, `glacial`).
- **`initial_heat` / `min_heat`**: Directly set the starting relevance or establish a floor value so critical context is never garbage collected.

You can also leverage other tools (like `boost_memory` or `forget_memory`) to actively manage the ambient knowledge state. This proactive lifecycle gives Sulcus agents superior long-term reliability over other systems.

## Query & Configuration
The plugin fetches your credentials natively from standard environment variables (`SULCUS_API_KEY`, `SULCUS_SERVER_URL`, `SULCUS_NAMESPACE`). No external configurations are required.
