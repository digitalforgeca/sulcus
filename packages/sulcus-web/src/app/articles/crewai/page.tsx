'use client';

import Link from 'next/link';
import { TbArrowLeft, TbFlame, TbChartBar, TbUsers, TbAdjustments } from 'react-icons/tb';

export default function CrewAIArticle() {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed]">
      <div className="max-w-3xl mx-auto px-6 py-16 font-sans">
        <Link href="/articles" className="text-[#00F0FF]/60 hover:text-[#00F0FF] text-sm flex items-center gap-1 mb-8">
          <TbArrowLeft size={14} /> Articles
        </Link>

        <h1 className="text-3xl font-bold tracking-tight mb-2">
          CrewAI&apos;s Memory: Four Types, One Assumption
        </h1>
        <p className="text-sm text-[#888] mb-8">
          CrewAI ships a unified memory API with scope trees, importance scoring, and LLM-powered extraction.
          It&apos;s the most sophisticated memory system in the agent framework space. It&apos;s still not enough.
        </p>
        <div className="border-b border-[#D4AF37]/20 mb-10" />

        <article className="prose prose-invert prose-sm max-w-none space-y-6 text-[#ccc] leading-relaxed">
          <h2 className="text-xl font-bold text-[#ededed] mt-8">Credit to CrewAI</h2>
          <p>
            Let&apos;s be honest: CrewAI&apos;s memory is the best in the mainstream agent framework space.
            They consolidated what used to be four separate classes — short-term, long-term, entity, external —
            into a single <code>Memory</code> API. <code>remember()</code>, <code>recall()</code>, <code>forget()</code>.
            Clean. An LLM infers scope, categories, and importance on save. Recall uses composite scoring that
            blends semantic similarity, recency, and importance. Agents can have private scopes within a crew&apos;s
            shared memory.
          </p>
          <p>
            This is genuinely good work. Most frameworks don&apos;t even try.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-8">The Weights-and-Scores Ceiling</h2>
          <p>
            CrewAI&apos;s composite scoring blends three signals:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Semantic similarity</strong> — cosine distance on embeddings. Standard RAG.</li>
            <li><strong>Recency</strong> — exponential decay with configurable half-life. Better than most.</li>
            <li><strong>Importance</strong> — LLM-assigned score at write time. Interesting but static.</li>
          </ul>
          <p>
            The problem: these weights are <em>fixed at query time</em>. You set <code>recency_weight=0.5</code>
            and <code>semantic_weight=0.3</code> once, and every recall uses the same formula. There&apos;s no
            feedback loop. No learning from whether retrieved memories were actually useful. The importance
            score is assigned when the memory is created and never updated.
          </p>
          <p>
            This is the weights-and-scores ceiling: you can tune the formula, but the formula itself
            doesn&apos;t evolve. Every memory retrieval is an independent event with no influence on
            future retrievals.
          </p>

          <h2 className="text-xl font-bold text-[#ededed] mt-8">What&apos;s Missing: The Feedback Loop</h2>
          <p>
            Biological memory doesn&apos;t work by computing <code>0.5 * recency + 0.3 * similarity + 0.2 * importance</code>.
            It works by <em>reinforcement</em>. You recall something useful? It gets easier to recall next time.
            Something surfaces and it&apos;s irrelevant? The pathway weakens. Over time, the system self-optimizes
            without anyone tuning weights.
          </p>
          <p>
            This is what thermodynamic memory adds:
          </p>

          <div className="bg-[#0a1520] border border-[#D4AF37]/20 rounded-lg p-6 my-6">
            <h3 className="text-sm font-bold text-[#D4AF37] mb-3 flex items-center gap-2">
              <TbFlame size={16} /> The Thermodynamic Difference
            </h3>
            <div className="space-y-3 text-xs text-[#999]">
              <div className="flex gap-3">
                <span className="text-[#D4AF37] font-mono w-24 flex-shrink-0">Heat</span>
                <span>Not a static score — a dynamic temperature that rises on access and decays over time.
                  Each memory type has its own half-life (episodic: 24h, semantic: 30d, preference: 90d).</span>
              </div>
              <div className="flex gap-3">
                <span className="text-[#00F0FF] font-mono w-24 flex-shrink-0">Stability</span>
                <span>Each recall multiplies stability via spaced repetition. A memory recalled 5 times has a
                  much longer effective half-life than one recalled once. This is the feedback loop CrewAI lacks.</span>
              </div>
              <div className="flex gap-3">
                <span className="text-[#a855f7] font-mono w-24 flex-shrink-0">Resonance</span>
                <span>Accessing a memory spreads heat to connected memories through edges. Recall &ldquo;PostgreSQL&rdquo;
                  and &ldquo;migration budget: $50k&rdquo; warms up too. Associative, not just keyword-matched.</span>
              </div>
              <div className="flex gap-3">
                <span className="text-[#22c55e] font-mono w-24 flex-shrink-0">Feedback</span>
                <span>Signal &ldquo;relevant&rdquo; or &ldquo;irrelevant&rdquo; on any retrieval. The system boosts
                  or suppresses that memory — and adjusts the underlying half-lives over time based on aggregate patterns.</span>
              </div>
            </div>
          </div>

          <h2 className="text-xl font-bold text-[#ededed] mt-8">CrewAI&apos;s Scope Trees vs. Agent-Aware Memory</h2>
          <p>
            CrewAI&apos;s <code>memory.scope(&quot;/agent/researcher&quot;)</code> is a nice pattern — it gives
            agents private namespaces within a shared memory store. But it&apos;s path-based. There&apos;s no
            concept of <em>projects</em> that span multiple agents, no session-level granularity, and no
            dashboard for the human operator to see what each agent remembers.
          </p>
          <p>
            A Sulcus integration gives CrewAI crews:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Per-agent memory with agent IDs, not just path prefixes</li>
            <li>Per-session tagging so you can trace which conversation produced which memory</li>
            <li>Project grouping — agents assigned to the same project share memories; others don&apos;t</li>
            <li>A visual dashboard showing the memory graph, heat distribution, and recall quality per agent</li>
          </ul>

          <h2 className="text-xl font-bold text-[#ededed] mt-8">Integration</h2>
          <p>
            Sulcus provides a drop-in memory backend for CrewAI:
          </p>
          <pre className="bg-[#0a1520] border border-[#333] rounded-lg p-4 text-xs overflow-x-auto">
{`from crewai import Crew, Agent, Task, Process
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Store memories through Sulcus instead of CrewAI's default
client.remember(
    "PostgreSQL migration planned for Q2",
    memory_type="semantic",
    agent_id="researcher"
)

# Recall with thermodynamic ranking
results = client.search("database migration plans")
# Results are ranked by heat (recency + access frequency),
# not just semantic similarity.

# Feedback loop: tell Sulcus what was actually useful
client.feedback(
    node_id=results[0].id,
    signal="relevant"  # boosts heat + stability
)`}
          </pre>

          <p>
            CrewAI built the best memory API in the agent framework space. Sulcus provides the engine
            that makes that API behave like actual memory — with physics, feedback, and decay — instead
            of a weighted search index.
          </p>

          <div className="border-t border-[#D4AF37]/20 mt-10 pt-6">
            <p className="text-sm text-[#888]">
              The gap between &ldquo;good scoring formula&rdquo; and &ldquo;memory that learns&rdquo;
              is the gap between static retrieval and thermodynamic recall. CrewAI got closer than anyone.
              Sulcus closes the distance.
            </p>
            <div className="flex gap-4 mt-4">
              <Link href="/docs" className="text-sm text-[#00F0FF] hover:underline">SDK Documentation →</Link>
              <a href="https://pypi.org/project/sulcus/" className="text-sm text-[#00F0FF] hover:underline" target="_blank" rel="noopener">PyPI →</a>
              <a href="https://github.com/digitalforgeca/sulcus" className="text-sm text-[#00F0FF] hover:underline" target="_blank" rel="noopener">GitHub →</a>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
