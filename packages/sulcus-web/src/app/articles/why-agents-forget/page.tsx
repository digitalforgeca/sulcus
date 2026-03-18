'use client';

import Link from 'next/link';
import { TbArrowLeft, TbFlame, TbBucket, TbTemperature, TbTestPipe, TbTable } from 'react-icons/tb';

export default function WhyAgentsForgetArticle() {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed]">
      <div className="max-w-3xl mx-auto px-6 py-16 font-sans">
        {/* Back link */}
        <Link href="/articles" className="text-[#00F0FF]/60 hover:text-[#00F0FF] text-sm flex items-center gap-1 mb-8">
          <TbArrowLeft size={14} /> Articles
        </Link>

        {/* Header */}
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Why Your AI Agent Forgets Everything (And How Thermodynamic Memory Fixes It)
        </h1>
        <p className="text-sm text-[#888] mb-2">
          Most memory systems aren&apos;t memory systems at all. They&apos;re buckets. Here&apos;s why that breaks
          in production — and what a physics-based approach changes.
        </p>
        <p className="text-xs text-[#555] mb-8 tracking-wider uppercase">
          March 2026 &middot; Digital Forge Studios
        </p>
        <div className="border-b border-[#D4AF37]/20 mb-10" />

        {/* Body */}
        <article className="prose prose-invert prose-sm max-w-none space-y-6 text-[#ccc] leading-relaxed">

          <p>
            There&apos;s a dirty secret in the AI agent ecosystem: most memory systems aren&apos;t memory systems
            at all. They&apos;re buckets. You put things in, you pull things out, and everything inside is
            treated with identical indifference — the conversation from this morning weighted the same
            as the context from six months ago. Recent. Stale. Critical. Noise. The bucket doesn&apos;t care.
          </p>
          <p>
            This is why your AI agent keeps forgetting what matters, keeps surfacing irrelevant context,
            and keeps bloating your context window with garbage from last quarter. It&apos;s not a model problem.
            It&apos;s a memory architecture problem. And it&apos;s solvable — but not by adding more storage.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-12 flex items-center gap-2">
            <TbBucket className="text-[#888]" /> The Flat Memory Problem
          </h2>
          <p>
            Every major memory framework ships the same basic abstraction: a store with timestamps and
            similarity search. Mem0, Zep, Letta — respected projects, genuinely useful
            as <em>storage layers</em>. But storage is not memory. Memory is storage plus <strong className="text-white">physics</strong>.
          </p>
          <p>In current implementations, here&apos;s what happens in practice:</p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>An agent interaction fires. Some facts get extracted.</li>
            <li>Those facts go into a vector store with a timestamp.</li>
            <li>On the next retrieval, semantic similarity scores determine what surfaces.</li>
            <li>Everything in the store is a candidate. Nothing is ranked by relevance <em>over time</em>.</li>
          </ol>
          <p>
            The result is a retrieval landscape that&apos;s flat. Your agent equally &ldquo;remembers&rdquo; that a user
            prefers dark mode UI and that they&apos;re running a critical infrastructure migration — because
            both items scored 0.87 similarity to the current query. There&apos;s no gravitational pull toward
            what actually matters <em>right now</em>. There&apos;s no forgetting of what no longer matters <em>at all</em>.
          </p>
          <p>This produces three compounding failure modes:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-white">Context bloat.</strong> Retrieval systems that don&apos;t decay surface
              everything. Everything gets shoved into the context window. Token costs explode, latency
              grows, and the model&apos;s attention dilutes across decades of accumulated cruft.
            </li>
            <li>
              <strong className="text-white">Irrelevant recall.</strong> Without reinforcement mechanics, a casual
              mention from month one has the same retrieval weight as a repeated, high-stakes topic the
              user returns to constantly. The system treats frequency and recency as identical — which they are not.
            </li>
            <li>
              <strong className="text-white">No prioritization.</strong> Nothing tells the memory system
              what <em>matters</em>. Timestamps are not importance signals. Cosine similarity is not urgency.
              The retrieval system is blind to the difference between noise and signal.
            </li>
          </ul>
          <p>
            The fundamental issue: these systems treat memory as a filing cabinet. Retrieve by keyword. Done.
            But the human brain — the only working reference implementation we have for long-term associative
            memory — operates nothing like a filing cabinet. It operates like thermodynamics.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-12 flex items-center gap-2">
            <TbTemperature className="text-[#FF6B35]" /> Memory Has Temperature
          </h2>
          <p>
            Here&apos;s the insight that changes the architecture entirely: <strong className="text-white">memories
            aren&apos;t equal — they have temperature</strong>.
          </p>
          <p>
            Hot memories are recent, repeatedly accessed, or actively reinforced. They surface instantly.
            A user&apos;s ongoing project architecture decision is hot. The edge case they mentioned once
            in passing is not.
          </p>
          <p>
            Cold memories are stale, unreinforced, low-access. They fade naturally. Not deleted — <em>cooled</em>.
            Still retrievable under the right conditions, but no longer competing with hot memories
            for surface space.
          </p>
          <p>
            This isn&apos;t a metaphor for decoration. It&apos;s a design specification. In thermodynamic memory,
            every stored fact carries a <strong className="text-white">thermal state</strong> — a numerical
            representation of its current retrieval priority — governed by a decay function:
          </p>
          <pre className="bg-[#0a1018] border border-[#00F0FF]/10 p-4 text-xs font-mono text-[#ccc] overflow-x-auto">
{`T(t) = T₀ × e^(-λt) + Σ(reinforcement_events)

where:
  λ  = decay constant (configurable per memory type)
  T₀ = initial temperature
  reinforcement = additive heating on re-access or relevance confirmation`}
          </pre>
          <p>
            This single change transforms retrieval from keyword lookup into <strong className="text-white">prioritized
            surfacing</strong>. The retrieval engine doesn&apos;t just ask &ldquo;is this similar?&rdquo; It asks &ldquo;is this
            similar <em>and is it still hot?</em>&rdquo;
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-12 flex items-center gap-2">
            <TbFlame className="text-[#D4AF37]" /> How SULCUS Works
          </h2>
          <p>
            <a href="https://sulcus.ca" className="text-[#D4AF37] hover:text-[#00F0FF]">SULCUS</a> is
            built around a thermodynamic decay engine as a first-class primitive. It&apos;s not a wrapper around
            an existing vector store with decay bolted on. The decay function is core infrastructure.
          </p>

          <h3 className="text-lg font-bold text-[#ededed] mt-8">Thermodynamic Decay Engine</h3>
          <p>
            Every memory object carries a thermal metadata block: initial temperature, decay constant,
            last reinforcement timestamp, and an accumulated heat value. <strong className="text-white">Configurable
            half-lives per memory type</strong> are the critical design decision. Not all facts decay at the
            same rate. A user&apos;s name: very slow decay, measured in months. A specific bug they mentioned
            in passing: fast decay, measured in days. An ongoing task they return to weekly: medium decay
            with reinforcement spikes on each return.
          </p>

          <h3 className="text-lg font-bold text-[#ededed] mt-8">Spaced Repetition Reinforcement</h3>
          <p>
            Borrowing from cognitive science — specifically the Ebbinghaus forgetting curve — SULCUS
            reinforces memories each time they&apos;re accessed or re-confirmed. Direct access triggers a
            full reinforcement spike. Indirect relevance triggers a partial spike. Contradiction from
            new context triggers negative reinforcement (cooling). The system learns importance through
            use rather than requiring explicit tagging.
          </p>

          <h3 className="text-lg font-bold text-[#ededed] mt-8">CRDT Sync for Cross-Agent Memory</h3>
          <p>
            Multi-agent architectures introduce a hard problem: memory synchronization. If Agent A and
            Agent B share a user context, who owns the memory? SULCUS uses <strong className="text-white">CRDTs
            (Conflict-free Replicated Data Types)</strong> for memory state — distributed memory across
            agent instances merges deterministically without coordination overhead. No locks. No primary
            node. Every agent in the mesh converges to the same thermal state.
          </p>

          <h3 className="text-lg font-bold text-[#ededed] mt-8">MCP Native</h3>
          <p>
            SULCUS implements the <strong className="text-white">Model Context Protocol (MCP)</strong> natively.
            Drop it into Claude Desktop, wire it into your MCP-compatible agent framework, and thermodynamic
            memory is live with zero custom integration code.
          </p>

          <h3 className="text-lg font-bold text-[#ededed] mt-8">Self-Hosted First</h3>
          <p>
            SULCUS runs on an embedded PostgreSQL instance by default. Zero external cloud dependency.
            No SaaS account required. No data leaves your infrastructure. For teams that want managed
            hosting, a cloud tier is available — but self-hosted is the default path.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-12 flex items-center gap-2">
            <TbTestPipe className="text-[#22c55e]" /> MemBench: Show Your Work
          </h2>
          <p>
            Claims about memory quality are cheap. Benchmarks are not.
          </p>
          <p>
            <a href="/membench" className="text-[#D4AF37] hover:text-[#00F0FF]">MemBench</a> is an open
            benchmark for evaluating AI memory systems across four dimensions: recall precision, temporal
            relevance, noise rejection, and cross-agent coherence.
          </p>
          <p>
            Run it against Mem0. Run it against Zep. Run it against SULCUS. Compare the numbers.
            The benchmark is the argument. We&apos;re publishing it because the current landscape of memory
            evaluation is nearly all marketing. &ldquo;We have memory&rdquo; is not a specification. MemBench
            forces specificity.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-12 flex items-center gap-2">
            <TbTable className="text-[#a855f7]" /> SULCUS vs. The Field
          </h2>
          <div className="overflow-x-auto my-4">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D4AF37]/20">
                  <th className="text-left py-2 pr-4 text-[#888]">&nbsp;</th>
                  <th className="text-left py-2 pr-4 text-[#888]">Mem0</th>
                  <th className="text-left py-2 pr-4 text-[#888]">Zep</th>
                  <th className="text-left py-2 pr-4 text-[#888]">Letta</th>
                  <th className="text-left py-2 pr-4 text-[#D4AF37] font-bold">SULCUS</th>
                </tr>
              </thead>
              <tbody className="text-[#aaa]">
                <tr className="border-b border-[#1a2a3a]">
                  <td className="py-2 pr-4 text-[#ededed]">Memory model</td>
                  <td className="py-2 pr-4">Flat + similarity</td>
                  <td className="py-2 pr-4">Flat + recency</td>
                  <td className="py-2 pr-4">Stateful agent</td>
                  <td className="py-2 pr-4 text-[#D4AF37] font-bold">Thermodynamic decay</td>
                </tr>
                <tr className="border-b border-[#1a2a3a]">
                  <td className="py-2 pr-4 text-[#ededed]">Decay function</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4">Partial</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4 text-[#D4AF37] font-bold">Configurable half-lives</td>
                </tr>
                <tr className="border-b border-[#1a2a3a]">
                  <td className="py-2 pr-4 text-[#ededed]">Reinforcement</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4 text-[#D4AF37] font-bold">Spaced repetition</td>
                </tr>
                <tr className="border-b border-[#1a2a3a]">
                  <td className="py-2 pr-4 text-[#ededed]">CRDT sync</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4 text-[#D4AF37] font-bold">Native</td>
                </tr>
                <tr className="border-b border-[#1a2a3a]">
                  <td className="py-2 pr-4 text-[#ededed]">MCP native</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4 text-[#D4AF37] font-bold">Yes</td>
                </tr>
                <tr className="border-b border-[#1a2a3a]">
                  <td className="py-2 pr-4 text-[#ededed]">Self-hosted</td>
                  <td className="py-2 pr-4">Partial</td>
                  <td className="py-2 pr-4">Yes</td>
                  <td className="py-2 pr-4">Yes</td>
                  <td className="py-2 pr-4 text-[#D4AF37] font-bold">Yes (embedded PG)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-[#ededed]">Open benchmark</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4">❌</td>
                  <td className="py-2 pr-4 text-[#D4AF37] font-bold">MemBench</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 className="text-xl font-bold text-[#ededed] mt-12">The Architecture Decision You&apos;ll Regret Not Making Early</h2>
          <p>
            Memory architecture is one of those decisions that seems low-stakes until it isn&apos;t. You start
            with a simple vector store. Context stays small. Everything works. Then your agent accumulates
            six months of user history, retrieval starts surfacing noise, context windows balloon, and
            you realize you&apos;ve built a flat memory system you now need to migrate off.
          </p>
          <p>
            The thermodynamic approach requires more design upfront — configuring decay profiles, thinking
            about reinforcement signals, understanding your hot-window requirements. But it pays compound
            returns. The longer your agent runs, the more intelligent its recall becomes. Memory that&apos;s been
            used stays hot. Memory that doesn&apos;t matter cools away. The system improves through use rather
            than degrading through accumulation.
          </p>
          <p>That&apos;s what memory is supposed to do.</p>

          <div className="border-t border-[#D4AF37]/20 mt-12 pt-8">
            <h2 className="text-xl font-bold text-[#ededed] mb-4">Try SULCUS</h2>
            <p>
              SULCUS is available now at <a href="https://sulcus.ca" className="text-[#D4AF37] hover:text-[#00F0FF]">sulcus.ca</a>.
              MCP server works with Claude Desktop out of the box. Self-hosted with embedded PG — no
              cloud dependency required.
            </p>
            <p className="mt-4 text-[#D4AF37] italic">
              The bucket era of AI memory is over. Your agents deserve physics.
            </p>
            <div className="flex flex-col md:flex-row gap-4 mt-6">
              <a href="https://github.com/digitalforgeca/sulcus" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
                View Source &rarr;
              </a>
              <a href="/membench" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
                MemBench &rarr;
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
