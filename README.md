# SULCUS: The Virtual Memory Management Unit (vMMU) for AI Agents

[![GitHub Stars](https://img.shields.io/github/stars/openclaw/sulcus?style=social)](https://github.com/openclaw/sulcus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **"PGlite for Agent Memory."** Give your agents a mind that pages memory in and out of context based on thermodynamic importance.

---

### 🚀 Get Sulcus Pro
**Don't want to manage Rust toolchains and PostgreSQL instances?**
[**Download the Sulcus Pro Desktop MCP Server**](https://gumroad.com/l/sulcus-pro) – A single, pre-compiled binary that adds infinite memory to Claude Desktop, Cursor, and OpenClaw in one click.

---

## What is a vMMU?

Current AI agents rely on simple context history or naive RAG. This leads to "Digital Alzheimer's" as soon as the context window fills up, or "irrelevant noise" when search pulls the wrong snippets.

**Sulcus** implements a true **Virtual Memory Management Unit (vMMU)**. It treats the prompt window as the "Registers" and local high-performance storage as "RAM."

### Key Innovations:
*   **Thermodynamic Decay**: Every memory node has **Heat**. New facts are hot (1.0); unused facts naturally decay over time.
*   **Topological Diffusion**: Using recursive CTEs in PostgreSQL, heat isn't just applied to direct matches—it **diffuses** through the knowledge graph. Mentioning a topic "warms up" related concepts automatically.
*   **Automatic Page-In/Out**: Sulcus builds a `<sulcus_context>` block for every prompt, automatically "paging in" ignited memories and "paging out" cold ones to stay within model token budgets.
*   **Memory Consolidation (Folding)**: To maximize context efficiency, Sulcus periodically "folds" cold episodic memories into dense semantic summaries. This ensures your agent remembers the *meaning* of old conversations without wasting tokens on raw transcripts.

---

## Performance ⚡

Built in **Rust** with an embedded **PostgreSQL 15** engine, Sulcus is designed for the high-frequency demands of agentic workflows.

*   **Sub-50ms latency** for context building and injection.
*   **Zero-Copy Shared Buffers**: Uses `rkyv` and `mmap` to share the active index directly with the agent runtime—zero serialization overhead on the hot path.
*   **Local-First**: 100% private. Your data never leaves your machine.

---

## Works with Every Major LLM Framework ✅

Sulcus speaks the **Model Context Protocol (MCP)**, making it a drop-in sidecar for:

| Platform | Integration |
| :--- | :--- |
| **Claude Desktop** | Native MCP |
| **Cursor / Cline** | MCP Config |
| **OpenClaw** | [Native Plugin](packages/openclaw-sulcus) |
| **GPT-4o / o3** | Function Calling |
| **Ollama** | 100% Local Pipeline |

---

## Quick Start (For Developers) 🔧

1. **Clone & Build:**
```bash
git clone https://github.com/openclaw/sulcus
cd sulcus
cargo build -p sulcus-local --release
```

2. **Run the MCP Server:**
```bash
./target/release/sulcus-local stdio
```

3. **Configure Claude Desktop:**
Add this to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "sulcus": {
      "command": "/absolute/path/to/sulcus-local",
      "args": ["stdio"]
    }
  }
}
```

---

## Proof of Life: The Stress Test

We validated Sulcus using `gpt-4.1-nano` (8k limit). 
1. **Burial**: We told the agent a key project fact ("Julian is the Lead for Aethelgard").
2. **Noise**: We flooded the agent with 100 unrelated messages about coffee and weather.
3. **Recall**: We asked a vague question: "Who is leading my metaverse project?"
4. **Success**: Sulcus semantically ignited the "Aethelgard" fact from "metaverse," boosted Julian's heat, and injected the fact back into the prompt. **The agent remembered.**

---

## Contributing

Sulcus is open-core. We welcome contributions to the thermodynamic decay algorithms, new storage backends, and agent adapters.

Built with 🦀 for the agentic future.
