'use client';

import Link from 'next/link';
import {
  TbArrowLeft, TbFlame, TbTemperature, TbWaveSine,
  TbTrash, TbBrain, TbChartBar, TbArrowsExchange,
  TbClock, TbShieldCheck, TbMathFunction,
} from 'react-icons/tb';

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="relative">
      <pre className="bg-[#0a1419] rounded-lg p-4 text-sm font-mono overflow-x-auto text-[#00F0FF] leading-relaxed">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-3 text-[10px] text-[#2a4a5a] uppercase tracking-widest select-none">
        {lang}
      </div>
    </div>
  );
}

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

function Chip({ label, variant = 'cyan' }: { label: string; variant?: 'cyan' | 'gold' | 'muted' | 'purple' }) {
  const s: Record<string, string> = {
    cyan:   'border-[#00F0FF]/30 text-[#00F0FF] bg-[#00F0FF]/5',
    gold:   'border-[#D4AF37]/30 text-[#D4AF37] bg-[#D4AF37]/5',
    muted:  'border-[#333]/50 text-[#666]',
    purple: 'border-[#a855f7]/30 text-[#a855f7] bg-[#a855f7]/5',
  };
  return (
    <span className={`inline-block border rounded px-2 py-0.5 text-[10px] font-mono ${s[variant]}`}>
      {label}
    </span>
  );
}

const DECAY_FORMULA = `H(t) = H₀ × base_utility × 2^(-Δt / (half_life × stability))

Where:
  H(t)         = heat at time t
  H₀           = initial heat (1.0 on creation)
  base_utility = SIVU-scored utility (0–1); shapes effective starting heat
  Δt           = elapsed time since last update
  half_life    = base half-life for the memory type (type-specific)
  stability    = cumulative multiplier from recalls (starts at 1.0)

Background worker ticks every 300 seconds to apply decay.
Recall-boost fires immediately on search hit — no tick delay.

Example — a fact (half_life=12mo), base_utility=0.9, stability=2.5 after one recall:
  Effective half-life = 12 × 2.5 = 30 months
  After 12 months: H = 1.0 × 0.9 × 2^(-12/30) ≈ 0.68  (still hot!)`;

const LIFECYCLE_FLOW = `1. STORE    → Memory created at heat 1.0
                ↓
2. DECAY    → Tick runs: H(t) = H₀ × 2^(-Δt / (half_life × stability))
                ↓              Heat drops toward floor (min_heat)
3. RECALL   → Agent searches → memory found
                ↓              stability *= Stab+ multiplier
                ↓              Heat bumped, effective half-life extended
4. RESONATE → Heat spreads to neighbors
                ↓              spread_factor × heat → neighbors
                ↓              damping per hop, depth limit
5. REPEAT   → Steps 2-4 cycle continuously
                ↓
6. COLD     → Heat drops below cold_threshold (0.10)
                ↓              Memory becomes consolidation candidate
7. SWEEP    → cold_count ≥ trigger (20)
                ↓              Coldest memories archived/merged
8. FLOOR    → Heat never drops below min_heat
                               Memory persists at minimum visibility`;

export default function ThermodynamicEngineClient() {
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
            <TbTemperature size={28} className="text-[#D4AF37]" />
            <h1 className="text-3xl font-bold tracking-tight">Thermodynamic Engine</h1>
          </div>
          <p className="text-[#888] text-base leading-relaxed">
            The Thermodynamic Engine is the core of Sulcus — it governs how memories
            gain heat, lose heat, spread warmth to neighbors, and eventually cool into
            consolidation. Heat is influenced by <code className="text-[#00F0FF]">base_utility</code>{' '}
            (scored by SIVU on every store), type-specific half-lives, and recall-boost stability.
            The background worker ticks every 300 seconds. Every parameter is tunable from the
            settings panel at <code className="text-[#00F0FF]">/dashboard/account</code>.
          </p>
          <p className="text-xs text-[#555] mt-3 tracking-wider uppercase">
            Sulcus v2.2.1 · Thermodynamic Engine Reference · 2026
          </p>
        </div>
        <div className="border-b border-[#D4AF37]/20 mb-10" />

        {/* TOC */}
        <nav className="mb-12 border border-[#00F0FF]/10 p-5 bg-[#00F0FF]/3 rounded-lg">
          <p className="text-xs text-[#555] uppercase tracking-widest mb-3">On this page</p>
          <ol className="space-y-1.5 text-sm columns-2">
            {([
              ['#decay-modes',    'Decay Modes'],
              ['#formula',        'The Decay Formula'],
              ['#decay-profiles', 'Decay Profiles'],
              ['#resonance',      'Resonance'],
              ['#consolidation',  'Consolidation'],
              ['#active-index',   'Active Index'],
              ['#recall-quality', 'Recall Quality'],
              ['#lifecycle',      'How These Work Together'],
            ] as [string, string][]).map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-[#00F0FF]/70 hover:text-[#00F0FF] transition-colors">{label}</a>
              </li>
            ))}
          </ol>
        </nav>


        {/* ── Decay Modes ───────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="decay-modes" icon={<TbArrowsExchange size={20} />} title="Decay Modes"
            sub="Three modes control how heat decreases — choose the one that matches your agent's usage pattern" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              Sulcus v2.2.1 introduces three distinct decay modes. The default — <strong className="text-white">Hybrid</strong> — combines
              time-based cooling with interaction-based reinforcement, producing the most natural memory behaviour.
              Time-only and Interaction-only modes are available for specialized use cases.
            </p>
          </div>

          <div className="space-y-4 mb-6">
            <div className="border border-[#D4AF37]/30 p-5 bg-[#D4AF37]/5">
              <div className="flex items-center gap-3 mb-2">
                <Chip label="Hybrid (default)" variant="gold" />
                <span className="text-[10px] text-[#888] uppercase tracking-wider">Recommended</span>
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed mb-3">
                Heat decays with wall-clock time and is reinforced by interaction. Memories that are frequently accessed stay hot longer;
                memories that are stored but never recalled cool at the standard rate. This mirrors biological memory — use it or lose it.
              </p>
              <pre className="bg-[#0a1419] p-3 text-xs font-mono text-[#00F0FF] leading-relaxed overflow-x-auto">{`H(t) = H₀ × base_utility × 2^(-Δt / (half_life × stability))
stability increases with each access — effectively extending half-life`}</pre>
            </div>

            <div className="border border-[#00F0FF]/20 p-5">
              <div className="flex items-center gap-3 mb-2">
                <Chip label="Time-only" variant="cyan" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Heat decays purely based on elapsed time since the last write. Interactions (recalls, searches) do not affect the decay rate.
                Use this when you want predictable, deterministic memory expiry regardless of access patterns — scheduled pipelines, audit logs,
                time-bounded context windows.
              </p>
            </div>

            <div className="border border-[#a855f7]/20 p-5">
              <div className="flex items-center gap-3 mb-2">
                <Chip label="Interaction-only" variant="purple" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Heat decays based solely on access frequency — not on wall-clock time. A memory that is never accessed will cool toward its floor,
                but a memory accessed regularly stays permanently hot regardless of how old it is. Use this for agents where recency is irrelevant
                and usage frequency is the only relevance signal that matters.
              </p>
            </div>
          </div>

          <div className="border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded">
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              <strong>Configure via settings:</strong> Decay mode is a tenant-level setting available in{' '}
              <code className="text-[#D4AF37]">/dashboard/account</code> under Thermodynamic Engine. All three modes
              respect per-type half-lives, floors, and stability multipliers — the mode determines <em>what drives</em> decay,
              not how the formula is structured.
            </p>
          </div>
        </section>


        {/* ── The Decay Formula ─────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="formula" icon={<TbMathFunction size={20} />} title="The Decay Formula"
            sub="The single equation that governs all memory heat" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              Every memory in Sulcus has a <strong className="text-white">heat</strong> value
              between 0.0 and 1.0. Heat determines visibility — hotter memories surface first
              in recall, appear in the active index, and influence the graph. Cold memories
              fade toward silence.
            </p>
            <p>
              Heat decays continuously using a half-life model. The formula incorporates
              stability — a multiplier that grows each time a memory is recalled, implementing{' '}
              <strong className="text-[#D4AF37]">spaced repetition</strong> at the engine level.
            </p>
          </div>
          <CodeBlock code={DECAY_FORMULA} lang="formula" />
          <div className="mt-4 border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded">
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              <strong>Key insights:</strong> (1) <strong>base_utility</strong> — scored by SIVU
              (Store Intelligence Validator Unit) on every store — shapes the memory&apos;s effective
              starting heat. High-utility memories begin hotter and stay hotter longer.{' '}
              (2) <strong>Stability</strong> is the mechanism behind spaced repetition. Each recall
              multiplies stability by the Stab+ value for that memory type. A fact recalled three
              times with Stab+ of 2.5× has an effective half-life of{' '}
              <code className="text-[#D4AF37]">12 × 2.5³ = 187.5 months</code> — it will
              effectively never decay. This is how Sulcus makes frequently-used knowledge permanent
              without manual pinning.
            </p>
          </div>
        </section>


        {/* ── Decay Profiles ────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="decay-profiles" icon={<TbFlame size={20} />} title="Decay Profiles"
            sub="Each memory type decays at its own rate — ephemeral events vanish quickly, core facts persist" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              Not all memories are equal. An episodic memory of a conversation should fade
              within days unless reinforced. A factual record should persist for a year or more.
              Decay profiles let you control this per memory type.
            </p>
          </div>

          <div className="overflow-x-auto mb-6">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D4AF37]/20">
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Type</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Half-Life</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Floor</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Stab+</th>
                  <th className="text-left py-3 text-[#888] font-semibold uppercase tracking-wider">Behaviour</th>
                </tr>
              </thead>
              <tbody className="text-[#aaa]">
                {([
                  ['episodic',    '24 hours',  '0.01', '1.5×', 'Fastest decay. Conversations, events, and moments fade within a day unless recalled. base_utility shapes their initial heat. Recall extends half-life by 1.5× each time.'],
                  ['semantic',    '30 days',   '0.05', '2.0×', 'Moderate decay. Knowledge and concepts persist for weeks. Two recalls double the effective half-life.'],
                  ['preference',  '90 days',   '0.10', '1.8×', 'Medium decay with a higher floor. User preferences stay visible longer even when not recalled — the floor of 0.10 ensures they never fully vanish.'],
                  ['fact',        '365 days',  '0.15', '2.5×', 'Near-permanent. Facts have the longest half-life, the highest floor, and the strongest stability multiplier. Recalling a fact even once extends its half-life to 30 months.'],
                  ['procedural',  '180 days',  '0.05', '2.0×', 'Slowest category after fact. How-to knowledge and workflows are sticky. Decays slowly — meant to last through long project lifecycles. Safeguarded against cold-sweep to protect runbooks.'],
                ] as [string, string, string, string, string][]).map(([type, hl, floor, stab, desc]) => (
                  <tr key={type} className="border-b border-[#1a2a3a]">
                    <td className="py-2.5 pr-4 font-mono text-[#00F0FF] font-bold">{type}</td>
                    <td className="py-2.5 pr-4 text-[#D4AF37]">{hl}</td>
                    <td className="py-2.5 pr-4 font-mono text-[#666]">{floor}</td>
                    <td className="py-2.5 pr-4 font-mono text-[#D4AF37]">{stab}</td>
                    <td className="py-2.5 text-[#aaa]">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-4">
            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbClock size={16} className="text-[#00F0FF]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Half-Life</span>
                <Chip label="time to 50% heat" variant="cyan" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The time it takes for a memory&apos;s heat to drop to 50% of its current value.
                Shorter half-lives mean faster forgetting. This is the base rate before stability
                modifies it — the <em>effective</em> half-life is{' '}
                <code className="text-[#00F0FF] text-xs">half_life × stability</code>.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbShieldCheck size={16} className="text-[#D4AF37]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Floor (min_heat)</span>
                <Chip label="decay minimum" variant="gold" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The minimum heat a memory can decay to. Heat will never drop below this value,
                even after years of no interaction. Facts have a floor of 0.15 — they always
                retain some visibility. Episodic memories floor at 0.01 — nearly invisible,
                but technically still in the graph.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbArrowsExchange size={16} className="text-[#D4AF37]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Stability (Stab+)</span>
                <Chip label="spaced repetition" variant="gold" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The multiplier applied to a memory&apos;s stability score on each recall.{' '}
                <strong className="text-white">This is spaced repetition.</strong> A fact with
                Stab+ of 2.5× recalled once has its effective half-life extended from 12 months
                to 30 months. Recalled twice: 75 months. The more your agent uses a memory,
                the longer it persists — automatically, with no configuration required.
              </p>
            </div>
          </div>
        </section>


        {/* ── Resonance ─────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="resonance" icon={<TbWaveSine size={20} />} title="Resonance"
            sub="How heat spreads through the graph when a memory is recalled" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              When a memory is recalled, its heat doesn&apos;t just stay local. Resonance
              causes heat to bleed outward through the graph edges — warming related
              memories, strengthening clusters, and keeping entire knowledge neighborhoods alive.
            </p>
            <p>
              This is how Sulcus implements <strong className="text-[#D4AF37]">associative memory</strong>.
              Recalling &quot;deployment procedure&quot; warms &quot;Docker configuration&quot; and &quot;Azure credentials&quot;
              if they&apos;re linked — because related knowledge should surface together.
            </p>
          </div>

          <div className="overflow-x-auto mb-6">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D4AF37]/20">
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Parameter</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Default</th>
                  <th className="text-left py-3 text-[#888] font-semibold uppercase tracking-wider">Description</th>
                </tr>
              </thead>
              <tbody className="text-[#aaa]">
                {([
                  ['Spread Factor', '0.30', '30% of the recalled memory\'s heat bleeds to each directly-connected neighbor. At heat 0.80, each neighbor receives 0.24 heat units.'],
                  ['Damping',       '0.50', 'Each hop reduces the spread by 50%. First hop gets full spread, second hop gets half, and so on. Prevents heat from flooding the entire graph.'],
                  ['Depth',         '2 hops','How far heat propagates from the recalled memory. At depth 2, neighbors-of-neighbors are warmed. Deeper values create wider activation but risk noise.'],
                  ['Thermal Gate',  '0.05', 'Memories below this heat threshold don\'t participate in resonance — they don\'t receive or propagate heat. Prevents cold, forgotten memories from being reanimated by distant echoes.'],
                ] as [string, string, string][]).map(([param, def, desc]) => (
                  <tr key={param} className="border-b border-[#1a2a3a]">
                    <td className="py-2.5 pr-4 font-mono text-[#00F0FF] font-bold whitespace-nowrap">{param}</td>
                    <td className="py-2.5 pr-4 font-mono text-[#D4AF37]">{def}</td>
                    <td className="py-2.5">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded">
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              <strong>Tuning tip:</strong> If you notice too many irrelevant memories surfacing
              after recall, reduce the spread factor or depth. If related memories aren&apos;t
              staying warm enough, increase the spread factor. The thermal gate is your safety
              valve — raise it to prevent cold memories from participating in resonance chains.
              Resonance fires on recall, not on the 300s tick — it&apos;s immediate.
            </p>
          </div>
        </section>


        {/* ── Consolidation ─────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="consolidation" icon={<TbTrash size={20} />} title="Consolidation"
            sub="Garbage collection for cold memories — keeping the graph lean" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              Memories that cool below a threshold become candidates for consolidation.
              When enough cold memories accumulate, the engine runs a sweep — archiving,
              merging, or removing the coldest entries to keep the active graph performant.
            </p>
            <p>
              This is not deletion. Consolidated memories can be recovered. Think of it as
              moving boxes to the attic — they&apos;re still there, just not on the kitchen table.
            </p>
          </div>

          <div className="space-y-4">
            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbTemperature size={16} className="text-[#00F0FF]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Cold Threshold</span>
                <Chip label="default: 0.10" variant="cyan" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Memories with heat below this value are flagged as cold candidates. They
                won&apos;t be immediately removed — they accumulate until the count trigger fires.
                Lower this value to be more lenient with cooling memories; raise it to be more aggressive.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbChartBar size={16} className="text-[#D4AF37]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Cold Count Trigger</span>
                <Chip label="default: 20" variant="gold" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The consolidation sweep runs when this many cold memories have accumulated.
                At the default of 20, the engine waits until 20 memories are below the cold
                threshold before sweeping. This batching prevents constant garbage collection
                on every tick.
              </p>
            </div>
          </div>
        </section>


        {/* ── Active Index ──────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="active-index" icon={<TbBrain size={20} />} title="Active Index"
            sub="What the LLM actually sees — the context window into your memory graph" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              The active index is the subset of your memory graph that gets injected into
              the LLM&apos;s system prompt. Not every memory can fit — models have finite context
              windows. These parameters control the boundary.
            </p>
          </div>

          <div className="space-y-4">
            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbBrain size={16} className="text-[#00F0FF]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Max Nodes</span>
                <Chip label="default: 200" variant="cyan" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The maximum number of memory nodes included in the active index. The hottest
                200 memories (by heat score) are selected. If you have 1,000 memories, the
                top 200 make it into context. Increase this for agents that need broader recall;
                decrease it for precision or when using models with smaller context windows.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbChartBar size={16} className="text-[#D4AF37]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Context Budget</span>
                <Chip label="default: 50,000 chars" variant="gold" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The character limit for the injected context block. Even if 200 nodes are selected,
                only as many as fit within 50,000 characters are included. Longer memories consume
                more budget. This is a hard cap — the engine serializes memories from hottest to
                coldest and stops when the budget is exhausted.
              </p>
            </div>
          </div>

          <div className="mt-4 border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded">
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              <strong>Balance matters:</strong> More nodes means broader context but diluted attention.
              A context budget of 50k characters is roughly 12,000–15,000 tokens depending on the
              model. For sharper, more focused recall, reduce max nodes first — it&apos;s more predictable
              than character limits since memory sizes vary.
            </p>
          </div>
        </section>


        {/* ── Recall Quality ────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="recall-quality" icon={<TbChartBar size={20} />} title="Recall Quality"
            sub="30-day performance metrics — how well your memory graph is serving your agents" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              The Recall Quality panel shows accuracy metrics per memory type over the last
              30 days. It tracks how often recalled memories were marked as relevant
              (via feedback) versus irrelevant — giving you a signal on whether your
              thermodynamic parameters are tuned correctly.
            </p>
          </div>

          <div className="space-y-4">
            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Accuracy Per Type</span>
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Each memory type shows its recall accuracy as a percentage. High accuracy
                means the right memories are surfacing. Low accuracy for a specific type means
                either too many irrelevant memories of that type are hot, or the type&apos;s
                half-life is too long and stale memories are lingering.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Tuning Suggestions</span>
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The panel may surface suggestions based on patterns: &quot;Episodic recall accuracy
                is 45% — consider reducing episodic half-life&quot; or &quot;Fact recall is 98% — current
                settings are optimal.&quot; These are heuristics, not commands. Use them as starting
                points for investigation.
              </p>
            </div>
          </div>
        </section>


        {/* ── How These Work Together ───────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="lifecycle" icon={<TbArrowsExchange size={20} />}
            title="How These Work Together"
            sub="The full lifecycle of a memory — from creation to consolidation" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              The thermodynamic engine isn&apos;t a collection of independent features — it&apos;s a
              single system where every parameter influences the others. Here&apos;s how a memory
              moves through its entire lifecycle:
            </p>
          </div>

          <CodeBlock code={LIFECYCLE_FLOW} lang="lifecycle" />

          <div className="mt-6 space-y-4">
            <div className="border border-[#00F0FF]/10 p-4">
              <h3 className="text-sm font-bold text-[#ededed] mb-2">Creation → Decay</h3>
              <p className="text-sm text-[#aaa] leading-relaxed">
                A new memory enters at heat 1.0. Immediately, the decay clock starts. The
                half-life for its type determines how quickly heat drops. An episodic memory
                is at 0.50 after one day. A fact is still at 0.94 after a month.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <h3 className="text-sm font-bold text-[#ededed] mb-2">Recall → Stability</h3>
              <p className="text-sm text-[#aaa] leading-relaxed">
                When the agent recalls a memory, two things happen: the memory&apos;s heat is bumped,
                and its stability multiplier increases by the Stab+ value. This extends the
                effective half-life. Frequently recalled memories become effectively permanent —
                exactly like human spaced repetition.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <h3 className="text-sm font-bold text-[#ededed] mb-2">Recall → Resonance</h3>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Simultaneously, resonance spreads heat outward. The recalled memory&apos;s neighbors
                receive a fraction of its heat (spread factor), damped by distance (damping per hop),
                up to the configured depth. The thermal gate prevents cold memories from participating.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <h3 className="text-sm font-bold text-[#ededed] mb-2">Cooling → Consolidation</h3>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Memories that aren&apos;t recalled decay toward their floor. When enough memories
                fall below the cold threshold, consolidation sweeps. The floor guarantees that
                even the coldest memories retain a minimum presence — facts at 0.15, preferences
                at 0.10. Nothing truly disappears unless explicitly deleted.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <h3 className="text-sm font-bold text-[#ededed] mb-2">Active Index → Context</h3>
              <p className="text-sm text-[#aaa] leading-relaxed">
                The active index selects the hottest memories (up to max nodes / context budget)
                and injects them into the LLM&apos;s system prompt. The result: your agent always
                has the most relevant, most recently reinforced knowledge available — without
                any manual curation.
              </p>
            </div>
          </div>
        </section>


        {/* ── Footer CTA ────────────────────────────────────────────── */}
        <div className="border-t border-[#D4AF37]/20 mt-12 pt-10">
          <h2 className="text-xl font-bold text-[#ededed] mb-3">Memory that governs itself.</h2>
          <p className="text-[#888] text-sm leading-relaxed mb-6">
            The Thermodynamic Engine runs continuously — decaying, reinforcing, resonating,
            and consolidating your agent&apos;s knowledge without any intervention. Tune the
            parameters to match your use case, or leave the defaults and let physics do the work.
          </p>
          <div className="flex flex-col md:flex-row gap-4">
            <a href="https://sulcus.ca/dashboard/account" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Open Settings &rarr;
            </a>
            <Link href="/docs" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Back to Docs &rarr;
            </Link>
            <Link href="/docs/dashboard" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Dashboard Guide &rarr;
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}