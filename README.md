# SULCUS

[![Release](https://img.shields.io/github/v/release/digitalforgeca/sulcus?color=blue&label=release)](https://github.com/digitalforgeca/sulcus/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![MCP Compliant](https://img.shields.io/badge/MCP-Zero--Lock%20Proxy%20%7C%20Streamable%20HTTP-cyan.svg)](https://modelcontextprotocol.io)
[![Benchmarks Verified](https://img.shields.io/badge/Google%20NIAH-100%25%20Recall-gold.svg)](#benchmark-verification)

> **Your agents start every session from zero. Sulcus is the memory they keep.**

Stateless AI sessions lose architectural decisions, debugging root causes, and user preferences the moment a conversation ends. Sulcus gives coding assistants and autonomous agents persistent, thermodynamic memory — keeping compact semantic pointers in context and paging full details on demand.

**Website:** [sulcus.ca](https://sulcus.ca) · **Cloud API:** [api.sulcus.ca](https://api.sulcus.ca) · **System 1 VCR API:** [docs/vcr-api.md](docs/vcr-api.md) · **Documentation:** [sulcus.ca/docs](https://sulcus.ca/docs)

---

## Core Architecture

```mermaid
flowchart LR
    subgraph AgentRuntime["Agent Runtime"]
        Agent["Coding Agent\n(AGY, Claude Code, Cursor, VS Code, Codex, Hermes)"]
        Hook["Lifecycle Hook & MCP\n(Synapse Pre-Execution Recall)"]
    end

    subgraph SulcusEngine["Sulcus Semantic VMMU"]
        Map["Tier 1: In-Context Map\n(Compact Semantic Pointers < 0.2 KB)"]
        Fault{"Page Fault\nRequired?"}
        Territory["Tier 2: Deep Territory\n(Full Knowledge Graph & AST Symbols)"]
    end

    subgraph Storage["Local-First & Cloud Sync"]
        LocalDB[("Local Workstation Engine\n(Single Binary + Local Embeddings)")]
        CloudSync[("Managed Sulcus Cloud API\n(api.sulcus.ca)")]
    end

    Agent <--> Hook
    Hook <--> Map
    Map --> Fault
    Fault -- Yes --> Territory
    Fault -- No --> Agent
    Territory --> Agent
    SulcusEngine <--> LocalDB
    LocalDB <-. Encrypted Delta Sync .-> CloudSync
```

### Semantic VMMU

Sulcus implements a **Semantic Virtual Memory Management Unit** for context windows:
- **The Map:** Working context receives compact telegraphic pointers under 0.2 KB rather than raw transcript dumps.
- **The Territory:** Full-resolution notes, entity triples, and AST symbol hierarchies remain indexed on disk.
- **On-Demand Page Faults:** Agents expand deep territory only when needed (`page_in`), cutting prompt token overhead by **85%+**.

### System 1 VCR

- **Value & Archetype Gate:** Pure-Rust Wide-and-Deep System 1 VCR evaluates durability, novelty, and operational utility before storing memories, filtering conversational noise automatically.
- **Synapse Pre-Execution Recall:** Lifecycle hooks and 7-signal adaptive retrieval scoring surface relevant architectural rules, past bug fixes, and AST PageRank context before the model acts.
- **Temporal Invalidation:** Newer verified facts automatically supersede outdated directives so stale decisions stop resurfacing.

### Local Engine

- **100% Offline Capable:** Runs locally via a single native `sulcus` workstation binary (`http://127.0.0.1:4203`) with embedded PostgreSQL storage, local CPU embeddings, and zero-lock `sulcus mcp-proxy` transport.
- **Managed Cloud Sync:** Optional encrypted delta sync with [api.sulcus.ca](https://api.sulcus.ca) keeps personal and team namespaces synchronized across workstations and tools.

---

## Benchmark Verification

| Benchmark Suite | Evaluation Focus | Baseline | Sulcus |
| :--- | :--- | :--- | :--- |
| **Google Multi-Needle in a Haystack (NIAH)** | 0%–100% depth retrieval across dense context horizons | 68.2% (Standard RAG) | **100.0%** (13 / 13) |
| **Google DeepMind Evo-Memory (ExpRAG)** | Incident post-mortem recall & cross-task adaptation | 41.5% (Stateless Agent) | **100.0%** (4 / 4) |
| **Dynamic Conflict Resolution (ReMem)** | Invalidation of superseded architectural directives | 35.0% (Context Stuffing) | **100.0%** (4 / 4) |
| **BABILong Multi-Hop Reasoning** | Deductive graph reasoning across multi-step chains | 52.0% (In-Context Window) | **100.0%** (5 / 5) |
| **SulcusBench Composite Suite** | 20-scenario recall, temporal recency, contradiction & scale | 58.4% (In-Context Ceiling) | **99.0%** (20 / 20) |

---

## Harness Plugins

All 17 official harness integrations live under [`plugins/`](plugins) with unified single-binary `sulcus` hook and zero-lock `mcp-proxy` wiring:

| Plugin | Target Harness / IDE | Path |
| :--- | :--- | :--- |
| **`sulcus-agy`** | Google Antigravity (`hooks.json` lifecycle + skill + `sulcus mcp-proxy`) | [`plugins/sulcus-agy`](plugins/sulcus-agy) |
| **`sulcus-claude-code`** | Anthropic Claude Code (`hooks.json` + `sulcus mcp-proxy`) | [`plugins/sulcus-claude-code`](plugins/sulcus-claude-code) |
| **`sulcus-cursor`** | Cursor IDE (`hooks.json` + `.cursor/mcp.json` via `sulcus mcp-proxy`) | [`plugins/sulcus-cursor`](plugins/sulcus-cursor) |
| **`sulcus-windsurf`** | Windsurf IDE (`.windsurf/hooks.json` + `sulcus mcp-proxy`) | [`plugins/sulcus-windsurf`](plugins/sulcus-windsurf) |
| **`sulcus-codex`** | OpenAI Codex CLI (`hooks.json` + `sulcus mcp-proxy`) | [`plugins/sulcus-codex`](plugins/sulcus-codex) |
| **`sulcus-gemini-cli`** | Google Gemini CLI (`gemini-extension.json` + `sulcus mcp-proxy`) | [`plugins/sulcus-gemini-cli`](plugins/sulcus-gemini-cli) |
| **`sulcus-vscode`** | Visual Studio Code (Sidebar, Memory Graph & LM Tools Extension) | [`plugins/sulcus-vscode`](plugins/sulcus-vscode) |
| **`sulcus-jetbrains`** | IntelliJ IDEA, RubyMine & JetBrains IDEs | [`plugins/sulcus-jetbrains`](plugins/sulcus-jetbrains) |
| **`sulcus-junie`** | JetBrains Junie (`hooks/hooks.json` + `sulcus mcp-proxy`) | [`plugins/sulcus-junie`](plugins/sulcus-junie) |
| **`sulcus-cline`** | Cline / Roo Code (`.clinerules/hooks` + `sulcus mcp-proxy`) | [`plugins/sulcus-cline`](plugins/sulcus-cline) |
| **`sulcus-opencode`** | OpenCode (`sulcus-opencode.mjs` + `sulcus mcp-proxy`) | [`plugins/sulcus-opencode`](plugins/sulcus-opencode) |
| **`sulcus-hermes`** | Nous Research Hermes Agent (`ContextEngine` + `sulcus mcp-proxy`) | [`plugins/sulcus-hermes`](plugins/sulcus-hermes) |
| **`sulcus-continue`** | Continue (`sulcus-context-provider.mjs` + `sulcus mcp-proxy`) | [`plugins/sulcus-continue`](plugins/sulcus-continue) |
| **`sulcus-aider`** | Aider (`aider-sulcus.sh` + `sulcus hook --harness aider`) | [`plugins/sulcus-aider`](plugins/sulcus-aider) |
| **`sulcus-zed`** | Zed (`extension.toml` + `sulcus mcp-proxy`) | [`plugins/sulcus-zed`](plugins/sulcus-zed) |
| **`sulcus-neovim`** | Neovim (`sulcus.nvim` Lua plugin) | [`plugins/sulcus-neovim`](plugins/sulcus-neovim) |
| **`sulcus-chatgpt`** | OpenAI ChatGPT / Apps (Remote Streamable HTTP MCP) | [`plugins/sulcus-chatgpt`](plugins/sulcus-chatgpt) |

---

## Quick Start

### Install Client

```bash
# Official one-command installer (SHA-256 + --verify-self checked)
curl -fsSL https://sulcus.ca/install.sh | bash

# Or via Homebrew on macOS / Linux
brew tap digitalforgeca/sulcus && brew install sulcus
```

### Connect MCP

```bash
sulcus status
sulcus login
sulcus connect
sulcus doctor --fix
```

For manual zero-lock MCP configuration:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "sulcus",
      "args": ["mcp-proxy"]
    }
  }
}
```

### Python SDK

```bash
pip install "git+https://github.com/digitalforgeca/sulcus.git#subdirectory=sdks/python"
```

```python
import os
from sulcus import Sulcus

client = Sulcus(api_key=os.environ["SULCUS_API_KEY"])

# Classify candidate text with System 1 VCR before storing
gate = client.vcr_classify("Run database migrations before rolling out application workers.")

client.remember(
    "Run database migrations before rolling out application workers.",
    memory_type="procedural",
    namespace="infrastructure",
)

results = client.search(
    query="deployment order for application workers",
    namespace="infrastructure",
)

for node in results:
    print(f"[{node.memory_type}] {node.pointer_summary} (heat={node.current_heat:.2f})")
```

### Node SDK

```bash
git clone https://github.com/digitalforgeca/sulcus.git
cd sulcus/sdks/node && npm install && npm run build
```

```typescript
import { Sulcus } from 'sulcus';

const client = new Sulcus({ apiKey: process.env.SULCUS_API_KEY });

const gate = await client.vcrClassify('Run database migrations before rolling out workers.');

const context = await client.buildContext({
  query: 'deployment order for application workers',
  tokenBudget: 1500,
  namespace: 'infrastructure',
});

console.log(context.formattedBlock);
```

---

## Client Libraries

| Component | Runtime / Ecosystem | Path |
| :--- | :--- | :--- |
| **Python SDK** (`sulcus`) | Python 3.9+ (sync + async, zero external deps) | [`sdks/python`](sdks/python) |
| **Node.js / TS SDK** (`sulcus`) | Node.js 18+ / TypeScript | [`sdks/node`](sdks/node) |
| **`sulcus-langchain`** | LangChain Core & LangGraph | [`integrations/langchain`](integrations/langchain) |
| **`sulcus-llamaindex`** | LlamaIndex RAG & Vector Store | [`integrations/llamaindex`](integrations/llamaindex) |
| **`sulcus-crewai`** | CrewAI Memory Storage & Tools | [`integrations/crewai`](integrations/crewai) |
| **`sulcus-deepagents`** | LangChain Deep Agents Middleware | [`integrations/deepagents`](integrations/deepagents) |
| **`sulcus-vercel-ai`** | Vercel AI SDK Core & Middleware | [`integrations/vercel-ai`](integrations/vercel-ai) |
| **`sulcus-cli`** | Interactive TypeScript Terminal Helper | [`integrations/cli`](integrations/cli) |
| **`sulcus-core-tools`** | Canonical OpenAI / Anthropic / Gemini Tool Dispatchers | [`packages/sulcus-core-tools`](packages/sulcus-core-tools) |
| **`openclaw-sulcus`** | OpenClaw Context Engine Adapter | [`packages/openclaw-sulcus`](packages/openclaw-sulcus) |
| **`sulcusbench`** | 20-Scenario Memory Evaluation Suite | [`packages/sulcusbench`](packages/sulcusbench) |
| **`google-memory-bench`** | NIAH, Evo-Memory & BABILong Suite | [`packages/google-memory-bench`](packages/google-memory-bench) |

---

## Repository Structure

```
sulcus/
├── plugins/                     # 17 Multi-Agent Harness & IDE Integrations
├── sdks/                        # Official Python & TypeScript Client SDKs
├── integrations/                # LangChain, LlamaIndex, CrewAI, Deep Agents, Vercel AI & CLI
├── packages/                    # Tool Dispatchers, OpenClaw Adapter & Benchmark Suites
├── docs/                        # System 1 VCR API, Lifecycle Training & Setup Guides
├── skills/                      # Agent Skill Definitions
├── tools/                       # Hook Scripts, Manifests & Standalone Examples
├── homebrew/                    # Official Homebrew Formula
└── install.sh                   # Signed Native Binary Installer
```

---

## License

Client SDKs, harness plugins, integration adapters, evaluation suites, and documentation in this repository are released under the [MIT License](LICENSE). See [LICENSE](LICENSE) for full terms and proprietary runtime and cloud service reservations.

Built by Digital Forge Studios Inc. · [sulcus.ca](https://sulcus.ca) · [support@sulcus.ca](mailto:support@sulcus.ca)
