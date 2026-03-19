'use client';

import Link from 'next/link';
import {
  TbArrowLeft, TbBolt, TbFlame, TbBell, TbWebhook,
  TbShieldCheck, TbCode, TbSettings, TbTag, TbPin,
  TbArrowDown, TbArrowUp,
} from 'react-icons/tb';

const CONTEXT_XML = `<active_triggers>
  <trigger name="auto-pin-preferences" event="on_store" action="pin" fires="4" filter="preference" />
  <trigger name="notify-on-recall" event="on_recall" action="notify" fires="246" />
  <trigger name="cold-memory-alert" event="on_decay" action="notify" fires="0" />
  <trigger name="strategy-boost" event="on_threshold" action="boost" fires="299" filter="@icarus" />
  <trigger name="tag-new-episodic" event="on_store" action="tag" fires="54" filter="episodic@icarus" />
</active_triggers>

<recent_trigger_fires>
  <fire event="on_threshold" action="boost" node="Strategy: growth"  at="2026-03-19T09:56:32Z" />
  <fire event="on_recall"    action="notify" node="Deploy procedure" at="2026-03-19T09:50:10Z" />
  <fire event="on_recall"    action="notify" node="User preferences" at="2026-03-19T09:50:09Z" />
  <fire event="on_threshold" action="boost" node="Architecture"     at="2026-03-19T09:50:03Z" />
</recent_trigger_fires>`;

const MCP_CREATE = `// MCP tool — create_trigger
{
  "name": "auto-pin-preferences",
  "event": "on_store",
  "action": "pin",
  "filter_memory_type": "preference",
  "cooldown_seconds": 0,
  "max_fires": null,
  "enabled": true
}`;

const MCP_LIST = `// MCP tool — list_triggers  (event filter optional)
{ "event": "on_store" }

// Response
[{
  "id": "trig_01J...", "name": "auto-pin-preferences",
  "event": "on_store", "action": "pin",
  "filter_memory_type": "preference",
  "fire_count": 4, "enabled": true,
  "created_at": "2026-03-16T18:23:11Z"
}]`;

const MCP_UPDATE = `// MCP tool — update_trigger
{
  "trigger_id": "trig_01J...",
  "enabled": false,           // pause the trigger
  "cooldown_seconds": 300,    // add 5-minute cooldown
  "reset_fire_count": true    // reset counter to 0
}`;

const MCP_HISTORY = `// MCP tool — trigger_history
{ "trigger_id": "trig_01J...", "limit": 10 }

// Response
[{
  "id": "fire_01J...",
  "trigger_name": "auto-pin-preferences",
  "event": "on_store", "action": "pin",
  "node_id": "node_01J...",
  "node_label": "User prefers dark mode",
  "fired_at": "2026-03-19T09:45:01Z"
}]`;

const REST_EXAMPLES = `# List all triggers
curl https://api.sulcus.ca/api/v1/triggers \\
  -H "Authorization: Bearer sk-..."

# Create
curl -X POST https://api.sulcus.ca/api/v1/triggers \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{"name":"boost-on-recall","event":"on_recall","action":"boost","action_config":{"strength":0.15}}'

# Update (pause)
curl -X PATCH https://api.sulcus.ca/api/v1/triggers/trig_01J... \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{"enabled": false}'

# Delete
curl -X DELETE https://api.sulcus.ca/api/v1/triggers/trig_01J... \\
  -H "Authorization: Bearer sk-..."

# History
curl "https://api.sulcus.ca/api/v1/triggers/history?limit=20" \\
  -H "Authorization: Bearer sk-..."`;

const PYTHON_EXAMPLES = `from sulcus import Sulcus
client = Sulcus(api_key="sk-...")

# 1. Auto-pin preferences on store
client.create_trigger(event="on_store", action="pin",
    name="auto-pin-preferences", filter_memory_type="preference")

# 2. Spaced-repetition boost on every recall
client.create_trigger(event="on_recall", action="boost",
    name="reinforce-on-recall", action_config={"strength": 0.15})

# 3. Cold memory alert — notify when procedure cools below 0.3
client.create_trigger(event="on_decay", action="notify",
    name="cold-memory-alert", filter_memory_type="procedural",
    filter_heat_below=0.3,
    action_config={"template": "Warning: '{label}' cooling (heat: {heat:.2f})"})

# 4. Webhook to Slack when deployment procedures change
client.create_trigger(event="on_store", action="webhook",
    name="deploy-webhook", filter_memory_type="procedural",
    filter_label_pattern="deploy",
    action_config={"url": "https://hooks.slack.com/services/T000/B000/xxxx"})

# 5. Tag new episodic memories for review
client.create_trigger(event="on_store", action="tag",
    name="tag-new-episodic", filter_memory_type="episodic",
    action_config={"tag": "needs-review"})

# List
for t in client.list_triggers():
    print(f"[{'on' if t['enabled'] else 'off'}] {t['name']}  fired {t['fire_count']}x")

# History
for h in client.trigger_history(limit=10):
    print(f"  {h['fired_at']}  {h['trigger_name']}")

# Update
client.update_trigger("trig_01J...", cooldown_seconds=300, enabled=False)

# Delete
client.delete_trigger("trig_01J...")`;

const NODE_EXAMPLES = `import { Sulcus } from "sulcus";
const client = new Sulcus({ apiKey: "sk-..." });

// 1. Auto-pin preferences on store
await client.createTrigger("on_store", "pin", {
  name: "auto-pin-preferences", filterMemoryType: "preference" });

// 2. Spaced-repetition boost on every recall
await client.createTrigger("on_recall", "boost", {
  name: "reinforce-on-recall", actionConfig: { strength: 0.15 } });

// 3. Cold memory alert
await client.createTrigger("on_decay", "notify", {
  name: "cold-memory-alert", filterMemoryType: "procedural",
  filterHeatBelow: 0.3,
  actionConfig: { template: "Warning: '{label}' cooling (heat: {heat})" } });

// 4. Webhook to Slack on deploy procedure changes
await client.createTrigger("on_store", "webhook", {
  name: "deploy-webhook", filterMemoryType: "procedural",
  filterLabelPattern: "deploy",
  actionConfig: { url: "https://hooks.slack.com/services/T000/B000/xxxx" } });

// 5. Tag new episodic memories
await client.createTrigger("on_store", "tag", {
  name: "tag-new-episodic", filterMemoryType: "episodic",
  actionConfig: { tag: "needs-review" } });

// List
const triggers = await client.listTriggers();
triggers.forEach(t =>
  console.log(\`[\${t.enabled ? "on" : "off"}] \${t.name}  fired \${t.fire_count}x\`));

// Update, delete, history
await client.updateTrigger("trig_01J...", { cooldownSeconds: 300, enabled: false });
await client.deleteTrigger("trig_01J...");
const history = await client.triggerHistory({ limit: 10 });`;

const WEBHOOK_PAYLOAD = `// HTTP POST — HMAC-SHA256 signed
// Headers: X-Sulcus-Signature: sha256=<hmac>  |  X-Sulcus-Event: on_store
{
  "event": "on_store",
  "trigger_name": "deploy-webhook",
  "fired_at": "2026-03-19T10:00:00Z",
  "node": {
    "id": "node_01J...",
    "label": "Deploy: push to ACR then az containerapp update",
    "memory_type": "procedural",
    "namespace": "icarus",
    "heat": 0.95,
    "tags": ["deploy", "azure"]
  }
}`;

const NOTIFY_TEMPLATE = `// Template variables: {node_id} {label} {namespace} {heat} {event}
{
  "action": "notify",
  "action_config": {
    "template": "Memory stored: '{label}' in {namespace} (heat: {heat:.2f})"
  }
}`;


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

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET:    'text-green-400',
    POST:   'text-blue-400',
    PATCH:  'text-yellow-400',
    DELETE: 'text-red-400',
  };
  return (
    <span className={`font-mono text-xs w-14 shrink-0 ${colors[method] ?? 'text-[#888]'}`}>
      {method}
    </span>
  );
}


export default function TriggersDocsPage() {
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
            <TbBolt size={28} className="text-[#D4AF37]" />
            <h1 className="text-3xl font-bold tracking-tight">Reactive Triggers</h1>
          </div>
          <p className="text-[#888] text-base leading-relaxed">
            Triggers are rules that fire automatically when something happens in your memory
            graph — a memory is stored, recalled, boosted, linked, or its heat crosses a
            boundary. No polling. No cron jobs. Your memory governs itself.
          </p>
          <p className="text-xs text-[#555] mt-3 tracking-wider uppercase">
            Sulcus · Memory Triggers Reference · 2026
          </p>
        </div>
        <div className="border-b border-[#D4AF37]/20 mb-10" />

        {/* TOC */}
        <nav className="mb-12 border border-[#00F0FF]/10 p-5 bg-[#00F0FF]/3 rounded-lg">
          <p className="text-xs text-[#555] uppercase tracking-widest mb-3">On this page</p>
          <ol className="space-y-1.5 text-sm columns-2">
            {([
              ['#what',     'What are Triggers?'],
              ['#events',   'Events (6 types)'],
              ['#actions',  'Actions (7 types)'],
              ['#filters',  'Filters'],
              ['#config',   'Configuration'],
              ['#mcp',      'MCP Tools'],
              ['#rest',     'REST API'],
              ['#examples', 'Practical Examples'],
              ['#sdk',      'SDK Reference'],
              ['#context',  'In-Context XML'],
            ] as [string,string][]).map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-[#00F0FF]/70 hover:text-[#00F0FF] transition-colors">{label}</a>
              </li>
            ))}
          </ol>
        </nav>

        {/* ── 1. What are Triggers? ─────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="what" icon={<TbFlame size={20} />} title="What are Triggers?"
            sub="Reactive rules that run server-side whenever a memory event fires" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4">
            <p>
              Every other memory system is passive. You store. You retrieve. The memory sits
              there, decaying silently, waiting to be queried.
            </p>
            <p>
              Sulcus triggers make memory <strong className="text-white">active</strong>.
              When a new preference is stored, it can pin itself automatically. When a memory
              is recalled repeatedly, it reinforces its own heat — spaced repetition with zero
              configuration. When a critical procedure starts cooling, your agent knows before
              it slips out of context.
            </p>
            <p>
              <strong className="text-[#D4AF37]">No competitor offers this.</strong> Triggers run
              server-side, fire during MCP tool calls, and surface inline as{' '}
              <code className="text-[#00F0FF]">trigger_notifications</code>. The result: a memory
              graph that manages its own lifecycle, without any orchestration code on your side.
            </p>
          </div>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: <TbBolt size={16} />, t: 'Event-driven', b: 'Fires on memory events — not on a timer, not by polling.' },
              { icon: <TbShieldCheck size={16} />, t: 'Server-side', b: 'Runs inside the Sulcus engine. No extra infrastructure required.' },
              { icon: <TbBell size={16} />, t: 'Inline notifications', b: "Results surface directly in your agent's tool responses." },
            ].map((c) => (
              <div key={c.t} className="border border-[#D4AF37]/20 p-4 bg-[#D4AF37]/5">
                <div className="flex items-center gap-2 text-[#D4AF37] mb-2">
                  {c.icon}
                  <span className="text-xs font-bold uppercase tracking-wider">{c.t}</span>
                </div>
                <p className="text-xs text-[#888] leading-relaxed">{c.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 2. Events ─────────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="events" icon={<TbBolt size={20} />} title="Trigger Events"
            sub="Six event types span the full memory lifecycle" />
          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
            {([
              ['on_store',    'A new memory node is created',
               'Fires immediately after memory_store or record_memory. Auto-tag, auto-pin, or webhook new content the moment it enters the graph.',
               ['Auto-pin by type','Tag on creation','Webhook external systems']],
              ['on_recall',   'A memory is returned by search',
               'Fires for each node returned during memory_recall or search_memory. Ideal for spaced repetition — recalled memories stay hot.',
               ['Spaced repetition','Notify on critical recall','Track what surfaces']],
              ['on_decay',    'Memory heat drops during the decay tick',
               'Fires per-node during the thermodynamic tick. Catch important memories before they cool — re-pin, alert, or webhook before expiry.',
               ['Cold memory alert','Re-pin before expiry','Webhook cooling procedures']],
              ['on_boost',    'Memory heat is explicitly increased',
               'Fires when memory_boost or feedback("relevant") increases heat. Chain actions, log escalations, relay to external systems.',
               ['Chain boost actions','Log escalations','Notify on priority shift']],
              ['on_relate',   'Two memory nodes are linked by an edge',
               'Fires when memory_relate creates a relationship. Propagate tags, boost related nodes, or log graph-level events.',
               ['Propagate tags','Boost related nodes','Graph event logging']],
              ['on_threshold','Heat crosses a configured boundary',
               'Fires when heat crosses filter_heat_above or filter_heat_below. More precise than on_decay — targets exact heat windows.',
               ['Alert at heat=0.3','Boost at heat=0.9','Webhook on crossings']],
            ] as [string,string,string,string[]][]).map(([ev, tagline, detail, uses]) => (
              <div key={ev} className="p-4 hover:bg-[#00F0FF]/5 transition-colors">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <code className="text-[#00F0FF] font-mono text-sm font-bold">{ev}</code>
                  <span className="text-xs text-[#666]">— {tagline}</span>
                </div>
                <p className="text-sm text-[#aaa] mb-2 leading-relaxed">{detail}</p>
                <div className="flex flex-wrap gap-1.5">
                  {uses.map((u) => (
                    <span key={u} className="text-[10px] text-[#555] border border-[#1a2a3a] px-2 py-0.5 rounded">{u}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>


        {/* ── 3. Actions ────────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="actions" icon={<TbSettings size={20} />} title="Trigger Actions"
            sub="Seven actions control what happens when a trigger fires" />
          <div className="space-y-4">

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbBell size={16} className="text-[#00F0FF]" />
                <code className="text-[#00F0FF] font-mono text-sm font-bold">notify</code>
                <Chip label="surfaces inline" variant="cyan" />
              </div>
              <p className="text-sm text-[#aaa] mb-3 leading-relaxed">
                Surfaces a message in the agent&apos;s tool response as a{' '}
                <code className="text-[#00F0FF] text-xs">trigger_notification</code>. Seen in real time.
                Supports template interpolation with memory metadata.
              </p>
              <CodeBlock code={NOTIFY_TEMPLATE} lang="json" />
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbArrowUp size={16} className="text-[#D4AF37]" />
                <code className="text-[#00F0FF] font-mono text-sm font-bold">boost</code>
                <Chip label="configurable strength" variant="gold" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Increases heat by <code className="text-[#00F0FF] text-xs">action_config.strength</code>{' '}
                (default 0.1, range 0–1, capped at 1.0). Combine with{' '}
                <code className="text-[#00F0FF] text-xs">on_recall</code> for automatic spaced repetition.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbPin size={16} className="text-[#D4AF37]" />
                <code className="text-[#00F0FF] font-mono text-sm font-bold">pin</code>
                <Chip label="prevents all decay" variant="gold" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Sets <code className="text-[#00F0FF] text-xs">is_pinned=true</code>. Memory never decays
                below <code className="text-[#00F0FF] text-xs">min_heat</code>. Combine with{' '}
                <code className="text-[#00F0FF] text-xs">on_store + filter_memory_type=preference</code>{' '}
                to make every user preference permanent automatically.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbTag size={16} className="text-[#00F0FF]" />
                <code className="text-[#00F0FF] font-mono text-sm font-bold">tag</code>
                <Chip label="label mutation" variant="cyan" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Appends <code className="text-[#00F0FF] text-xs">action_config.tag</code> to the
                memory&apos;s tag list. Use with <code className="text-[#00F0FF] text-xs">on_store</code>{' '}
                to automatically mark new episodic memories for downstream pipelines.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbArrowDown size={16} className="text-[#888]" />
                <code className="text-[#00F0FF] font-mono text-sm font-bold">deprecate</code>
                <Chip label="accelerates decay" variant="muted" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Reduces heat and marks the memory as superseded. Automatically deprecate stale
                procedures when a new one arrives under the same label pattern. Pairs with{' '}
                <code className="text-[#00F0FF] text-xs">filter_label_pattern</code>.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TbWebhook size={16} className="text-[#D4AF37]" />
                <code className="text-[#00F0FF] font-mono text-sm font-bold">webhook</code>
                <Chip label="HMAC-SHA256 signed" variant="gold" />
              </div>
              <p className="text-sm text-[#aaa] mb-3 leading-relaxed">
                HTTP POST to an external URL — signed, 5s timeout, 1 retry. Notify Slack,
                trigger CI/CD, or sync with external systems when important memories change.
              </p>
              <CodeBlock code={WEBHOOK_PAYLOAD} lang="json" />
            </div>

            <div className="border border-[#1a2a3a] p-4 opacity-60">
              <div className="flex items-center gap-2 mb-2">
                <TbBolt size={16} className="text-[#555]" />
                <code className="text-[#555] font-mono text-sm font-bold">chain</code>
                <Chip label="coming v2" variant="purple" />
              </div>
              <p className="text-sm text-[#666] leading-relaxed">
                Compose trigger pipelines — chain one trigger into another. Planned for v2.
              </p>
            </div>
          </div>
        </section>


        {/* ── 4. Filters ───────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="filters" icon={<TbShieldCheck size={20} />} title="Trigger Filters"
            sub="Scope triggers precisely — only fire when the memory matches your criteria" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D4AF37]/20">
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Filter</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Type</th>
                  <th className="text-left py-3 text-[#888] font-semibold uppercase tracking-wider">Behaviour</th>
                </tr>
              </thead>
              <tbody className="text-[#aaa]">
                {([
                  ['filter_memory_type',  'string',      'Only fire for a specific memory type: episodic, semantic, preference, procedural, fact, moment.'],
                  ['filter_namespace',    'string',      'Scope to a single namespace (agent ID). Trigger only fires for memories in this namespace.'],
                  ['filter_label_pattern','string',      'Case-insensitive substring match on the memory label. "deploy" matches any label containing "deploy".'],
                  ['filter_heat_above',   'number 0–1',  'Only fire when the memory heat is strictly above this value at event time.'],
                  ['filter_heat_below',   'number 0–1',  'Only fire when heat is strictly below this value. Combine with on_decay or on_threshold for cooling alerts.'],
                ] as [string,string,string][]).map(([f, type, desc]) => (
                  <tr key={f} className="border-b border-[#1a2a3a]">
                    <td className="py-2.5 pr-4 font-mono text-[#00F0FF]">{f}</td>
                    <td className="py-2.5 pr-4 text-[#D4AF37]">{type}</td>
                    <td className="py-2.5">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#555] mt-3">
            All filters are optional and combinable. Multiple filters are AND-ed together —
            all conditions must match for the trigger to fire.
          </p>
        </section>

        {/* ── 5. Configuration ─────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="config" icon={<TbSettings size={20} />} title="Trigger Configuration"
            sub="Common fields that control a trigger's behaviour and lifecycle" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D4AF37]/20">
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Field</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Type</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Default</th>
                  <th className="text-left py-3 text-[#888] font-semibold uppercase tracking-wider">Description</th>
                </tr>
              </thead>
              <tbody className="text-[#aaa]">
                {([
                  ['name',              'string',  '—',      'Human-readable identifier shown in logs and notifications.'],
                  ['event',             'string',  '—',      'Required. One of the six event types.'],
                  ['action',            'string',  '—',      'Required. One of the seven action types.'],
                  ['action_config',     'object',  '{}',     'Action-specific options: strength (boost), tag (tag), url/headers (webhook), template (notify).'],
                  ['cooldown_seconds',  'number',  '0',      'Minimum seconds between consecutive firings of this trigger.'],
                  ['max_fires',         'number?', 'null',   'Maximum total firings allowed (null = unlimited).'],
                  ['enabled',           'boolean', 'true',   'Toggle the trigger on/off without deleting it.'],
                ] as [string,string,string,string][]).map(([f, type, def, desc]) => (
                  <tr key={f} className="border-b border-[#1a2a3a]">
                    <td className="py-2.5 pr-4 font-mono text-[#00F0FF]">{f}</td>
                    <td className="py-2.5 pr-4 text-[#D4AF37]">{type}</td>
                    <td className="py-2.5 pr-4 font-mono text-[#666]">{def}</td>
                    <td className="py-2.5">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>


        {/* ── 6. MCP Tools ─────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="mcp" icon={<TbCode size={20} />} title="MCP Tools"
            sub="Five MCP tools give your agent full trigger CRUD from within any conversation" />
          <div className="space-y-6">
            <div>
              <p className="text-sm text-[#888] mb-2">
                <code className="text-[#00F0FF]">create_trigger</code> — Create a new trigger.
              </p>
              <CodeBlock code={MCP_CREATE} lang="json" />
            </div>
            <div>
              <p className="text-sm text-[#888] mb-2">
                <code className="text-[#00F0FF]">list_triggers</code> — List all triggers, with optional event filter.
              </p>
              <CodeBlock code={MCP_LIST} lang="json" />
            </div>
            <div>
              <p className="text-sm text-[#888] mb-2">
                <code className="text-[#00F0FF]">update_trigger</code> — Modify config, enable/disable, reset fire count.
              </p>
              <CodeBlock code={MCP_UPDATE} lang="json" />
            </div>
            <div>
              <p className="text-sm text-[#888] mb-2">
                <code className="text-[#00F0FF]">delete_trigger</code> — Remove a trigger and its full history.
                Takes <code className="text-[#00F0FF] text-xs">{'"trigger_id": "trig_01J..."'}</code>.
              </p>
            </div>
            <div>
              <p className="text-sm text-[#888] mb-2">
                <code className="text-[#00F0FF]">trigger_history</code> — View the firing log (filterable by trigger).
              </p>
              <CodeBlock code={MCP_HISTORY} lang="json" />
            </div>
          </div>
        </section>

        {/* ── 7. REST API ───────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="rest" icon={<TbCode size={20} />} title="REST API"
            sub="Full CRUD over HTTP — integrate with any language or toolchain" />
          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5 mb-6">
            {([
              ['GET',    '/api/v1/triggers',         'List all triggers'],
              ['POST',   '/api/v1/triggers',         'Create a trigger'],
              ['PATCH',  '/api/v1/triggers/:id',     'Update trigger config, enable/disable'],
              ['DELETE', '/api/v1/triggers/:id',     'Delete trigger + history'],
              ['GET',    '/api/v1/triggers/history', 'Firing history (paginated)'],
            ] as [string,string,string][]).map(([method, path, desc]) => (
              <div key={path + method} className="flex items-center gap-3 px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                <MethodBadge method={method} />
                <code className="text-sm text-[#ccc] font-mono flex-1">{path}</code>
                <span className="text-xs text-[#666] hidden md:block">{desc}</span>
              </div>
            ))}
          </div>
          <CodeBlock code={REST_EXAMPLES} lang="bash" />
        </section>


        {/* ── 8. Practical Examples ────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="examples" icon={<TbFlame size={20} />} title="Practical Examples"
            sub="Real-world trigger patterns that make your agents smarter" />
          <div className="space-y-6">
            {([
              {
                title: '1. Auto-pin preferences on store',
                desc: 'Every preference memory is pinned the moment it is created — no manual pinning required. User preferences never decay out of context.',
                event: 'on_store', action: 'pin', filter: 'filter_memory_type: preference',
              },
              {
                title: '2. Spaced repetition (boost on recall)',
                desc: 'Each time a memory surfaces in search results, its heat is bumped up. The more an agent uses a memory, the hotter it stays. Mimics human spaced repetition.',
                event: 'on_recall', action: 'boost', filter: 'action_config.strength: 0.15',
              },
              {
                title: '3. Cold memory alert',
                desc: 'When a procedural memory (how-to, deploy instructions, runbooks) cools below heat 0.3, your agent gets an inline notification before the context is lost.',
                event: 'on_decay', action: 'notify', filter: 'filter_memory_type: procedural + filter_heat_below: 0.3',
              },
              {
                title: '4. Webhook to Slack on deploy changes',
                desc: 'When any memory containing "deploy" in its label is stored, fire a signed webhook to Slack. Your team is notified the moment an agent updates deployment knowledge.',
                event: 'on_store', action: 'webhook', filter: 'filter_label_pattern: deploy',
              },
              {
                title: '5. Tag new episodic memories for review',
                desc: 'All episodic memories (events, conversations) are tagged "needs-review" on creation. A downstream workflow can then process, summarise, or escalate them.',
                event: 'on_store', action: 'tag', filter: 'filter_memory_type: episodic',
              },
            ]).map((ex) => (
              <div key={ex.title} className="border border-[#00F0FF]/10 p-5">
                <h3 className="text-sm font-bold text-[#ededed] mb-2">{ex.title}</h3>
                <p className="text-sm text-[#888] mb-3 leading-relaxed">{ex.desc}</p>
                <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                  <span className="border border-[#00F0FF]/20 text-[#00F0FF] px-2 py-0.5 rounded">{ex.event}</span>
                  <span className="text-[#555]">→</span>
                  <span className="border border-[#D4AF37]/20 text-[#D4AF37] px-2 py-0.5 rounded">{ex.action}</span>
                  <span className="text-[#555]">|</span>
                  <span className="border border-[#333] text-[#666] px-2 py-0.5 rounded">{ex.filter}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 9. SDK Reference ──────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="sdk" icon={<TbCode size={20} />} title="SDK Reference"
            sub="Python and Node.js code for complete trigger CRUD" />
          <div className="space-y-8">
            <div>
              <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">Python</h3>
              <CodeBlock code={PYTHON_EXAMPLES} lang="python" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">Node.js / TypeScript</h3>
              <CodeBlock code={NODE_EXAMPLES} lang="typescript" />
            </div>
          </div>
        </section>

        {/* ── 10. How Triggers Appear in Context ───────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="context" icon={<TbShieldCheck size={20} />}
            title="How Triggers Appear in Context"
            sub="Active triggers and recent firings are injected into the LLM system prompt" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              When Sulcus builds the system prompt context block for your agent, it includes two
              trigger sections: <code className="text-[#00F0FF]">active_triggers</code> (all enabled
              triggers with their fire counts) and{' '}
              <code className="text-[#00F0FF]">recent_trigger_fires</code> (the last N firings). This
              gives the model situational awareness about what rules are active and what has recently
              happened — without the agent needing to call <code className="text-[#00F0FF]">list_triggers</code>.
            </p>
            <p>
              The agent can read this context to make smarter decisions: it knows a cold memory alert
              just fired, knows which memories were just boosted, and knows which namespaces are being
              monitored.
            </p>
          </div>
          <CodeBlock code={CONTEXT_XML} lang="xml" />
          <div className="mt-4 border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded">
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              <strong>Why this matters:</strong> The model can see that{' '}
              <code className="text-[#D4AF37] text-xs">notify-on-recall</code> has fired 246 times —
              meaning this agent has been actively recalling memories and reinforcing them. The{' '}
              <code className="text-[#D4AF37] text-xs">cold-memory-alert</code> trigger has never fired,
              meaning no procedural memories have cooled below threshold. This is memory system
              telemetry, inline, for free.
            </p>
          </div>
        </section>

        {/* ── Footer CTA ────────────────────────────────────────────────── */}
        <div className="border-t border-[#D4AF37]/20 mt-12 pt-10">
          <h2 className="text-xl font-bold text-[#ededed] mb-3">Your memory, reactive.</h2>
          <p className="text-[#888] text-sm leading-relaxed mb-6">
            Triggers are available in the Sulcus SDK, MCP server, and REST API today.
            Start with the auto-pin-preferences pattern — one trigger, three lines of code,
            and your agent&apos;s preference recall becomes permanent.
          </p>
          <div className="flex flex-col md:flex-row gap-4">
            <a href="https://sulcus.ca/dashboard" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Try It Now &rarr;
            </a>
            <Link href="/docs" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Back to Docs &rarr;
            </Link>
            <a href="https://github.com/digitalforgeca/sulcus" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              View Source &rarr;
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}

