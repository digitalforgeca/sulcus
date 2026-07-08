---
name: sulcus
description: "Allows the agent to understand and leverage the Sulcus persistent memory and context layer."
---

# Sulcus Persistent Memory Skill

This skill explains how the **Sulcus** persistent memory and context engine is integrated into your environment.

## Overview
Sulcus is a cognitive, local-first memory and context engine designed to retain key user preferences, system decisions, lessons learned, and procedures across sessions.

Instead of simple key-value storage, every memory is:
1. **Utility Scored (SIVU)**: Evaluated to check if it contains actual insights, facts, or instructions.
2. **Type Classified (SICU)**: Sorted into a type (episodic, semantic, preference, fact, procedural) which dictates its thermodynamic decay rate.
3. **Decayed & Curated**: Less relevant or cold memories cool down and are consolidated by the curator; important ones stay hot and surface.

## Active Hooks
This plugin leverages the Antigravity lifecycle hooks:
- **PreInvocation (`recall.js`)**: Automatically queries the Sulcus server with your current prompt before model execution and injects relevant historical memories as an ephemeral context block.
- **Stop (`capture.js`)**: Captures significant decisions, user preferences, and learnings from your response at the end of the execution turn.

## Query & Configuration
The plugin automatically fetches your credentials from the active environment variables or parses the `~/.openclaw/openclaw.json` configuration file, requiring no manual setup.
