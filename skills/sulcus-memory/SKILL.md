---
name: sulcus-memory
description: "Equip your agent with SULCUS thermodynamic memory. Drastically reduces token burn while maintaining perfect long-term recall."
author: "Digital Forge"
version: "0.1.0"
metadata:
  clawdbot:
    requires:
      bins: [sulcus-local]
---

# SULCUS Memory Skill

SULCUS is a thermodynamic Virtual Memory Management Unit (vMMU) for AI Agents. It allows you to store and recall information based on its "heat" (importance) and "decay" (relevance over time).

## Core Concepts

- **Heat:** Every time you access a memory, it gains heat.
- **Decay:** Over time, memories cool down and are "paged out" of active context.
- **Spaced Repetition:** Frequent access builds "stability", making memories stay warm longer.

## How to use SULCUS

### 1. Recording Memories
Whenever something important happens, or at the end of a long task, use the `memory_store` tool (or `record_memory` MCP tool).

Example:
> "The user wants the database schema to follow the SOC2 compliance standard."
> `memory_store(content="user wants SOC2 compliant database schema")`

### 2. Recalling Context
Before starting a new task or when you need to remember something from the past, use `memory_recall` (or `search_memory` MCP tool).

Example:
> `memory_recall(query="database schema")`

### 3. Automatic Context (Requires SULCUS Plugin)
If the SULCUS OpenClaw plugin is installed, relevant memories are automatically injected into your context window before you start a turn. You can still use `memory_recall` for deeper searches.

## Troubleshooting

If SULCUS is not responding, ensure the `sulcus-local` binary is in your PATH or configured in your OpenClaw settings.
