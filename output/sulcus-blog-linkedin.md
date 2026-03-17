# Why Your AI Agent Forgets Everything (And How Thermodynamic Memory Fixes It)

Every time you start a new session with an AI agent, you're talking to a stranger.

It doesn't remember your preferences. It doesn't know you've explained your tech stack six times. Every session begins at zero — endlessly capable, constitutionally amnesiac.

The gap to genuinely useful AI agents isn't intelligence. It's persistence.

---

**Why existing solutions fall short:**

Mem0, Zep, Supermemory — all cloud-first, all round-trip latency, no physics. They use timestamp-based relevance decay: old memories matter less. But timestamps are dumb. A memory you accessed five times yesterday is treated the same as one you touched once six months ago. That's not how importance works.

---

**The thermodynamic model:**

We built Sulcus around a different idea. In physics, heat describes energy state — hot things cool down, and the rate depends on the material. We applied this directly to memory.

Every memory in Sulcus has **heat** — initialized on store, spiked on recall, decaying over time according to a configurable half-life. Frequently-recalled memories stay hot and relevant. Dormant memories cool and fade. You configure decay classes (ephemeral → permanent) to match the semantics of what you're storing.

This isn't a heuristic. It's a physics-grounded relevance model.

---

**Reactive triggers — something no competitor has:**

Memory shouldn't be passive. When a memory is stored, recalled, or crosses a heat threshold, Sulcus fires configurable actions automatically. Your agent can react when context is fading, re-confirm stale preferences, or surface warming context proactively.

No other memory system does this.

---

**Local-first, zero dependencies:**

```bash
pip install sulcus
npm install sulcus
```

Runs embedded in your agent. No server. No API key. No cloud account required. MCP native — drop it into Claude Desktop with a single config entry. Full functionality on local disk I/O alone.

---

**On our MemBench results:**

Sulcus leads on recall accuracy in our testing, particularly on long-term recall tasks. We're being upfront: these results are preliminary. Our competitor adapters were built by us, which may not represent those systems fairly. We'll publish full methodology with proper fairness validation soon.

What we're confident in: thermodynamic recall meaningfully outperforms naive recency weighting as memory stores grow. The recall leadership is real. The full competitive picture needs more honest work.

---

**The gap to AGI is memory.**

Raw intelligence has been good enough for years. What's missing is persistence of identity — memory that decays, responds, and stays relevant.

Your agent shouldn't have to re-learn everything every time.

👉 [sulcus.dforge.ca](https://sulcus.dforge.ca)

`pip install sulcus` | `npm install sulcus`
