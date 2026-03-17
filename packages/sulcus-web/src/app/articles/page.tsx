'use client';

import Link from 'next/link';
import { TbFlame } from 'react-icons/tb';
import { SiteNav } from '@/components/site-nav';

const ARTICLES = [
  {
    slug: 'why-agents-forget',
    title: 'Why Your AI Agent Forgets Everything (And How Thermodynamic Memory Fixes It)',
    subtitle: "Most memory systems aren't memory systems at all. They're buckets. Here's why that breaks in production — and what a physics-based approach changes.",
    tags: ['Competitive Analysis', 'Architecture', 'MemBench'],
  },
  {
    slug: 'thermodynamic-memory',
    title: 'Thermodynamic Memory: Why Your Agent\'s Brain Needs Physics',
    subtitle: "Most AI memory systems are glorified databases. SULCUS treats memories as thermodynamic objects with heat, decay, resonance, and consolidation.",
    tags: ['Architecture', 'Thermodynamics', 'Deep Dive'],
  },
  {
    slug: 'deep-agents',
    title: 'Deep Agents: The Harness That Forgot to Remember',
    subtitle: "LangChain's Deep Agents SDK ships with planning, filesystems, and subagents. Memory is an afterthought.",
    tags: ['LangChain', 'Deep Agents', 'Integration'],
  },
  {
    slug: 'crewai',
    title: "CrewAI's Memory: Four Types, One Assumption",
    subtitle: "CrewAI ships the most sophisticated memory in the agent space. It's still not enough.",
    tags: ['CrewAI', 'Integration'],
  },
];

export default function ArticlesIndex() {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] font-mono">
      <div className="max-w-3xl mx-auto px-6">
        <SiteNav />

        <div className="py-16 font-sans">
        <div className="flex items-center gap-3 mb-2">
          <TbFlame className="text-[#D4AF37]" size={24} />
          <h1 className="text-3xl font-bold tracking-tight">Articles</h1>
        </div>
        <p className="text-sm text-[#888] mb-10">
          Sharp analysis of agent memory — what works, what doesn&apos;t, and where thermodynamics changes the equation.
        </p>

        <div className="space-y-4">
          {ARTICLES.map((a) => (
            <Link
              key={a.slug}
              href={`/articles/${a.slug}`}
              className="block bg-[#0a1520] border border-[#D4AF37]/10 hover:border-[#D4AF37]/30 rounded-lg p-6 transition-colors"
            >
              <h2 className="text-lg font-bold text-[#ededed] mb-1">{a.title}</h2>
              <p className="text-sm text-[#888] mb-3">{a.subtitle}</p>
              <div className="flex gap-2">
                {a.tags.map((t) => (
                  <span key={t} className="text-[10px] bg-[#D4AF37]/10 text-[#D4AF37] px-2 py-0.5 rounded border border-[#D4AF37]/20">
                    {t}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>

        <p className="text-xs text-[#555] mt-10">
          More articles coming — Vercel AI SDK, AutoGen, LlamaIndex, OpenAI Assistants.
        </p>
        </div>
      </div>
    </div>
  );
}
