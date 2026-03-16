'use client';

import Link from 'next/link';
import { TbArrowLeft, TbFlame, TbBolt, TbAdjustments, TbArrowsShuffle, TbSnowflake } from 'react-icons/tb';

export default function ThermodynamicMemoryArticle() {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed]">
      <div className="max-w-3xl mx-auto px-6 py-16 font-sans">
        {/* Back link */}
        <Link href="/articles" className="text-[#00F0FF]/60 hover:text-[#00F0FF] text-sm flex items-center gap-1 mb-8">
          <TbArrowLeft size={14} /> Articles
        </Link>

        {/* Header */}
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Thermodynamic Memory: Why Your Agent&apos;s Brain Needs Physics
        </h1>
        <p className="text-sm text-[#888] mb-2">
          Most AI memory systems are glorified databases with a search index. SULCUS treats memories
          as thermodynamic objects — born hot, cooling with time, reheating on recall, diffusing through edges.
          Here&apos;s how and why.
        </p>
        <p className="text-xs text-[#555] mb-8 tracking-wider uppercase">
          March 2026 &middot; Digital Forge Studios
        </p>
        <div className="border-b border-[#D4AF37]/20 mb-10" />

        {/* Body */}
        <article className="prose prose-invert prose-sm max-w-none space-y-6 text-[#ccc] leading-relaxed">

          <h2 className="text-xl font-bold text-[#ededed] mt-8 flex items-center gap-2">
            <TbFlame className="text-[#FF6B35]" /> The Problem with Static Memory
          </h2>
          <p>
            Every AI agent framework that offers &ldquo;memory&rdquo; makes the same mistake: they treat memories as
            static records. You write a fact, it goes in a database, and when you search, you get
            whatever the embedding model thinks is closest. There&apos;s no notion of <em>relevance over time</em>,
            no concept of <em>importance</em>, no mechanism for <em>forgetting</em>.
          </p>
          <p>
            This creates two problems that compound as usage grows:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong className="text-white">Context bloat</strong> — every memory is equally important,
            so the system either dumps everything into the context window (expensive) or does naive
            top-k retrieval (misses critical context).</li>
            <li><strong className="text-white">Stale knowledge</strong> — a preference set six months ago
            has the same weight as one set today. The agent can&apos;t distinguish between &ldquo;the user used
            to prefer dark mode&rdquo; and &ldquo;the user prefers dark mode.&rdquo;</li>
          </ul>
          <p>
            Human memory doesn&apos;t work this way. Memories fade. Important ones stick. Recall strengthens
            connections. The brain has a <em>thermodynamic</em> process — energy flows in and dissipates over time.
            SULCUS models exactly this.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-12 flex items-center gap-2">
            <TbBolt className="text-[#D4AF37]" /> The Heat Model
          </h2>
          <p>
            Every memory node in SULCUS has a <code className="bg-[#0a1520] px-1">current_heat</code> value
            between 0.0 and 1.0. When a memory is created, it enters the graph at heat 1.0 — full relevance.
            Over time, it decays according to a <strong className="text-white">type-specific half-life</strong>:
          </p>
          <div className="bg-[#0a1520] border border-[#1a2a3a] p-4 font-mono text-xs space-y-1 my-4">
            <div className="flex justify-between"><span className="text-[#a855f7]">episodic</span><span className="text-[#888]">24-hour half-life</span></div>
            <div className="flex justify-between"><span className="text-[#3b82f6]">semantic</span><span className="text-[#888]">30-day half-life</span></div>
            <div className="flex justify-between"><span className="text-[#f59e0b]">preference</span><span className="text-[#888]">90-day half-life</span></div>
            <div className="flex justify-between"><span className="text-[#22c55e]">procedural</span><span className="text-[#888]">180-day half-life</span></div>
            <div className="flex justify-between"><span className="text-[#ec4899]">synthesis</span><span className="text-[#888]">60-day half-life</span></div>
            <div className="flex justify-between"><span className="text-[#06b6d4]">fact</span><span className="text-[#888]">365-day half-life</span></div>
          </div>
          <p>
            The decay formula is exponential:
          </p>
          <pre className="bg-[#0a1018] border border-[#00F0FF]/10 p-4 text-xs font-mono text-[#ccc] overflow-x-auto">
{`H(t) = H_0 * exp(-lambda * dt / stability)

where:
  lambda = ln(2) / half_life_secs
  dt     = seconds since last decay
  stability >= 1.0 (grows with recalls)`}
          </pre>
          <p>
            The <code className="bg-[#0a1520] px-1">stability</code> field is the spaced-repetition
            multiplier. Every time a memory is recalled, stability increases by a configurable gain factor.
            A memory recalled 5 times has 5x the effective half-life of one never recalled. This is
            Ebbinghaus&apos;s forgetting curve, implemented as a configurable thermodynamic parameter.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-12 flex items-center gap-2">
            <TbArrowsShuffle className="text-[#a855f7]" /> Resonance: Heat Diffusion Through Edges
          </h2>
          <p>
            Memories don&apos;t exist in isolation. When you recall one, related memories should warm up too.
            SULCUS models this as <strong className="text-white">resonance</strong> — heat diffusion through
            the knowledge graph&apos;s edges.
          </p>
          <p>
            When a node is accessed, a configurable fraction of its heat propagates to neighbors, attenuated
            by edge weight and a damping factor per hop. The system supports multi-hop diffusion (default: 2 hops)
            with a thermal gate that prevents cold nodes from propagating noise.
          </p>
          <div className="bg-[#0a1520] border border-[#1a2a3a] p-4 font-mono text-xs space-y-1 my-4">
            <div className="flex justify-between"><span className="text-[#a855f7]">spread_factor</span><span className="text-[#888]">0.3 (30% of heat transfers)</span></div>
            <div className="flex justify-between"><span className="text-[#a855f7]">depth</span><span className="text-[#888]">2 hops</span></div>
            <div className="flex justify-between"><span className="text-[#a855f7]">damping</span><span className="text-[#888]">0.5 per hop</span></div>
            <div className="flex justify-between"><span className="text-[#a855f7]">thermal_gate</span><span className="text-[#888]">0.1 (min source heat)</span></div>
          </div>
          <p>
            The result: recalling &ldquo;the user prefers Bitwarden&rdquo; also warms &ldquo;login forms need autocomplete
            attributes&rdquo; — because they&apos;re connected in the graph. The context window fills itself with
            genuinely relevant knowledge.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-12 flex items-center gap-2">
            <TbSnowflake className="text-[#3b82f6]" /> Consolidation: Folding Cold Memories
          </h2>
          <p>
            As memories cool below the cold threshold, they become candidates for <strong className="text-white">consolidation</strong>.
            Rather than deleting old knowledge, SULCUS folds multiple cold episodic memories into dense
            semantic summaries. The verbose raw content moves to cold storage; a distilled pointer
            summary stays in the warm graph.
          </p>
          <p>
            This mirrors how human memory works: you don&apos;t remember the exact words of a conversation
            from last month, but you remember the key decisions that were made. The information density
            per node increases as the graph matures.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-12 flex items-center gap-2">
            <TbAdjustments className="text-[#00F0FF]" /> 30+ Configurable Parameters
          </h2>
          <p>
            Every parameter mentioned above is configurable per-tenant through the API.
            No hardcoded behavior. No magic numbers. The same <code className="bg-[#0a1520] px-1">ThermoConfig</code> struct
            drives both the local WASM binary and the cloud server — one definition, one API contract,
            two deployment targets.
          </p>
          <p>
            The configuration surface includes:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong className="text-white">Active Index</strong> — max_nodes, context_budget_chars, hot/cold thresholds</li>
            <li><strong className="text-white">Resonance</strong> — spread_factor, depth, damping, thermal_gate</li>
            <li><strong className="text-white">Reinforcement</strong> — on_recall, on_update, on_edge_access, stability_gain</li>
            <li><strong className="text-white">Consolidation</strong> — cold_count_trigger, cold_threshold, strategy</li>
            <li><strong className="text-white">Tick Mode</strong> — fixed, activity-driven, or hybrid scheduling</li>
            <li><strong className="text-white">Per-Type Decay Profiles</strong> — half_life, floor, reinforce_on_recall, stability_gain for each memory type</li>
          </ul>

          <h2 className="text-xl font-bold text-[#ededed] mt-12">The Bottom Line</h2>
          <p>
            Static memory is a solved problem. Any vector database can store and retrieve embeddings.
            The hard problem is <em>relevance management over time</em> — deciding what matters right now,
            what mattered yesterday, and what should be forgotten.
          </p>
          <p>
            SULCUS doesn&apos;t just store memories. It gives them <em>physics</em>. Heat, decay, resonance,
            consolidation — the same principles that govern thermodynamic systems, applied to knowledge graphs.
            The result is an agent that remembers like a human: recent events are vivid, old facts persist
            through reinforcement, and the context window always contains what the moment demands.
          </p>

          <div className="border-t border-[#D4AF37]/20 mt-12 pt-8">
            <div className="flex flex-col md:flex-row gap-4">
              <a href="https://github.com/digitalforgeca/sulcus" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
                View Source &rarr;
              </a>
              <a href="/docs" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
                Documentation &rarr;
              </a>
              <a href="/dashboard" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
                Try It Now &rarr;
              </a>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
