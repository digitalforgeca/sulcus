# Launch Post Drafts

## Show HN: Sulcus – A Virtual Memory Management Unit (vMMU) for AI Agents

**Headline:** Show HN: Sulcus – A Virtual Memory Management Unit (vMMU) for AI Agents

**Post:**
Hi HN,

We’re building Sulcus, an open-source "Memory Controller" for LLM agents.

The problem: Current agents rely on simple context window history or naive RAG. This leads to "Digital Alzheimer's" as soon as the context window fills up, or "irrelevant noise" when RAG pulls the wrong snippets.

Sulcus takes a systems engineering approach. We implemented a Virtual Memory Management Unit (vMMU) that treats the prompt as registers and local storage as RAM.

Key Features:
- **Thermodynamic Decay**: Memories carry "Heat." New facts are hot; unused facts decay.
- **Topological Diffusion**: Using recursive CTEs in Postgres, heat spreads through the knowledge graph. Mentioning a topic "warms up" related concepts automatically.
- **Performance**: Built in Rust. Sub-50ms latency for building context blocks.
- **Zero-Copy**: Uses `rkyv` and `mmap` to share the active index directly with the agent runtime.

We’ve integrated it into OpenClaw and validated that it allows "Nano" models (8k context) to remember complex project details across thousands of turns of unrelated "noise."

Check it out on GitHub: [link]
Documentation: [link]

Would love to hear your thoughts on the thermodynamic model vs. traditional vector search.

---

## r/LocalLLaMA: Give your tiny models infinite context with Sulcus (Rust/Postgres vMMU)

**Headline:** Give your tiny models infinite context with Sulcus (Rust/Postgres vMMU)

**Post:**
Hey folks,

Just finished the first integration of **Sulcus** into OpenClaw and wanted to share the results. 

If you're running local models (like Llama 3 8B or Phi-3), you know the context window is the enemy. Once it's full, the agent gets stupid.

Sulcus is a vMMU (Virtual Memory Management Unit) that manages the "paging" of your agent's mind. Instead of just searching for text, it uses a thermodynamic model where nodes in a knowledge graph gain "heat" when relevant and "decay" when not.

We’re seeing <50ms overhead for context injection. Because it’s built in Rust with an embedded Postgres, it’s incredibly lightweight.

**What it actually does:**
- Automatically captures every conversation turn.
- Builds a `<sulcus_context>` XML block for every prompt.
- Ignites "cold" memories based on semantic similarity.
- Prunes the active index so you never hit a context overflow.

Open Source: [link]

Happy to answer any questions about the Rust stack or the heat diffusion logic!
