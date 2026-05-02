'use client';

import Link from 'next/link';
import {
  TbArrowLeft, TbLayoutDashboard, TbDatabase, TbFlame,
  TbClock, TbChartPie, TbTemperature, TbWaveSine,
  TbBrain, TbChartBar, TbHeart, TbActivity,
  TbUsers, TbPin, TbSnowflake,
} from 'react-icons/tb';

function SectionAnchor({ id, icon, title, sub }: {
  id: string; icon: React.ReactNode; title: string; sub?: string;
}) {
  return (
    <div id={id} className="flex items-start gap-3 mb-6 pt-2 scroll-mt-8">
      <div className="mt-0.5 text-[#D4AF37] shrink-0">{icon}</div>
      <div>
        <h2 className="text-xl font-bold text-[#ededed] tracking-tight">{title}</h2>
        {sub && <p className="text-sm text-[#666] mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function Chip({ label, variant = 'cyan' }: { label: string; variant?: 'cyan' | 'gold' | 'muted' }) {
  const s: Record<string, string> = {
    cyan:  'border-[#00F0FF]/30 text-[#00F0FF] bg-[#00F0FF]/5',
    gold:  'border-[#D4AF37]/30 text-[#D4AF37] bg-[#D4AF37]/5',
    muted: 'border-[#333]/50 text-[#666]',
  };
  return (
    <span className={`inline-block border rounded px-2 py-0.5 text-[10px] font-mono ${s[variant]}`}>
      {label}
    </span>
  );
}

export default function DashboardGuidePage() {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed]">
      <div className="max-w-3xl mx-auto px-6 py-16 font-sans">

        {/* Back */}
        <Link href="/docs" className="text-[#00F0FF]/60 hover:text-[#00F0FF] text-sm flex items-center gap-1 mb-8 transition-colors">
          <TbArrowLeft size={14} /> Docs
        </Link>

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <TbLayoutDashboard size={28} className="text-[#D4AF37]" />
            <h1 className="text-3xl font-bold tracking-tight">Dashboard Guide</h1>
          </div>
          <p className="text-[#888] text-base leading-relaxed">
            The Overview dashboard at <code className="text-[#00F0FF]">/dashboard</code> gives
            you a real-time view of your memory graph&apos;s health, performance, and activity.
            Every card tells a story about how your agent&apos;s memory is performing.
          </p>
          <p className="text-xs text-[#555] mt-3 tracking-wider uppercase">
            Sulcus · Dashboard Reference · 2026
          </p>
        </div>
        <div className="border-b border-[#D4AF37]/20 mb-10" />

        {/* TOC */}
        <nav className="mb-12 border border-[#00F0FF]/10 p-5 bg-[#00F0FF]/3 rounded-lg">
          <p className="text-xs text-[#555] uppercase tracking-widest mb-3">On this page</p>
          <ol className="space-y-1.5 text-sm columns-2">
            {([
              ['#top-stats',     'Top-Level Stats'],
              ['#memory-types',  'Memory Types'],
              ['#heat-dist',     'Heat Distribution'],
              ['#summary-cards', 'Summary Cards'],
              ['#graph-health',  'Graph Health'],
              ['#recent',        'Recent Activity'],
            ] as [string, string][]).map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-[#00F0FF]/70 hover:text-[#00F0FF] transition-colors">{label}</a>
              </li>
            ))}
          </ol>
        </nav>


        {/* ── Top-Level Stats ───────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="top-stats" icon={<TbDatabase size={20} />} title="Top-Level Stats"
            sub="The four headline numbers at the top of your dashboard" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbDatabase size={16} className="text-[#00F0FF]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Total Nodes</span>
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The total number of memory nodes in your graph. This includes all types —
                episodic, semantic, procedural, preference, and fact. Pinned and unpinned.
                A growing node count means your agent is building knowledge. A plateau means
                consolidation is keeping pace with creation.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbActivity size={16} className="text-[#00F0FF]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Sync Requests</span>
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The number of API requests processed in the current period. Includes stores,
                recalls, boosts, and other operations. A healthy graph sees a balance of stores
                and recalls — all stores and no recalls means the agent is hoarding without using.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbFlame size={16} className="text-[#D4AF37]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Avg Heat</span>
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The average heat across all memory nodes. A healthy graph typically sits between
                0.30–0.60. If average heat is very high (&gt;0.80), memories aren&apos;t decaying
                properly or too many are pinned. If very low (&lt;0.15), the agent isn&apos;t
                recalling enough to reinforce knowledge.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbClock size={16} className="text-[#D4AF37]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Avg Latency</span>
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The average response time for memory operations in milliseconds. Includes
                store, recall, and search latency. Under 100ms is excellent. Over 500ms may
                indicate the graph is too large for current index settings or the active index
                needs tuning.
              </p>
            </div>
          </div>
        </section>


        {/* ── Memory Types ──────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="memory-types" icon={<TbChartPie size={20} />} title="Memory Types Distribution"
            sub="The breakdown of your graph by memory classification" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              This chart shows how many memories exist per type. The distribution tells you
              about your agent&apos;s memory patterns — heavy on episodic means lots of
              event-logging, heavy on procedural means strong operational knowledge.
            </p>
          </div>

          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
            {([
              ['episodic',   '#ef4444', 'Events, conversations, and moments. Fast-decaying by design. These are the "what happened" memories — session logs, interaction records, timestamped observations.'],
              ['semantic',   '#a855f7', 'Knowledge and concepts. The "what is" memories — definitions, explanations, domain knowledge that an agent learns from conversations or documents.'],
              ['procedural', '#22c55e', 'How-to knowledge and workflows. The "how to do" memories — deployment steps, build processes, troubleshooting guides. Long half-life because operational knowledge should persist.'],
              ['preference', '#D4AF37', 'User opinions and settings. The "what they like" memories — preferred tools, communication style, timezone, coding conventions. Higher floor ensures these stay visible.'],
              ['fact',       '#3b82f6', 'Verified data points. The "what is true" memories — API endpoints, version numbers, configuration values, names, dates. Longest half-life and highest floor because facts should be reliable.'],
            ] as [string, string, string][]).map(([type, color, desc]) => (
              <div key={type} className="p-4 hover:bg-[#00F0FF]/5 transition-colors">
                <div className="flex items-center gap-3 mb-1.5">
                  <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                  <code className="text-[#00F0FF] font-mono text-sm font-bold">{type}</code>
                </div>
                <p className="text-sm text-[#aaa] leading-relaxed pl-6">{desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded">
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              <strong>Healthy distribution:</strong> Most agents should have a mix of all types.
              If 90%+ of your memories are episodic, your agent is logging events but not
              distilling knowledge. Consider adding semantic and procedural memories to capture
              lessons learned from those episodes.
            </p>
          </div>
        </section>


        {/* ── Heat Distribution ─────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="heat-dist" icon={<TbTemperature size={20} />} title="Heat Distribution"
            sub="How your memories are distributed across temperature bands" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              The heat distribution chart groups all memories into five temperature bands.
              This gives you an at-a-glance view of graph vitality — are most memories hot
              and active, or cold and fading?
            </p>
          </div>

          <div className="overflow-x-auto mb-6">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D4AF37]/20">
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Band</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Heat Range</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Color</th>
                  <th className="text-left py-3 text-[#888] font-semibold uppercase tracking-wider">Meaning</th>
                </tr>
              </thead>
              <tbody className="text-[#aaa]">
                {([
                  ['Blazing', '0.80 – 1.00', '🔴 Red',    'Recently created or heavily recalled. These memories are at the top of the active index and guaranteed to be in context.'],
                  ['Hot',     '0.50 – 0.79', '🟠 Orange', 'Active and healthy. Being recalled periodically or recently created. Well within the active index.'],
                  ['Warm',    '0.25 – 0.49', '🟡 Yellow', 'Cooling but still visible. May appear in the active index depending on max nodes setting. Should be recalled soon if important.'],
                  ['Cool',    '0.10 – 0.24', '🔵 Blue',   'Approaching the cold threshold. Unlikely to be in the active index unless max nodes is very high. At risk of consolidation.'],
                  ['Frozen',  '0.00 – 0.09', '⚪ Gray',   'Below or near the cold threshold. Consolidation candidates. Only the floor (min_heat) keeps them from reaching absolute zero.'],
                ] as [string, string, string, string][]).map(([band, range, color, desc]) => (
                  <tr key={band} className="border-b border-[#1a2a3a]">
                    <td className="py-2.5 pr-4 font-mono text-[#00F0FF] font-bold">{band}</td>
                    <td className="py-2.5 pr-4 font-mono text-[#D4AF37]">{range}</td>
                    <td className="py-2.5 pr-4 text-[#888]">{color}</td>
                    <td className="py-2.5">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded">
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              <strong>What to look for:</strong> A healthy graph has a natural bell curve —
              some blazing (recent), most warm/hot (active knowledge), some cool/frozen
              (old/unused). If everything is frozen, the agent isn&apos;t recalling. If everything
              is blazing, decay may be too slow or too many memories are pinned.
            </p>
          </div>
        </section>


        {/* ── Summary Cards ─────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="summary-cards" icon={<TbChartBar size={20} />} title="Summary Cards"
            sub="Quick-reference cards for each engine subsystem" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              Below the main charts, four summary cards show the current configuration and
              status of each thermodynamic subsystem. These mirror the settings at{' '}
              <code className="text-[#00F0FF]">/dashboard/account</code> — clickable shortcuts
              to the full configuration panel.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbClock size={16} className="text-[#00F0FF]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Tick Mode</span>
                <Chip label="engine status" variant="cyan" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Shows whether the decay tick is active or paused. When active, the engine
                runs decay calculations on a regular interval. Pausing the tick freezes all
                heat values — useful during migrations or debugging.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbWaveSine size={16} className="text-[#D4AF37]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Resonance</span>
                <Chip label="heat propagation" variant="gold" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Summarizes current resonance settings: spread factor, damping, depth, and
                thermal gate. Shows whether resonance is enabled and the effective propagation
                radius of each recall event.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbBrain size={16} className="text-[#00F0FF]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Active Index</span>
                <Chip label="context window" variant="cyan" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Shows max nodes and context budget, plus the current utilization — how many
                nodes are actually being injected and what percentage of the character budget
                is used. If utilization is consistently at 100%, consider increasing the limits.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbChartBar size={16} className="text-[#D4AF37]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Recall Quality</span>
                <Chip label="30-day accuracy" variant="gold" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Shows the aggregate recall accuracy over the last 30 days. Breaks down by
                memory type so you can identify which types are surfacing well and which need
                tuning. See the{' '}
                <Link href="/docs/thermodynamic-engine#recall-quality" className="text-[#00F0FF] hover:underline">
                  Thermodynamic Engine guide
                </Link>{' '}
                for tuning advice.
              </p>
            </div>
          </div>
        </section>


        {/* ── Graph Health ──────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="graph-health" icon={<TbHeart size={20} />} title="Graph Health"
            sub="The vital signs of your memory graph" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              The Graph Health panel provides a deeper diagnostic view of your memory graph&apos;s
              condition. These metrics help you identify imbalances and optimize performance.
            </p>
          </div>

          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
            {([
              [<TbPin size={16} key="pin" />,       'Pinned Memories',  'Count of permanently pinned memories that are exempt from decay. High pin counts mean more memory is always in context — good for critical knowledge, bad for context budget if overdone.'],
              [<TbFlame size={16} key="avg" />,      'Avg Heat',        'The mean heat across all nodes — same as the top-level stat but shown here with historical trend. A declining average suggests the agent isn\'t recalling enough.'],
              [<TbTemperature size={16} key="hot" />, 'Hottest Memory', 'The single hottest node in the graph, with its label and heat score. Useful for spotting runaway heat — a memory that\'s being recalled too frequently or has excessive stability.'],
              [<TbSnowflake size={16} key="cold" />,  'Coldest Memory', 'The coldest non-floor node. If this memory is important, it needs recall or pinning before consolidation claims it.'],
              [<TbUsers size={16} key="agents" />,    'Active Agents',  'The number of distinct agent namespaces writing to this graph. Multi-agent setups show all contributors — useful for understanding which agents are most active.'],
            ] as [React.ReactNode, string, string][]).map(([icon, title, desc]) => (
              <div key={title} className="p-4 hover:bg-[#00F0FF]/5 transition-colors">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[#D4AF37]">{icon}</span>
                  <span className="text-sm font-bold text-[#ededed]">{title}</span>
                </div>
                <p className="text-sm text-[#aaa] leading-relaxed pl-6">{desc}</p>
              </div>
            ))}
          </div>
        </section>


        {/* ── Recent Activity ───────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="recent" icon={<TbActivity size={20} />} title="Recent Activity"
            sub="A live feed of the latest memory operations" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              The Recent Activity feed shows the last memory operations in chronological order.
              Each entry shows the operation type (store, recall, boost, relate, decay tick),
              the memory label, namespace, heat change, and timestamp.
            </p>
            <p>
              Use this feed to understand your agent&apos;s behavior in real time. If you see
              rapid-fire stores without any recalls, the agent is writing but not reading. If
              you see frequent boosts on the same memory, it&apos;s being heavily relied upon and
              the stability multiplier is climbing.
            </p>
          </div>

          <div className="border border-[#00F0FF]/10 p-4">
            <div className="space-y-3">
              {([
                ['store',  '09:56:32', 'User prefers dark mode',     'preference', '+1.00'],
                ['recall', '09:50:10', 'Deploy procedure: staging',  'procedural', '+0.15'],
                ['boost',  '09:50:03', 'Architecture: event-driven', 'semantic',   '+0.10'],
                ['decay',  '09:45:00', 'Tick completed',             '—',          '−0.02 avg'],
                ['relate', '09:42:18', 'API keys → Deploy procedure','—',          'edge created'],
              ] as [string, string, string, string, string][]).map(([op, time, label, type, delta], i) => (
                <div key={i} className="flex items-center gap-3 text-xs">
                  <span className="font-mono text-[#555] w-16 shrink-0">{time}</span>
                  <span className={`font-mono w-12 shrink-0 ${
                    op === 'store' ? 'text-green-400' :
                    op === 'recall' ? 'text-blue-400' :
                    op === 'boost' ? 'text-[#D4AF37]' :
                    op === 'decay' ? 'text-[#888]' :
                    'text-purple-400'
                  }`}>{op}</span>
                  <span className="text-[#ccc] flex-1 truncate">{label}</span>
                  <span className="text-[#555] font-mono">{type}</span>
                  <span className="text-[#00F0FF] font-mono w-20 text-right shrink-0">{delta}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[#444] mt-3 italic">Example activity feed — your dashboard shows live data</p>
          </div>
        </section>


        {/* ── Footer CTA ────────────────────────────────────────────── */}
        <div className="border-t border-[#D4AF37]/20 mt-12 pt-10">
          <h2 className="text-xl font-bold text-[#ededed] mb-3">Your graph at a glance.</h2>
          <p className="text-[#888] text-sm leading-relaxed mb-6">
            The dashboard is your window into how memory is performing. Check it periodically
            to ensure your agents are building and recalling knowledge effectively.
          </p>
          <div className="flex flex-col md:flex-row gap-4">
            <a href="https://sulcus.ca/dashboard" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Open Dashboard &rarr;
            </a>
            <Link href="/docs/thermodynamic-engine" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Thermodynamic Engine &rarr;
            </Link>
            <Link href="/docs/memory-graph" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Memory Graph &rarr;
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
