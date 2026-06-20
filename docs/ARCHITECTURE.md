# Sulcus Architecture — Public Overview

> **Classification:** This document describes the public architecture visible to users and contributors. The server backend is a proprietary managed service. See [CLASSIFICATION.md](../CLASSIFICATION.md).

---

## How Sulcus Works

Sulcus has two sides:

1. **The `sulcus` CLI** — A single binary that runs on your machine. Handles local memory, MCP protocol (stdio), embedded database, local embeddings, and sync with the Sulcus API. This is what you install.

2. **The Sulcus API** (`api.sulcus.ca`) — A managed service that provides multi-tenant memory storage, the SIU v2 pipeline, knowledge graph, triggers engine, and cross-agent sync. You connect to it with an API key.

```
┌──────────────────────────────────────────────────────┐
│              Your Machine                             │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  sulcus CLI (one binary)                         │ │
│  │                                                   │ │
│  │  • MCP stdio server (for Claude, Cursor, etc.)   │ │
│  │  • Local embedded database                        │ │
│  │  • Local embeddings (fastembed/ONNX)              │ │
│  │  • Works offline — syncs when connected           │ │
│  └──────────────────────┬────────────────────────────┘ │
└─────────────────────────┼────────────────────────────┘
                          │ HTTPS (API key auth)
                          ▼
┌──────────────────────────────────────────────────────┐
│              Sulcus API (api.sulcus.ca)               │
│                                                       │
│  Memory Storage · SIU Pipeline · Knowledge Graph     │
│  Triggers · Entity Extraction · Multi-tenant Sync    │
│                                                       │
│        Managed service by Digital Forge Studios       │
└──────────────────────────────────────────────────────┘
```

## The Thermodynamic Model

Memory nodes follow a biological decay curve derived from ACT-R cognitive architecture:

$$H(t) = H_0 \cdot e^{-\lambda \cdot \Delta t / S}$$

- **H(t):** Current heat (activation)
- **S:** Stability — successful retrievals multiply S by 1.5×, simulating spaced repetition
- **λ:** Decay constant (default 0.85)

Heat spreads through the knowledge graph via **topological diffusion**. Mentioning a topic warms its neighbors.

## Distributed Consistency (HLC-CRDT)

Sulcus ensures causal consistency across distributed agents using **Hybrid Logical Clocks (HLC)**.

- **LWW-Element-Graph:** All mutations are idempotent patches
- **Anti-Entropy:** The `sulcus` client pushes/pulls WAL segments to the Sulcus API
- **Conflict Resolution:** The API resolves conflicts via HLC timestamps

## Client SDKs & Integrations

SDKs and integrations are thin API clients. They connect to `api.sulcus.ca` — no local server required.

- **Python:** `pip install sulcus`
- **Node.js:** `npm install @digitalforgestudios/sulcus`
- **OpenClaw:** `openclaw skill install @digitalforgestudios/openclaw-sulcus`
- **Framework integrations:** LangChain, LlamaIndex, CrewAI, Vercel AI SDK

## Security

- **API key authentication:** All requests require a Bearer token
- **Tenant isolation:** Cryptographically scoped — agents for one tenant cannot access another's memories
- **Transport:** HTTPS only

---

*Last Updated: 2026-06-20*
