'use client';

import Link from 'next/link';
import {
  TbArrowLeft, TbTopologyRing, TbZoomIn, TbZoomOut,
  TbHandGrab, TbClick, TbFilter, TbPlus, TbTrash,
  TbFlame, TbEdit, TbPin, TbSearch,
  TbCircleFilled, TbLine, TbEye,
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

function Chip({ label, variant = 'cyan' }: { label: string; variant?: 'cyan' | 'gold' | 'muted' | 'red' | 'green' | 'purple' | 'blue' }) {
  const s: Record<string, string> = {
    cyan:   'border-[#00F0FF]/30 text-[#00F0FF] bg-[#00F0FF]/5',
    gold:   'border-[#D4AF37]/30 text-[#D4AF37] bg-[#D4AF37]/5',
    muted:  'border-[#333]/50 text-[#666]',
    red:    'border-[#FF6B6B]/30 text-[#FF6B6B] bg-[#FF6B6B]/5',
    green:  'border-[#00D68F]/30 text-[#00D68F] bg-[#00D68F]/5',
    purple: 'border-[#9B59B6]/30 text-[#9B59B6] bg-[#9B59B6]/5',
    blue:   'border-[#3498DB]/30 text-[#3498DB] bg-[#3498DB]/5',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-widest border rounded ${s[variant] || s.muted}`}>
      {label}
    </span>
  );
}

export default function MemoryGraphClient() {
  return (
    <article className="space-y-10 text-sm leading-relaxed text-[#bbb]">

      {/* Back nav */}
      <Link href="/docs" className="inline-flex items-center gap-1.5 text-xs text-[#555] hover:text-[#D4AF37] transition-colors uppercase tracking-widest">
        <TbArrowLeft size={14} /> Back to Docs
      </Link>

      {/* Hero */}
      <header>
        <h1 className="text-3xl font-bold text-[#ededed] tracking-tight leading-none">
          Memory Graph
        </h1>
        <p className="text-[#666] mt-3 max-w-xl">
          Your memory graph visualized. Every node is a memory, every edge is a relationship.
          The graph is alive — heat flows, connections strengthen, cold memories drift to the edges.
        </p>
      </header>

      {/* ── Ring Layout ─────────────────────────────────────── */}
      <section>
        <SectionAnchor
          id="layout"
          icon={<TbTopologyRing size={22} />}
          title="Ring-Based Layout"
          sub="Hottest memories at the center, coldest at the edges."
        />

        <p className="mb-4">
          The graph uses a <strong className="text-[#ededed]">heat-driven ring layout</strong>.
          Memories are arranged in concentric rings based on their current heat value:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-[#0a1419] border border-[#D4AF37]/10 rounded-lg p-4">
            <div className="text-xs text-[#D4AF37] uppercase tracking-widest mb-2">Center Ring</div>
            <div className="text-[#ededed] font-bold mb-1">Heat &gt; 0.7</div>
            <p className="text-[11px] text-[#666]">
              Your most relevant memories. Recently created, frequently recalled,
              or pinned. These are what the LLM sees first.
            </p>
          </div>
          <div className="bg-[#0a1419] border border-[#00F0FF]/10 rounded-lg p-4">
            <div className="text-xs text-[#00F0FF] uppercase tracking-widest mb-2">Middle Rings</div>
            <div className="text-[#ededed] font-bold mb-1">Heat 0.2–0.7</div>
            <p className="text-[11px] text-[#666]">
              Aging but accessible. These memories still have relevance but haven&apos;t
              been recalled recently. A single search will push them back to center.
            </p>
          </div>
          <div className="bg-[#0a1419] border border-[#333]/30 rounded-lg p-4">
            <div className="text-xs text-[#666] uppercase tracking-widest mb-2">Outer Rings</div>
            <div className="text-[#ededed] font-bold mb-1">Heat &lt; 0.2</div>
            <p className="text-[11px] text-[#666]">
              Cold memories approaching consolidation. They won&apos;t appear in
              context unless specifically searched for. Candidates for archival.
            </p>
          </div>
        </div>

        <p className="text-[11px] text-[#555]">
          Node size scales with heat — hotter memories appear larger. This makes it
          immediately visible which memories dominate your graph and which are fading.
        </p>
      </section>

      {/* ── Color Coding ────────────────────────────────────── */}
      <section>
        <SectionAnchor
          id="colors"
          icon={<TbCircleFilled size={22} />}
          title="Color Coding"
          sub="Each memory type has a distinct color for instant recognition."
        />

        <div className="space-y-2 mb-4">
          {[
            { type: 'Preference', color: '#D4AF37', variant: 'gold' as const, desc: 'User preferences, settings, opinions. Gold — these shape agent behavior.' },
            { type: 'Fact', color: '#3498DB', variant: 'blue' as const, desc: 'Knowledge, definitions, data points. Blue — stable, long-lived.' },
            { type: 'Procedural', color: '#00D68F', variant: 'green' as const, desc: 'How-to knowledge, workflows, recipes. Green — skills and processes.' },
            { type: 'Semantic', color: '#9B59B6', variant: 'purple' as const, desc: 'Abstract concepts, relationships, meaning. Purple — deep understanding.' },
            { type: 'Episodic', color: '#FF6B6B', variant: 'red' as const, desc: 'Events, conversations, experiences. Red — time-bound, decays fastest.' },
          ].map(({ type, color, variant, desc }) => (
            <div key={type} className="flex items-center gap-3 bg-[#0a1419] border border-[#1a2a35] rounded p-3">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}40` }} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Chip label={type} variant={variant} />
                </div>
                <p className="text-[11px] text-[#666] mt-1">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-[#555]">
          The legend at the top of the graph shows counts for each type. Click a type in the
          legend to filter the graph to only that memory type.
        </p>
      </section>

      {/* ── Edges ───────────────────────────────────────────── */}
      <section>
        <SectionAnchor
          id="edges"
          icon={<TbLine size={22} />}
          title="Edges &amp; Relationships"
          sub="Lines between nodes represent semantic connections."
        />

        <p className="mb-4">
          Edges connect memories that are related — created together, frequently co-recalled,
          or explicitly linked. The visual encoding:
        </p>

        <div className="bg-[#0a1419] border border-[#D4AF37]/10 rounded-lg p-4 space-y-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-16 h-0.5 bg-[#D4AF37]" />
            <div>
              <span className="text-[#ededed] text-xs font-bold">Strong edge</span>
              <span className="text-[11px] text-[#666] ml-2">High weight — frequently co-recalled or explicitly related</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-16 h-0.5 bg-[#D4AF37]/30" />
            <div>
              <span className="text-[#ededed] text-xs font-bold">Weak edge</span>
              <span className="text-[11px] text-[#666] ml-2">Low weight — tangential connection, may strengthen with use</span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-[#555]">
          Edge opacity maps directly to relationship strength. When resonance fires (a memory
          is recalled), heat flows along these edges — stronger edges carry more heat to neighbors.
          See the <Link href="/docs/thermodynamic-engine#resonance" className="text-[#00F0FF] hover:underline">Resonance</Link> docs.
        </p>
      </section>

      {/* ── Navigation ──────────────────────────────────────── */}
      <section>
        <SectionAnchor
          id="navigation"
          icon={<TbZoomIn size={22} />}
          title="Zoom &amp; Pan"
          sub="Navigate graphs with thousands of nodes."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div className="bg-[#0a1419] border border-[#1a2a35] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <TbZoomIn size={16} className="text-[#00F0FF]" />
              <span className="text-xs text-[#ededed] font-bold uppercase tracking-widest">Zoom</span>
            </div>
            <p className="text-[11px] text-[#666]">
              <strong className="text-[#bbb]">Mouse wheel</strong> zooms toward your cursor position.
              Range: 5% to 500%. The <code className="text-[#00F0FF]">+</code> / <code className="text-[#00F0FF]">−</code> buttons
              in the bottom-right corner also work. <code className="text-[#00F0FF]">RESET</code> returns to 100%.
            </p>
          </div>
          <div className="bg-[#0a1419] border border-[#1a2a35] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <TbHandGrab size={16} className="text-[#00F0FF]" />
              <span className="text-xs text-[#ededed] font-bold uppercase tracking-widest">Pan</span>
            </div>
            <p className="text-[11px] text-[#666]">
              <strong className="text-[#bbb]">Click and drag</strong> the canvas background to pan.
              Useful when zoomed in to navigate between clusters. The graph canvas
              extends infinitely in all directions.
            </p>
          </div>
        </div>

        <p className="text-[11px] text-[#555]">
          Tip: Zoom out to 5–10% to see the full shape of your memory graph. The ring
          layout becomes clearly visible at low zoom — a bright core surrounded by fading rings.
        </p>
      </section>

      {/* ── Click to Inspect ────────────────────────────────── */}
      <section>
        <SectionAnchor
          id="inspect"
          icon={<TbClick size={22} />}
          title="Click to Inspect"
          sub="Select any node to view its full content and metadata."
        />

        <p className="mb-4">
          Click a node in the graph to select it. The <strong className="text-[#ededed]">Node Detail</strong> panel
          appears on the right showing:
        </p>

        <div className="bg-[#0a1419] border border-[#D4AF37]/10 rounded-lg p-4 space-y-2 mb-4">
          {[
            { field: 'Type', desc: 'Memory type (episodic, semantic, preference, procedural, fact)' },
            { field: 'Heat', desc: 'Current heat value with visual bar — shows how relevant the memory is right now' },
            { field: 'Namespace', desc: 'Which agent or source created this memory' },
            { field: 'Summary', desc: 'Full memory content (supports Markdown)' },
            { field: 'Pinned / Locked', desc: 'Pin prevents decay; Lock prevents deletion by agents' },
            { field: 'Updated', desc: 'Last modification timestamp' },
          ].map(({ field, desc }) => (
            <div key={field} className="flex gap-2">
              <span className="text-[#D4AF37] text-xs font-bold w-24 shrink-0">{field}</span>
              <span className="text-[11px] text-[#666]">{desc}</span>
            </div>
          ))}
        </div>

        <p className="mb-3">From the detail panel you can:</p>
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-[#0a1419] border border-[#1a2a35] rounded text-[#bbb]">
            <TbEdit size={12} className="text-[#00F0FF]" /> Edit content
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-[#0a1419] border border-[#1a2a35] rounded text-[#bbb]">
            <TbPin size={12} className="text-[#D4AF37]" /> Pin / Unpin
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-[#0a1419] border border-[#1a2a35] rounded text-[#bbb]">
            <TbFlame size={12} className="text-[#FF6B6B]" /> Adjust heat
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-[#0a1419] border border-[#1a2a35] rounded text-[#bbb]">
            <TbTrash size={12} className="text-[#FF6B6B]" /> Delete
          </span>
        </div>
      </section>

      {/* ── Filters ─────────────────────────────────────────── */}
      <section>
        <SectionAnchor
          id="filters"
          icon={<TbFilter size={22} />}
          title="Filters"
          sub="Narrow the graph to specific memory types or agents."
        />

        <p className="mb-4">
          The filter bar at the top of the graph provides two filter dimensions:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div className="bg-[#0a1419] border border-[#1a2a35] rounded-lg p-4">
            <div className="text-xs text-[#D4AF37] uppercase tracking-widest mb-2">By Type</div>
            <p className="text-[11px] text-[#666]">
              Click the colored type badges (<Chip label="Preference" variant="gold" />,
              {' '}<Chip label="Fact" variant="blue" />, etc.) to toggle visibility.
              Active types show counts. Multiple types can be active simultaneously.
            </p>
          </div>
          <div className="bg-[#0a1419] border border-[#1a2a35] rounded-lg p-4">
            <div className="text-xs text-[#00F0FF] uppercase tracking-widest mb-2">By Source</div>
            <p className="text-[11px] text-[#666]">
              Source badges filter by namespace (agent). If multiple agents share
              a Sulcus graph, you can isolate one agent&apos;s memories while hiding others.
            </p>
          </div>
        </div>
      </section>

      {/* ── Creating Memories ───────────────────────────────── */}
      <section>
        <SectionAnchor
          id="create"
          icon={<TbPlus size={22} />}
          title="Creating Memories"
          sub="Add memories directly from the graph interface."
        />

        <p className="mb-4">
          Click the <strong className="text-[#ededed]">+ Memory</strong> button in the top-right
          corner of the graph view. A modal appears with:
        </p>

        <div className="bg-[#0a1419] border border-[#D4AF37]/10 rounded-lg p-4 space-y-2 mb-4">
          {[
            { field: 'Content', desc: 'The memory text. Supports Markdown for structured notes.' },
            { field: 'Type', desc: 'Select from episodic, semantic, preference, procedural, or fact.' },
            { field: 'Heat', desc: 'Initial heat value (0.0–1.0). Defaults to 0.8. Set to 1.0 for maximum immediate relevance.' },
          ].map(({ field, desc }) => (
            <div key={field} className="flex gap-2">
              <span className="text-[#D4AF37] text-xs font-bold w-20 shrink-0">{field}</span>
              <span className="text-[11px] text-[#666]">{desc}</span>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-[#555]">
          Memories created from the UI enter the graph immediately. They begin decaying
          according to their type&apos;s half-life profile unless pinned. See the{' '}
          <Link href="/docs/thermodynamic-engine" className="text-[#00F0FF] hover:underline">
            Thermodynamic Engine
          </Link> docs for decay behavior.
        </p>
      </section>

      {/* ── Table View ──────────────────────────────────────── */}
      <section>
        <SectionAnchor
          id="table"
          icon={<TbEye size={22} />}
          title="Table View"
          sub="Switch between graph and tabular views."
        />

        <p className="mb-4">
          Toggle between <strong className="text-[#ededed]">Graph</strong> and{' '}
          <strong className="text-[#ededed]">Table</strong> view using the icons in the top-right.
          Table view provides:
        </p>

        <ul className="list-none space-y-1.5 mb-4">
          {[
            'Sortable columns: heat, type, updated date, namespace',
            'Full-text search across all memory content',
            'Filter by type, sort by hottest/coldest/newest',
            'Bulk selection for delete operations',
            'Pagination with configurable page size',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4AF37] mt-0.5">›</span>
              <span className="text-[11px] text-[#888]">{item}</span>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-[#555]">
          Table view is useful for bulk management — finding and cleaning up cold memories,
          reviewing specific types, or auditing what an agent has stored.
        </p>
      </section>

      {/* ── Stats Bar ───────────────────────────────────────── */}
      <section>
        <SectionAnchor
          id="stats"
          icon={<TbSearch size={22} />}
          title="Stats Bar"
          sub="Key metrics displayed above the graph."
        />

        <div className="bg-[#0a1419] border border-[#1a2a35] rounded-lg p-4 space-y-2 mb-4">
          {[
            { metric: 'Nodes', desc: 'Total memory nodes in your graph' },
            { metric: 'Edges', desc: 'Total relationships between memories' },
            { metric: 'Indexed', desc: 'Memories with vector embeddings (searchable via semantic search)' },
          ].map(({ metric, desc }) => (
            <div key={metric} className="flex gap-2">
              <span className="text-[#00F0FF] text-xs font-bold w-16 shrink-0">{metric}</span>
              <span className="text-[11px] text-[#666]">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer nav */}
      <div className="flex justify-between items-center pt-8 border-t border-[#D4AF37]/10">
        <Link href="/docs/dashboard" className="text-xs text-[#555] hover:text-[#D4AF37] transition-colors uppercase tracking-widest">
          ← Dashboard Guide
        </Link>
        <Link href="/docs/local-panel" className="text-xs text-[#555] hover:text-[#D4AF37] transition-colors uppercase tracking-widest">
          Local Panel →
        </Link>
      </div>

    </article>
  );
}
