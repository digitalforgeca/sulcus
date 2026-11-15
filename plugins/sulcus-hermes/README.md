# Sulcus Hermes Plugin

[![Version](https://img.shields.io/badge/version-0.1.1-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Hermes%20Agent-cyan.svg)](https://hermes-agent.nousresearch.com)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20Compliant-purple.svg)](https://modelcontextprotocol.io)
[![Runtime](https://img.shields.io/badge/runtime-Python%203.9%2B-orange.svg)](https://python.org)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Persistent thermodynamic memory provider and proactive context client for Hermes Agent

---

## Core Features

### Proactive Memory Recall
Automatic multi-signal memory recall executes before each Hermes reasoning turn. Injects high salience context into the model working memory through vector similarity and thermodynamic heat ranking.

### Episodic Conversation Capture
Evaluates assistant turn completions and records durable episodic markers and procedural task solutions without lossy compression.

### Semantic Type Classification
Categorizes memory entries across preference, fact, procedural, and episodic classes with custom decay weighting and permanent pinning for critical invariants.

### Compaction Context Rescue
Preserves active working memory through pre auxiliary call compaction hooks. Prevents contextual amnesia when Hermes resets long conversations.

---

## Plugin Commands

| Command Action | Execution Target | Operation Objective |
| --- | --- | --- |
| sulcus recall | Fast semantic lookup | Query memory store |
| sulcus store | Record memory node | Persist new knowledge |
| sulcus status | Check engine state | Diagnostic connectivity check |
| sulcus search | Filter memory nodes | Search by pattern |
| sulcus boost | Elevate memory heat | Reinforce active salience |
| sulcus hot | Fetch hottest nodes | List salient memories |

---

## Configuration Options

| Option Setting | Default Setting | Option Purpose |
| --- | --- | --- |
| SULCUS SERVER URL | Localhost Port 4203 | Sulcus server endpoint |
| SULCUS API KEY | None | Cloud credentials token |
| SULCUS NAMESPACE | default | Current memory partition |
| SULCUS TOKEN BUDGET | 4000 | Maximum context budget |

---

## Architecture Overview

Sulcus separates lightweight vector pointers from full resolution knowledge graphs. Hermes reviews concise memory pointers and retrieves complete memory territory only on explicit request.

Dual runtime architecture operates offline with local embedded daemon alongside Sulcus Cloud synchronization.
