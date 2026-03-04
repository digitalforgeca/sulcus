# SULCUS Launch Campaign Posts

## DAY 1 — THE PROBLEM (Teaser Thread)

1/5 Your AI agent doesn't have a memory problem. It has a context management problem. The context window is a CPU register, not a disk. We're building the first vMMU for agents. Launching in 48h. 🦀🚀 #AI #Rust #vMMU

2/5 Ever had an agent that’s brilliant at turn 50, but starts hallucinating at turn 200? That’s context overflow. RAG is just a keyword search; agents need a deterministic memory paging system.

3/5 Think of SULCUS as Virtual Memory for LLMs. Hot "pages" of memory stay in the active context. Cold ones are paged out to an embedded Postgres backend. Zero latency. Infinite recall.

4/5 The core tech:
🔥 Thermodynamic Heat/Decay logic
⚡ Zero-copy shared memory (mmap + rkyv)
⚛️ HLC-CRDTs for multi-device sync
🌐 WASM module for browser-native agents

5/5 8B models. 8k context. 10,000-turn sessions. Stop burning tokens on history. Give your agent a mind that pages. 
Early access: sulcus.io 

---

## DAY 2 — THE TECH (Technical Deep-Dive)

1/3 How do we manage agent context? SULCUS uses a thermodynamic graph. Nodes gain "heat" on use and "decay" over time.
SQL-native decay: `UPDATE nodes SET heat = heat * 0.85 WHERE is_pinned = FALSE`.

2/3 Retrieval isn't just vector search. It's hybrid. 
We combine Cosine Similarity (0.6) with PostgreSQL Full-Text Search (0.4) + a Heat-weighted reranker. Deterministic recall of what's currently "hot" in the agent's mind.

3/3 Multi-agent consistency is hard. SULCUS uses Hybrid Logical Clocks (HLC) and state-based CRDTs to merge memories across a distributed swarm without a central coordinator. Absolute convergence, guaranteed. 🦀

---

## DAY 3 — THE LAUNCH

SULCUS is LIVE. 🚀

The Virtual Memory Management Unit for AI Agents.
Local-first. Deterministic. Distributed.

Give your agents a real mind: https://sulcus.io

#AI #LLM #OpenSource #RustLang

---

## REDDIT ANNOUNCEMENT (r/LocalLLaMA)

**Title: [Project] SULCUS: A Virtual Memory Management Unit (vMMU) for Local Agents**

Hey r/LocalLLaMA,

We’ve been working on a core infrastructure problem for autonomous agents: **Context Dementia**. 

Even with 128k windows, agents eventually lose the thread. Current RAG solutions are too slow for real-time loops and "stateless" prompting burns through tokens by re-sending the same history every turn.

**SULCUS** is a vMMU (Virtual Memory Management Unit) written in Rust. It manages the agent's context window like an OS manages RAM.

**Key Features:**
* **Thermodynamic Memory:** Knowledge graph nodes that gain heat on use and decay over time. The vMMU autonomously "pages" salient context into the prompt.
* **Zero-Copy Hot Path:** We use `rkyv` and `mmap` to share memory between the sidecar and your agent runtime with zero deserialization overhead.
* **Collective Brain:** HLC-CRDT synchronization allows a swarm of 100+ agents to share a single "Golden Index" on your own infrastructure.
* **WASM Core:** The same Rust engine runs in the browser, providing memory for web-based agents (Claude/ChatGPT) via IndexedDB.

**Why this matters for local LLMs:**
You can run a 10,000-turn session on an 8B model with only an 8k context window. SULCUS ensures the right "pages" are in the window at the right time.

We’re launching the MIT-licensed core today. 

Check it out: [sulcus.io](https://sulcus.io)
GitHub: [google/sulcus](https://github.com/google/sulcus)

Would love to hear your thoughts on the thermodynamic approach vs. standard vector search!
