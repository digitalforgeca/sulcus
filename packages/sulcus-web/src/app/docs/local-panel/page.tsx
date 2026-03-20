'use client';

import Link from 'next/link';
import {
  TbArrowLeft,
  TbLayoutDashboard,
  TbDatabase,
  TbCode,
  TbBolt,
  TbSettings,
  TbServer,
  TbCloud,
  TbTerminal2,
  TbChartBar,
  TbTable,
  TbFilter,
  TbSearch,
  TbPlus,
  TbEdit,
  TbTrash,
  TbToggleLeft,
  TbHistory,
  TbInfoCircle,
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

function SubHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="text-[#00F0FF]">{icon}</div>
      <h3 className="text-sm font-bold text-[#ededed] uppercase tracking-wider">{title}</h3>
    </div>
  );
}

const LAUNCH_CMD = `# Server mode — panel available at http://localhost:4203
sulcus-local serve

# stdio mode (used by OpenClaw plugin) — panel NOT available
sulcus-local stdio`;

const HEAT_REFERENCE = `0.8 – 1.0   hot      bright cyan bar     recently active / pinned
0.5 – 0.79  warm     yellow-green bar    moderately active
0.3 – 0.49  cool     amber bar           fading from context
0.0 – 0.29  cold     red/dim bar         near expiry`;

const HALF_LIVES = `episodic    ~6 hours     Events, conversations — fast fade
semantic    ~7 days      Concepts, relationships — slow fade
procedural  ~30 days     How-tos, runbooks — very slow fade
preference  ~90 days     User settings — near-permanent
fact        ~14 days     Data points — moderate fade`;

const TICK_MODES = `fixed       Decay runs on a fixed wall-clock interval (e.g., every 60 s)
activity    Decay tick fires on memory operations (store / recall / boost)
hybrid      Both: fixed interval + activity trigger, whichever fires first`;

const CONTEXT_PREVIEW = `<sulcus_context>
  <cheatsheet>
    You have Sulcus — persistent memory with reactive triggers.
    STORE: record_memory | FIND: search_memory | RECALL: page_in
    ...
  </cheatsheet>
  <preferences>
    <item id="...">Dooley prefers local builds on M4 — no remote builds.</item>
  </preferences>
  <facts>
    <item id="...">Survival clock: ~150K Azure credits expire April 2026.</item>
  </facts>
  <procedures>
    <item id="...">## Deploy procedure (local build, 2026-03-16) ...</item>
  </procedures>
  <active_triggers>
    <trigger name="auto-pin-preferences" event="on_store" action="pin" fires="4" />
    <trigger name="notify-on-recall" event="on_recall" action="notify" fires="423" />
  </active_triggers>
  <recent_trigger_fires>
    <fire event="on_threshold" action="boost" node="Strategy: icarus" at="2026-03-19T09:56:32Z" />
  </recent_trigger_fires>
</sulcus_context>`;


export default function LocalPanelDocsPage() {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed]">
      <div className="max-w-3xl mx-auto px-6 py-16 font-sans">

        {/* Back */}
        <Link
          href="/docs"
          className="text-[#00F0FF]/60 hover:text-[#00F0FF] text-sm flex items-center gap-1 mb-8 transition-colors"
        >
          <TbArrowLeft size={14} /> Docs
        </Link>

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <TbLayoutDashboard size={28} className="text-[#D4AF37]" />
            <h1 className="text-3xl font-bold tracking-tight">Local Control Panel</h1>
          </div>
          <p className="text-[#888] text-base leading-relaxed">
            When <code className="text-[#00F0FF]">sulcus-local</code> runs in server mode it starts
            a web control panel at{' '}
            <code className="text-[#00F0FF]">http://localhost:4203</code>. The panel gives you a
            real-time view into your local memory graph — browse nodes, inspect context, manage
            triggers, and tune thermodynamic settings — without writing any code.
          </p>
          <p className="text-xs text-[#555] mt-3 tracking-wider uppercase">
            Sulcus · Local Control Panel Reference · 2026
          </p>
        </div>
        <div className="border-b border-[#D4AF37]/20 mb-10" />

        {/* TOC */}
        <nav className="mb-12 border border-[#00F0FF]/10 p-5 bg-[#00F0FF]/3 rounded-lg">
          <p className="text-xs text-[#555] uppercase tracking-widest mb-3">On this page</p>
          <ol className="space-y-1.5 text-sm columns-2">
            {([
              ['#launch',        'Launching the Panel'],
              ['#overview',      'Overview Tab'],
              ['#browse',        'Browse Tab'],
              ['#context',       'Context Tab'],
              ['#triggers',      'Triggers Tab'],
              ['#settings',      'Settings Tab'],
              ['#local-vs-cloud','Local vs Cloud'],
            ] as [string, string][]).map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-[#00F0FF]/70 hover:text-[#00F0FF] transition-colors">
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* ── Launching ───────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor
            id="launch"
            icon={<TbTerminal2 size={20} />}
            title="Launching the Panel"
            sub="The panel is only available in server mode — not stdio mode"
          />
          <p className="text-sm text-[#ccc] leading-relaxed mb-6">
            <code className="text-[#00F0FF]">sulcus-local</code> has two run modes. In{' '}
            <strong className="text-white">server mode</strong> (
            <code className="text-[#00F0FF]">sulcus-local serve</code>), it starts the MCP
            server, the embedded Postgres instance, and the web control panel on port{' '}
            <code className="text-[#00F0FF]">4203</code>. In{' '}
            <strong className="text-white">stdio mode</strong> — used by the OpenClaw plugin —
            it communicates over stdin/stdout only. No HTTP server. No control panel.
          </p>
          <CodeBlock code={LAUNCH_CMD} lang="bash" />
          <div className="mt-4 border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded flex items-start gap-2">
            <TbInfoCircle size={16} className="text-[#D4AF37] mt-0.5 shrink-0" />
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              If you are using the OpenClaw plugin (stdio mode) the panel will not start. Use the
              cloud dashboard at{' '}
              <a
                href="https://sulcus.ca/dashboard"
                className="underline hover:text-white transition-colors"
              >
                sulcus.ca/dashboard
              </a>{' '}
              instead — it has the same five tabs and feature parity with the local panel.
            </p>
          </div>
        </section>

        {/* ── 1. Overview Tab ─────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor
            id="overview"
            icon={<TbChartBar size={20} />}
            title="Overview Tab"
            sub="System-wide health metrics and memory graph at a glance"
          />
          <p className="text-sm text-[#ccc] leading-relaxed mb-8">
            The Overview tab is the landing page. It answers: <em>what is the current state of my
            memory graph?</em> No individual memory details — just the shape and health of the whole
            system.
          </p>

          {/* Stat cards */}
          <div className="mb-8">
            <SubHeading icon={<TbDatabase size={15} />} title="Six Stat Cards" />
            <p className="text-sm text-[#888] mb-4 leading-relaxed">
              Each card refreshes on page load. Together they give a top-level health snapshot.
            </p>
            <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
              {([
                [
                  'Total Nodes',
                  'Count of all memory nodes in the database regardless of heat or type. The raw size of the graph.',
                ],
                [
                  'Edges',
                  'Number of explicit relationships created via memory_relate. A higher edge count means a more interconnected graph with stronger associative links.',
                ],
                [
                  'Avg Heat',
                  'Mean heat across all non-pinned nodes. A falling average means decay is outpacing recall and boost activity. A stable or rising average is healthy.',
                ],
                [
                  'Pinned',
                  'Count of nodes with is_pinned=true. Pinned nodes never decay below min_heat. Watch this: too many pins crowds context; too few risks losing critical procedures.',
                ],
                [
                  'Operations',
                  'Total MCP tool calls processed since the process started (store, recall, boost, relate, etc.). A proxy for overall agent activity in this session.',
                ],
                [
                  'Storage',
                  'Disk used by the embedded Postgres data directory, with a capacity bar. If the bar turns yellow or red, consider pruning cold memories via memory_deprecate.',
                ],
              ] as [string, string][]).map(([name, desc]) => (
                <div key={name} className="px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                  <p className="text-sm font-bold text-[#00F0FF] mb-1">{name}</p>
                  <p className="text-xs text-[#888] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Charts */}
          <div className="mb-8">
            <SubHeading icon={<TbChartBar size={15} />} title="Charts" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {([
                [
                  'Memory Types Distribution',
                  'Breakdown of nodes by type. If episodic dominates, the graph may be noisy. If procedures are absent, the agent may have no how-to knowledge. Use this to spot imbalance and decide what to store more deliberately.',
                ],
                [
                  'Heat Distribution',
                  'Histogram bucketing all nodes by heat range. Healthy graphs tend to be bimodal: a cluster of hot active memories and a tail of cooling episodic noise. A completely flat distribution suggests the decay system may be misconfigured.',
                ],
              ] as [string, string][]).map(([name, desc]) => (
                <div key={name} className="border border-[#00F0FF]/10 p-4">
                  <p className="text-xs font-bold text-[#D4AF37] uppercase tracking-wider mb-2">{name}</p>
                  <p className="text-xs text-[#888] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tables */}
          <div>
            <SubHeading icon={<TbTable size={15} />} title="Memory Tables" />
            <div className="space-y-4">
              <div className="border border-[#00F0FF]/10 p-4">
                <p className="text-xs font-bold text-[#D4AF37] uppercase tracking-wider mb-2">
                  Recent Memories
                </p>
                <p className="text-sm text-[#888] leading-relaxed">
                  The most recently created or updated nodes. Columns: Content (truncated ~60 chars),
                  Type, Namespace, Heat, Updated. Use this to confirm that a just-called{' '}
                  <code className="text-[#00F0FF] text-xs">memory_store</code> landed correctly and
                  what type and heat it was assigned.
                </p>
              </div>
              <div className="border border-[#00F0FF]/10 p-4">
                <p className="text-xs font-bold text-[#D4AF37] uppercase tracking-wider mb-2">
                  Hottest Nodes
                </p>
                <p className="text-sm text-[#888] leading-relaxed">
                  Top nodes ranked by heat descending. Same columns as Recent Memories. These are the
                  memories that will appear first in context — what the agent effectively{' '}
                  &quot;knows&quot; right now. If something important is missing here it may need a
                  boost or a pin.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 2. Browse Tab ───────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor
            id="browse"
            icon={<TbDatabase size={20} />}
            title="Browse Tab"
            sub="Explore, create, search, edit, and delete individual memory nodes"
          />
          <p className="text-sm text-[#ccc] leading-relaxed mb-8">
            The Browse tab is the primary memory management interface. It combines a creation form,
            filter controls, full-text search, and a paginated table with inline editing. Everything
            you can do with MCP tools you can also do here manually.
          </p>

          {/* Create Memory */}
          <div className="mb-8">
            <SubHeading icon={<TbPlus size={15} />} title="Create Memory" />
            <p className="text-sm text-[#888] mb-4 leading-relaxed">
              A collapsible form at the top of the tab. Expand it to add a memory node without
              calling the MCP tool — useful for manually injecting knowledge or testing decay
              configurations.
            </p>
            <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
              {([
                [
                  'Content',
                  'textarea',
                  'The memory text. This is what the agent sees in context. Be concise — long memories consume context budget faster.',
                ],
                [
                  'Memory Type',
                  'dropdown',
                  'episodic · semantic · procedural · preference · fact · moment. Controls the decay half-life. Procedural decays slowest; episodic fastest.',
                ],
                [
                  'Namespace',
                  'text',
                  'Agent identifier (e.g. "icarus"). Namespaces isolate memories between agents sharing the same store. Defaults to the configured plugin namespace.',
                ],
                [
                  'Initial Heat',
                  '0.0 – 1.0',
                  'Starting heat value. New memories typically start at 0.9. Lower values simulate partially-faded older knowledge.',
                ],
                [
                  'Pin',
                  'checkbox',
                  'Sets is_pinned=true immediately on creation. The memory will never decay below min_heat.',
                ],
              ] as [string, string, string][]).map(([field, type, desc]) => (
                <div key={field} className="flex gap-4 px-4 py-3">
                  <div className="w-28 shrink-0">
                    <p className="text-xs font-bold text-[#00F0FF]">{field}</p>
                    <p className="text-[10px] text-[#555] font-mono mt-0.5">{type}</p>
                  </div>
                  <p className="text-xs text-[#888] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="mb-8">
            <SubHeading icon={<TbFilter size={15} />} title="Filters" />
            <p className="text-sm text-[#888] mb-4 leading-relaxed">
              Two rows of pills narrow the table immediately — no submit button needed.
            </p>
            <div className="space-y-3">
              <div className="border border-[#00F0FF]/10 p-4">
                <p className="text-xs font-bold text-[#D4AF37] mb-1">Namespace Pills</p>
                <p className="text-xs text-[#888] leading-relaxed">
                  Auto-detected from the data. One pill per unique namespace in the store. Click to
                  show only that namespace. Select multiple to combine. In single-agent setups this
                  will be a single pill; in shared stores (e.g., icarus + daedalus) it lets you
                  isolate each agent&apos;s memories.
                </p>
              </div>
              <div className="border border-[#00F0FF]/10 p-4">
                <p className="text-xs font-bold text-[#D4AF37] mb-1">Type Pills</p>
                <p className="text-xs text-[#888] leading-relaxed">
                  All · Episodic · Semantic · Procedural · Preference · Fact · Moment. Useful for
                  auditing: &quot;show me all procedures&quot; or &quot;how many preferences exist?&quot;
                  Selecting a type filters the table and updates the count shown above pagination.
                </p>
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="mb-8">
            <SubHeading icon={<TbSearch size={15} />} title="Search" />
            <p className="text-sm text-[#888] leading-relaxed">
              Full-text search across memory content. Results update as you type (debounced ~300 ms).
              This is a lexical substring match — not semantic search. For semantic / vector search
              (finding conceptually related memories), use{' '}
              <code className="text-[#00F0FF] text-xs">memory_recall</code> via the MCP tool or CLI.
              The panel search is for quick manual lookup when you know a keyword in the content.
            </p>
          </div>

          {/* Table */}
          <div className="mb-8">
            <SubHeading icon={<TbTable size={15} />} title="Memory Table" />
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#D4AF37]/20">
                    <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">
                      Column
                    </th>
                    <th className="text-left py-3 text-[#888] font-semibold uppercase tracking-wider">
                      What it shows
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[#aaa]">
                  {([
                    [
                      'Content',
                      'Truncated to ~80 chars. Hover or click Edit to see the full text.',
                    ],
                    [
                      'Type',
                      'Colored badge: episodic (dim), semantic (cyan), procedural (gold), preference (green), fact (blue), moment (purple).',
                    ],
                    [
                      'Namespace',
                      'The owning agent namespace. Distinguishes memories from different agents in a shared store.',
                    ],
                    [
                      'Heat',
                      'Color-coded bar with exact float value. Cyan = hot (0.8+), yellow-green = warm (0.5–0.79), amber = cool (0.3–0.49), red = cold (<0.3).',
                    ],
                    [
                      'Created',
                      'Timestamp when the node was first stored. Hover to see the full ISO-8601 datetime.',
                    ],
                  ] as [string, string][]).map(([col, desc]) => (
                    <tr key={col} className="border-b border-[#1a2a3a]">
                      <td className="py-2.5 pr-4 font-mono text-[#00F0FF] whitespace-nowrap">{col}</td>
                      <td className="py-2.5">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[#555] uppercase tracking-widest mb-2">Heat colour reference</p>
            <CodeBlock code={HEAT_REFERENCE} lang="reference" />
          </div>

          {/* Edit / Delete */}
          <div className="mb-8">
            <SubHeading icon={<TbEdit size={15} />} title="Edit / Delete" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-[#00F0FF]/10 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TbEdit size={14} className="text-[#00F0FF]" />
                  <p className="text-xs font-bold text-[#00F0FF]">Edit</p>
                </div>
                <p className="text-xs text-[#888] leading-relaxed">
                  Opens an inline form pre-filled with current values. You can update content, type,
                  heat, pin status, or namespace. Changes are persisted immediately and the HNSW
                  index is updated — the edited memory is semantically searchable without restarting
                  the process.
                </p>
              </div>
              <div className="border border-[#00F0FF]/10 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TbTrash size={14} className="text-[#00F0FF]" />
                  <p className="text-xs font-bold text-[#00F0FF]">Delete</p>
                </div>
                <p className="text-xs text-[#888] leading-relaxed">
                  Permanently removes the node and all its edges from Postgres and the HNSW index.
                  A confirmation dialog is shown first. Deletion is irreversible — the panel has no
                  undo. For bulk pruning of cold memories, prefer the MCP{' '}
                  <code className="text-[#00F0FF]">memory_deprecate</code> tool.
                </p>
              </div>
            </div>
          </div>

          {/* Pagination */}
          <div>
            <SubHeading icon={<TbTable size={15} />} title="Pagination" />
            <p className="text-sm text-[#888] leading-relaxed">
              Results are paginated at 25 nodes per page. Controls appear at the bottom of the table
              with total count and current page. Filters and search are applied before pagination —
              the count reflects filtered results, not total nodes.
            </p>
          </div>
        </section>

        {/* ── 3. Context Tab ──────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor
            id="context"
            icon={<TbCode size={20} />}
            title="Context Tab"
            sub="Live preview of the XML block injected into the LLM system prompt"
          />
          <p className="text-sm text-[#ccc] leading-relaxed mb-6">
            The Context tab renders exactly what{' '}
            <code className="text-[#00F0FF]">build_context</code> returns — the XML block that
            Sulcus prepends to every LLM system prompt. This is the ground truth of what the agent
            currently &quot;knows&quot; through its memory system. The preview updates on each page
            load; refreshing the tab always shows the current state.
          </p>
          <p className="text-sm text-[#888] leading-relaxed mb-8">
            Use this tab to answer: &quot;Is my preference actually being injected?&quot;,
            &quot;Why does the agent keep referring to that old procedure?&quot;, or &quot;How much
            context budget is Sulcus using?&quot;
          </p>

          <div className="mb-6 border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
            {([
              [
                '<cheatsheet>',
                'Short instructional text for the agent on how to use Sulcus tools. Rendered once, at the top. Comes from the plugin configuration — not editable from the panel.',
              ],
              [
                '<preferences>',
                'All preference-type nodes ordered by heat descending. The agent reads these to recall user-stated preferences. Each item includes its ID so the agent can reference or update it.',
              ],
              [
                '<facts>',
                "Fact-type nodes. Stable knowledge points that don't change often — dates, constants, known truths. Ordered by heat.",
              ],
              [
                '<procedures>',
                'Procedural memories — how-to guides, deploy instructions, runbooks. Typically the most verbose section. Ordered by heat. These are what the agent reaches for when it needs to know how to do something.',
              ],
              [
                '<active_triggers>',
                'All enabled triggers with their event, action, fire count, and active filters. The agent reads this to understand what reactive rules are in play without calling list_triggers.',
              ],
              [
                '<recent_trigger_fires>',
                'Log of the most recent trigger firings — which trigger, on what node, and when. Gives the agent real-time awareness of what the memory system just did automatically.',
              ],
            ] as [string, string][]).map(([tag, desc]) => (
              <div key={tag} className="px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                <code className="text-[#00F0FF] text-xs font-mono block mb-1">{tag}</code>
                <p className="text-xs text-[#888] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-[#555] uppercase tracking-widest mb-2">Example output</p>
          <CodeBlock code={CONTEXT_PREVIEW} lang="xml" />

          <div className="mt-4 border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded flex items-start gap-2">
            <TbInfoCircle size={16} className="text-[#D4AF37] mt-0.5 shrink-0" />
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              If context output looks empty or shorter than expected, check the Browse tab to confirm
              memories actually exist. The context block only includes memories above the minimum heat
              threshold (default 0.1) — cold nodes are excluded to keep context size manageable.
            </p>
          </div>
        </section>

        {/* ── 4. Triggers Tab ─────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor
            id="triggers"
            icon={<TbBolt size={20} />}
            title="Triggers Tab"
            sub="Create and manage reactive rules that fire on memory events"
          />
          <p className="text-sm text-[#ccc] leading-relaxed mb-8">
            Triggers are rules that fire automatically when a memory event occurs — a node is
            stored, recalled, boosted, linked, or its heat crosses a boundary. This tab lets you
            manage triggers visually without code. For full documentation on events, actions, and
            filters, see the{' '}
            <Link href="/docs/triggers" className="text-[#00F0FF] hover:text-white transition-colors underline">
              Reactive Triggers docs
            </Link>.
          </p>

          {/* Create Trigger */}
          <div className="mb-8">
            <SubHeading icon={<TbPlus size={15} />} title="Create Trigger" />
            <p className="text-sm text-[#888] mb-4 leading-relaxed">
              A form at the top of the tab. Required fields are Name, Event, and Action. All others
              are optional and scope or modify the trigger&apos;s behaviour.
            </p>
            <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5 mb-6">
              {([
                [
                  'Name',
                  'text',
                  'Human-readable identifier. Shown in the active triggers list, notifications, and trigger history.',
                ],
                [
                  'Event',
                  'dropdown',
                  'on_store · on_recall · on_boost · on_decay · on_threshold · on_relate. When to fire.',
                ],
                [
                  'Action',
                  'dropdown',
                  'notify · boost · pin · tag · deprecate · webhook. What to do when the trigger fires.',
                ],
                [
                  'Filter: memory_type',
                  'dropdown',
                  'Restrict to a specific type: episodic, semantic, procedural, preference, fact, moment.',
                ],
                [
                  'Filter: namespace',
                  'text',
                  'Only fire for memories in this namespace. Leave blank to match all namespaces.',
                ],
                [
                  'Filter: label_pattern',
                  'text',
                  'Case-insensitive substring match on the memory label. "deploy" matches any label containing "deploy".',
                ],
                [
                  'Filter: heat_above',
                  '0.0 – 1.0',
                  'Only fire when the memory heat is strictly above this value at the time of the event.',
                ],
                [
                  'Filter: heat_below',
                  '0.0 – 1.0',
                  'Only fire when heat is strictly below this value. Combine with on_decay or on_threshold for cooling alerts.',
                ],
                [
                  'cooldown_seconds',
                  'number',
                  'Minimum seconds between consecutive firings. Prevents high-frequency events (e.g., on_recall) from flooding notifications.',
                ],
                [
                  'max_fires',
                  'number / blank',
                  'Maximum total firings allowed. Leave blank for unlimited. Useful for one-shot triggers.',
                ],
                [
                  'Enabled',
                  'toggle',
                  'Whether the trigger is active. Disabled triggers are kept in the list but never fire. Use this to pause without deleting.',
                ],
              ] as [string, string, string][]).map(([field, type, desc]) => (
                <div key={field} className="flex gap-4 px-4 py-3">
                  <div className="w-36 shrink-0">
                    <p className="text-xs font-bold text-[#00F0FF]">{field}</p>
                    <p className="text-[10px] text-[#555] font-mono mt-0.5">{type}</p>
                  </div>
                  <p className="text-xs text-[#888] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Active Triggers */}
          <div className="mb-8">
            <SubHeading icon={<TbToggleLeft size={15} />} title="Active Triggers List" />
            <p className="text-sm text-[#888] mb-4 leading-relaxed">
              A table showing all triggers in the store, whether enabled or disabled. Columns:
              Name, Event, Action, Filter (summary), Fires (total count), Enabled toggle, and
              Edit / Delete actions. The fire count increments in real time as the agent uses
              memory. A count of zero usually means the filter conditions have never been met yet.
            </p>
            <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
              {([
                ['Fires counter', 'Cumulative count since trigger creation. Not reset on process restart unless you call update_trigger with reset_fire_count=true.'],
                ['Enabled toggle', 'Click to pause or resume the trigger instantly. The trigger stays in the list; it just stops firing until re-enabled.'],
                ['Edit', 'Opens the create form pre-filled with current values. Save overwrites in place.'],
                ['Delete', 'Removes the trigger and its full history. Confirmed by dialog. Irreversible.'],
              ] as [string, string][]).map(([col, desc]) => (
                <div key={col} className="px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                  <p className="text-xs font-bold text-[#00F0FF] mb-1">{col}</p>
                  <p className="text-xs text-[#888] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Trigger History */}
          <div>
            <SubHeading icon={<TbHistory size={15} />} title="Trigger History" />
            <p className="text-sm text-[#888] leading-relaxed">
              A chronological log of recent trigger firings. Each entry shows: which trigger fired,
              the event type, the action taken, the node it fired on (truncated label), and the
              timestamp. Useful for debugging — if a trigger isn&apos;t firing when you expect it to,
              check here to see the last time it actually ran and on what node. The history is
              paginated and persisted in Postgres; it survives process restarts.
            </p>
          </div>
        </section>

        {/* ── 5. Settings Tab ─────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor
            id="settings"
            icon={<TbSettings size={20} />}
            title="Settings Tab"
            sub="Tune the thermodynamic engine that governs memory decay"
          />
          <p className="text-sm text-[#ccc] leading-relaxed mb-8">
            The Settings tab exposes the thermodynamic configuration that controls how fast
            memories decay, when the decay tick runs, and how heat spreads between connected
            nodes. All settings are adjustable via form inputs and saved with a single Save
            button. Changes take effect on the next decay tick.
          </p>

          {/* Half-lives */}
          <div className="mb-8">
            <SubHeading icon={<TbSettings size={15} />} title="Per-type Half-lives" />
            <p className="text-sm text-[#888] mb-4 leading-relaxed">
              Each memory type has an independent half-life — the time it takes for heat to drop
              by 50% from its current value (assuming no recall or boost activity). Shorter
              half-lives = faster forgetting. Defaults are calibrated for typical agent workloads
              but can be tuned per deployment.
            </p>
            <CodeBlock code={HALF_LIVES} lang="reference" />
            <p className="text-xs text-[#555] mt-3 leading-relaxed">
              Half-lives are in wall-clock time and depend on the tick interval. A procedural
              memory at heat 0.9 with a 30-day half-life will reach heat ~0.45 after 30 days of
              no activity, assuming hourly ticks.
            </p>
          </div>

          {/* Tick mode */}
          <div className="mb-8">
            <SubHeading icon={<TbSettings size={15} />} title="Tick Mode" />
            <p className="text-sm text-[#888] mb-4 leading-relaxed">
              The tick mode determines when the decay engine runs. Three modes are supported:
            </p>
            <CodeBlock code={TICK_MODES} lang="reference" />
            <p className="text-xs text-[#555] mt-3 leading-relaxed">
              <strong className="text-[#888]">Recommendation:</strong> Use{' '}
              <code className="text-[#00F0FF]">hybrid</code> for agents that have bursty activity
              with long idle gaps. Use <code className="text-[#00F0FF]">fixed</code> for
              predictable, clock-aligned decay. Use{' '}
              <code className="text-[#00F0FF]">activity</code> for minimal background CPU usage.
            </p>
          </div>

          {/* Other settings */}
          <div className="mb-8">
            <SubHeading icon={<TbSettings size={15} />} title="Other Configuration" />
            <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
              {([
                [
                  'Base interval',
                  'The fixed tick interval in seconds (used in fixed and hybrid modes). Default: 3600 s (1 hour). Lower values = more frequent decay at higher CPU cost.',
                ],
                [
                  'Resonance / heat spread factor',
                  'How much heat propagates to neighbour nodes via edges when a node is recalled or boosted. 0.0 = no spread. 0.1–0.2 = gentle resonance. Higher values cause rapid co-activation of related memories.',
                ],
                [
                  'Cold threshold',
                  'Heat value below which a node is considered "cold" for consolidation purposes. Default: 0.15. Nodes below this threshold become candidates for automatic pruning.',
                ],
                [
                  'Cold count trigger',
                  'Number of cold nodes required to trigger a consolidation pass. When this count is reached the engine runs a cleanup sweep, removing or merging cold nodes to keep the graph size manageable.',
                ],
              ] as [string, string][]).map(([setting, desc]) => (
                <div key={setting} className="px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                  <p className="text-xs font-bold text-[#00F0FF] mb-1">{setting}</p>
                  <p className="text-xs text-[#888] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded flex items-start gap-2">
            <TbInfoCircle size={16} className="text-[#D4AF37] mt-0.5 shrink-0" />
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              Changes to thermodynamic settings affect all memories in the store regardless of when
              they were created. If you lower half-lives dramatically on a populated store, expect
              a large drop in average heat on the next tick. Test changes on a staging store before
              applying to production.
            </p>
          </div>
        </section>

        {/* ── 6. Local vs Cloud ───────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor
            id="local-vs-cloud"
            icon={<TbServer size={20} />}
            title="Local vs Cloud"
            sub="Same five tabs, different deployment contexts"
          />
          <p className="text-sm text-[#ccc] leading-relaxed mb-8">
            Both the local panel and the cloud dashboard at{' '}
            <a
              href="https://sulcus.ca/dashboard"
              className="text-[#00F0FF] hover:text-white transition-colors underline"
            >
              sulcus.ca/dashboard
            </a>{' '}
            expose the same five tabs with the same features. The differences are operational, not
            functional.
          </p>

          <div className="border border-[#00F0FF]/10 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D4AF37]/20">
                  <th className="text-left py-3 px-4 text-[#888] font-semibold uppercase tracking-wider"></th>
                  <th className="text-left py-3 px-4 text-[#D4AF37] font-semibold uppercase tracking-wider">
                    Local Panel
                  </th>
                  <th className="text-left py-3 px-4 text-[#00F0FF] font-semibold uppercase tracking-wider">
                    Cloud Dashboard
                  </th>
                </tr>
              </thead>
              <tbody className="text-[#aaa]">
                {([
                  ['URL', 'http://localhost:4203', 'https://sulcus.ca/dashboard'],
                  ['Auth', 'None — local access only', 'Keycloak SSO'],
                  ['Agents', 'Single-agent (one local process)', 'Multi-agent (team shared)'],
                  ['Data', 'Embedded Postgres on disk', 'Managed cloud Postgres'],
                  ['Real-time', 'Yes — same process', 'Yes — WebSocket sync'],
                  ['Availability', 'Only while sulcus-local is running', 'Always on'],
                  ['Mode required', 'sulcus-local serve', 'Any mode (cloud account)'],
                  ['Use case', 'Local dev, single-agent, no auth overhead', 'Team collaboration, cross-agent shared memory'],
                ] as [string, string, string][]).map(([row, local, cloud]) => (
                  <tr key={row} className="border-b border-[#1a2a3a]">
                    <td className="py-2.5 px-4 text-[#555] font-semibold whitespace-nowrap">{row}</td>
                    <td className="py-2.5 px-4 text-[#D4AF37]/80">{local}</td>
                    <td className="py-2.5 px-4 text-[#00F0FF]/80">{cloud}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-[#D4AF37]/20 p-4 bg-[#D4AF37]/5">
              <div className="flex items-center gap-2 mb-2">
                <TbServer size={15} className="text-[#D4AF37]" />
                <p className="text-xs font-bold text-[#D4AF37] uppercase tracking-wider">
                  When to use Local
                </p>
              </div>
              <p className="text-xs text-[#888] leading-relaxed">
                You are running a single agent on your machine and want instant feedback with no
                auth setup. Local panel is ideal during development, prompt engineering, and
                debugging trigger configurations. No account required.
              </p>
            </div>
            <div className="border border-[#00F0FF]/20 p-4 bg-[#00F0FF]/5">
              <div className="flex items-center gap-2 mb-2">
                <TbCloud size={15} className="text-[#00F0FF]" />
                <p className="text-xs font-bold text-[#00F0FF] uppercase tracking-wider">
                  When to use Cloud
                </p>
              </div>
              <p className="text-xs text-[#888] leading-relaxed">
                You have multiple agents sharing a memory store, or need team members to inspect
                agent memory without SSH access. Cloud dashboard adds Keycloak auth and
                multi-namespace visibility across all connected agents.
              </p>
            </div>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="border-t border-[#D4AF37]/20 mt-12 pt-10">
          <h2 className="text-xl font-bold text-[#ededed] mb-3">Memory you can see.</h2>
          <p className="text-[#888] text-sm leading-relaxed mb-6">
            The local panel is a debug and inspection tool, not a production dashboard. If you find
            yourself using it constantly, consider what trigger or MCP tool call would give your
            agent the same visibility automatically.
          </p>
          <div className="flex flex-col md:flex-row gap-4">
            <Link
              href="/docs/triggers"
              className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors"
            >
              Triggers Reference &rarr;
            </Link>
            <Link
              href="/docs"
              className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors"
            >
              Back to Docs &rarr;
            </Link>
            <a
              href="https://sulcus.ca/dashboard"
              className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors"
            >
              Cloud Dashboard &rarr;
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}