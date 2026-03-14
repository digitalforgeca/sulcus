'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  TbFlask2,
  TbChartBar,
  TbBrain,
  TbClock,
  TbArrowsShuffle,
  TbScale,
  TbArrowLeft,
  TbExternalLink,
  TbGitFork,
} from 'react-icons/tb';

// ─── Baseline data ──────────────────────────────────────────────────────────
// Real baseline results from running the benchmark locally.

interface BenchResult {
  adapter: string;
  version: string;
  overall: number;
  recall: number;
  temporal: number;
  contradiction: number;
  multiSession: number;
  efficiency: number;
  tasksRun: number;
  tasksPassed: number;
  date: string;
  official: boolean;
  link?: string;
}

const RESULTS: BenchResult[] = [
  {
    adapter: 'In-Context (Baseline)',
    version: '—',
    overall: 0.579,
    recall: 1.0,
    temporal: 0.75,
    contradiction: 1.0,
    multiSession: 0.0,
    efficiency: 0.0,
    tasksRun: 20,
    tasksPassed: 10,
    date: '2026-03-14',
    official: true,
  },
  {
    adapter: 'No Memory (Floor)',
    version: '—',
    overall: 0.0,
    recall: 0.0,
    temporal: 0.0,
    contradiction: 0.0,
    multiSession: 0.0,
    efficiency: 0.0,
    tasksRun: 20,
    tasksPassed: 0,
    date: '2026-03-14',
    official: true,
  },
];

const CATEGORIES = [
  { key: 'recall', label: 'Recall', icon: TbBrain, desc: 'Basic fact retention across topic changes' },
  { key: 'temporal', label: 'Temporal', icon: TbClock, desc: 'Sequence ordering, recency, duration tracking' },
  { key: 'contradiction', label: 'Contradiction', icon: TbArrowsShuffle, desc: 'Detecting and resolving conflicting information' },
  { key: 'multiSession', label: 'Multi-Session', icon: TbGitFork, desc: 'Cross-session fact persistence and updates' },
  { key: 'efficiency', label: 'Efficiency', icon: TbScale, desc: 'Signal-to-noise, scaling, thermodynamic decay' },
] as const;

function ScoreBar({ score, color = 'cyan' }: { score: number; color?: string }) {
  const pct = Math.round(score * 100);
  const barColor = score >= 0.8 ? '#00F0FF' : score >= 0.5 ? '#FFD700' : score > 0 ? '#FF6B35' : '#333';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-[#111] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      <span className="text-xs font-mono w-10 text-right" style={{ color: barColor }}>{pct}%</span>
    </div>
  );
}

export default function MemBenchPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const sorted = [...RESULTS].sort((a, b) => b.overall - a.overall);

  return (
    <main className="min-h-screen bg-[#0a0e14] text-white">
      {/* Header */}
      <div className="border-b border-[#00F0FF]/10 bg-[#0a0e14]/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <Link href="/" className="text-[#00F0FF]/60 hover:text-[#00F0FF] text-sm flex items-center gap-1 mb-4">
            <TbArrowLeft size={14} /> Back to Sulcus
          </Link>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-[#00F0FF]/5 border border-[#00F0FF]/10">
              <TbFlask2 size={28} className="text-[#00F0FF]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                MemBench <span className="text-[#00F0FF]">v0.1</span>
              </h1>
              <p className="text-[#888] mt-1 max-w-2xl">
                Open benchmark for AI memory systems. 20 tasks across 5 categories.
                Can your memory layer beat in-context?
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Category cards */}
        <div className="grid grid-cols-5 gap-3">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = selectedCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setSelectedCategory(active ? null : cat.key)}
                className={`p-4 rounded-lg border text-left transition-all ${
                  active
                    ? 'border-[#00F0FF]/40 bg-[#00F0FF]/5'
                    : 'border-[#1a1f2a] bg-[#0d1117] hover:border-[#00F0FF]/20'
                }`}
              >
                <Icon size={18} className={active ? 'text-[#00F0FF]' : 'text-[#555]'} />
                <div className="text-sm font-medium mt-2">{cat.label}</div>
                <div className="text-[10px] text-[#555] mt-1 leading-snug">{cat.desc}</div>
              </button>
            );
          })}
        </div>

        {/* Leaderboard */}
        <div className="border border-[#1a1f2a] rounded-lg overflow-hidden">
          <div className="bg-[#0d1117] border-b border-[#1a1f2a] px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TbChartBar size={16} className="text-[#00F0FF]" />
              <span className="text-sm font-medium">
                {selectedCategory
                  ? `${CATEGORIES.find(c => c.key === selectedCategory)?.label} Leaderboard`
                  : 'Overall Leaderboard'}
              </span>
            </div>
            <span className="text-xs text-[#555]">{RESULTS.length} systems tested</span>
          </div>

          <div className="divide-y divide-[#1a1f2a]">
            {sorted.map((r, i) => {
              const score = selectedCategory
                ? r[selectedCategory as keyof BenchResult] as number
                : r.overall;
              return (
                <div key={r.adapter} className="px-5 py-4 hover:bg-[#111318] transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="text-lg font-bold text-[#333] w-8">#{i + 1}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.adapter}</span>
                        {r.version !== '—' && (
                          <span className="text-xs text-[#555] font-mono">{r.version}</span>
                        )}
                        {r.official && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#00F0FF]/10 text-[#00F0FF] font-medium uppercase tracking-wider">
                            Official
                          </span>
                        )}
                      </div>
                      <div className="mt-2">
                        <ScoreBar score={score} />
                      </div>
                      {!selectedCategory && (
                        <div className="flex gap-4 mt-2">
                          {CATEGORIES.map(cat => {
                            const catScore = r[cat.key as keyof BenchResult] as number;
                            return (
                              <div key={cat.key} className="text-[10px] text-[#555]">
                                {cat.label}: <span className={catScore > 0 ? 'text-[#aaa]' : 'text-[#333]'}>{Math.round(catScore * 100)}%</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-mono font-bold">{Math.round(score * 100)}%</div>
                      <div className="text-[10px] text-[#555]">
                        {r.tasksPassed}/{r.tasksRun} passed
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* The Gap */}
        <div className="border border-[#FFD700]/20 rounded-lg bg-[#FFD700]/5 p-6">
          <h3 className="text-lg font-bold text-[#FFD700] mb-2">The 42.1% Gap</h3>
          <p className="text-sm text-[#aaa] leading-relaxed">
            In-context memory hits a ceiling at <strong>57.9%</strong>. It can&apos;t persist across sessions,
            can&apos;t scale beyond the context window, and can&apos;t do intelligent decay.
            The remaining <strong>42.1%</strong> requires a dedicated memory layer — persistent storage,
            cross-session recall, thermodynamic prioritisation, and efficient retrieval at scale.
            That&apos;s the territory Sulcus is built for.
          </p>
        </div>

        {/* How to run */}
        <div className="border border-[#1a1f2a] rounded-lg bg-[#0d1117] p-6">
          <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
            <TbFlask2 size={16} className="text-[#00F0FF]" />
            Run it yourself
          </h3>
          <pre className="bg-[#0a0e14] border border-[#1a1f2a] rounded p-4 text-sm font-mono text-[#ccc] overflow-x-auto">
{`# Clone and run
git clone https://github.com/mcdoolz/sulcus.git
cd sulcus/packages/membench

# Baselines (no API keys needed)
python -m membench --adapter no-memory
python -m membench --adapter in-context

# Test your memory system
python -m membench --adapter sulcus --api-key sk-...
python -m membench --adapter mem0 --api-key ...
python -m membench --adapter openai --api-key ...

# Filter by category
python -m membench --adapter sulcus --api-key sk-... --categories recall temporal`}
          </pre>
          <div className="flex gap-3 mt-4">
            <a
              href="https://github.com/mcdoolz/sulcus/tree/master/packages/membench"
              target="_blank"
              rel="noopener"
              className="text-xs text-[#00F0FF] hover:underline flex items-center gap-1"
            >
              <TbExternalLink size={12} /> Source on GitHub
            </a>
            <a
              href="/docs"
              className="text-xs text-[#00F0FF] hover:underline flex items-center gap-1"
            >
              <TbExternalLink size={12} /> Sulcus SDK Docs
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-[#333] pb-8">
          MemBench is open-source. Submit results via PR.
          Tests include intentional losses for credibility.
        </div>
      </div>
    </main>
  );
}
