'use client';

import Link from 'next/link';
import {
  TbArrowLeft, TbBrain, TbFlame, TbCode, TbServer,
  TbRefresh, TbShieldCheck, TbTrash, TbTag, TbPin,
  TbArrowUp, TbDatabase, TbBook,
} from 'react-icons/tb';

/* ── Code Snippets ──────────────────────────────────────────────── */

const PYTHON_STORE = `from sulcus import Sulcus
client = Sulcus(api_key="sk-...")

# Store a memory AND generate a training signal
client.remember("Deploy: push to ACR then az containerapp update",
    memory_type="procedural",
    train=True)          # ← generates an 'accept' signal for SIVU`;

const PYTHON_DELETE = `# Delete a memory AND teach SIVU to reject similar content
client.delete("node_01J...", train=True)
# Snapshots content before deletion, records a 'reject' signal`;

const PYTHON_RECLASSIFY = `# Correct a misclassified memory — highest-value signal for SICU
client.update("node_01J...",
    memory_type="procedural",    # was 'episodic', should be 'procedural'
    train=True)                  # ← generates a 'reclassify' signal`;

const PYTHON_PIN = `# Pin a memory — auto-generates a high-confidence 'accept' signal
client.pin("node_01J...")
# No train flag needed — pinning always trains`;

const PYTHON_BOOST = `# Manually boost heat — auto-generates a medium-confidence 'accept' signal
client.boost("node_01J...", heat=0.95)
# No train flag needed — manual heat changes always train`;

const NODE_STORE = `import { Sulcus } from "@digitalforgestudios/sulcus";
const client = new Sulcus({ apiKey: "sk-..." });

// Store with training signal
await client.remember("Deploy: push to ACR then az containerapp update", {
  memoryType: "procedural",
  train: true,          // generates 'accept' signal for SIVU
});`;

const NODE_DELETE = `// Delete with training — teaches SIVU to reject similar content
await client.delete("node_01J...", { train: true });`;

const NODE_RECLASSIFY = `// Correct a type — highest-value signal for SICU
await client.update("node_01J...", {
  memoryType: "procedural",    // correction
  train: true,                 // generates 'reclassify' signal
});`;

const NODE_PIN = `// Pin — auto-generates high-confidence 'accept' signal
await client.pin("node_01J...");
// No train flag needed`;

const NODE_BOOST = `// Manual boost — auto-generates medium-confidence 'accept' signal
await client.boost("node_01J...", { heat: 0.95 });
// No train flag needed`;

const REST_STORE = `# Store with training signal
curl -X POST https://api.sulcus.ca/api/v1/agent/nodes \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "label": "Deploy: push to ACR then az containerapp update",
    "memory_type": "procedural",
    "train_on_this": true
  }'`;

const REST_DELETE = `# Delete with training signal (snapshots content, records 'reject')
curl -X DELETE "https://api.sulcus.ca/api/v1/agent/nodes/node_01J...?train=true" \\
  -H "Authorization: Bearer sk-..."`;

const REST_RECLASSIFY = `# Reclassify with training signal
curl -X PATCH https://api.sulcus.ca/api/v1/agent/nodes/node_01J... \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "memory_type": "procedural",
    "train_on_this": true
  }'`;

const REST_PIN = `# Pin (auto-generates training signal — no train flag needed)
curl -X PATCH https://api.sulcus.ca/api/v1/agent/nodes/node_01J... \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{"is_pinned": true}'`;

const REST_BOOST = `# Manual heat boost (auto-generates training signal)
curl -X PATCH https://api.sulcus.ca/api/v1/agent/nodes/node_01J... \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{"current_heat": 0.95}'`;

const SCHEMA_SQL = `CREATE TABLE training_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID,
    tenant_id TEXT NOT NULL,
    signal_type TEXT NOT NULL,        -- 'accept', 'reject', 'reclassify'
    corrected_store BOOLEAN,          -- true=should store, false=should reject
    corrected_type TEXT,              -- for reclassify: the correct type
    predicted_type TEXT,              -- what the model predicted (if available)
    content_snapshot TEXT,            -- content at time of signal
    source TEXT NOT NULL,             -- 'train_on_this', 'agent_delete', 'pin', 'boost'
    created_at TIMESTAMPTZ DEFAULT NOW()
);`;

const RETRAIN_STEPS = `# 1. Export accumulated signals
curl https://api.sulcus.ca/api/v2/siu/training-data \\
  -H "Authorization: Bearer sk-..." > signals.json

# 2. Train the quality gate (SIVU)
python scripts/train_sivu.py --data signals.json

# 3. Train the type classifier (SICU)
python scripts/train_sicu.py --data signals.json

# 4. Deploy new ONNX models
cp models/*.onnx /opt/sulcus/models/siu-v2/

# 5. Server picks up new models on restart`;


/* ── Reusable Components ────────────────────────────────────────── */

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

function Chip({ label, variant = 'cyan' }: { label: string; variant?: 'cyan' | 'gold' | 'muted' | 'green' | 'red' }) {
  const s: Record<string, string> = {
    cyan:  'border-[#00F0FF]/30 text-[#00F0FF] bg-[#00F0FF]/5',
    gold:  'border-[#D4AF37]/30 text-[#D4AF37] bg-[#D4AF37]/5',
    muted: 'border-[#333]/50 text-[#666]',
    green: 'border-green-500/30 text-green-400 bg-green-500/5',
    red:   'border-red-500/30 text-red-400 bg-red-500/5',
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


/* ── Main Component ─────────────────────────────────────────────── */

export default function TrainingClient() {
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
            <TbBrain size={28} className="text-[#D4AF37]" />
            <h1 className="text-3xl font-bold tracking-tight">Training Signals</h1>
          </div>
          <p className="text-[#888] text-base leading-relaxed">
            Every memory lifecycle action can generate training data for the SIU v2 pipeline.
            Store, delete, reclassify, pin, boost — each action teaches the quality gate and
            type classifier to improve over time. The pipeline has four subsystems:
            <strong className="text-white"> SIVU</strong> (utility scoring),
            <strong className="text-white"> SICU</strong> (type classification),
            <strong className="text-white"> SILU</strong> (entity extraction via GPT-5.4-nano),
            and <strong className="text-white"> SITU</strong> (trigger evaluation).
            Your agents get smarter by using their memory.
          </p>
          <p className="text-xs text-[#555] mt-3 tracking-wider uppercase">
            Sulcus v2.1.0 · SIU v2 Training Reference · 2026
          </p>
        </div>
        <div className="border-b border-[#D4AF37]/20 mb-10" />

        {/* TOC */}
        <nav className="mb-12 border border-[#00F0FF]/10 p-5 bg-[#00F0FF]/3 rounded-lg">
          <p className="text-xs text-[#555] uppercase tracking-widest mb-3">On this page</p>
          <ol className="space-y-1.5 text-sm columns-2">
            {([
              ['#overview',   'Overview'],
              ['#signals',    'Signal Sources'],
              ['#how',        'How It Works'],
              ['#code',       'Code Examples'],
              ['#rest',       'REST API Reference'],
              ['#schema',     'Signal Table Schema'],
              ['#pipeline',   'Retraining Pipeline'],
              ['#versions',   'Version History'],
            ] as [string, string][]).map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-[#00F0FF]/70 hover:text-[#00F0FF] transition-colors">{label}</a>
              </li>
            ))}
          </ol>
        </nav>


        {/* ── 1. Overview ───────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="overview" icon={<TbFlame size={20} />} title="Overview"
            sub="A continuous feedback loop between your agents and the intelligence unit" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4">
            <p>
              Most memory systems are write-and-forget. You store data, you query it, and
              the system never learns whether what it stored was useful or what it surfaced
              was relevant. Sulcus is different.
            </p>
            <p>
              Every lifecycle action — storing a memory, deleting junk, correcting a
              misclassified type, pinning something important, boosting a critical fact — can
              generate a <strong className="text-white">training signal</strong>. These signals
              accumulate in the <code className="text-[#00F0FF]">training_signals</code> table
              and feed back into the SIU models during retraining.
            </p>
            <p>
              The result is a{' '}
              <strong className="text-[#D4AF37]">self-improving memory system</strong>. The more
              your agents use their memory — and especially the more they correct it — the
              better the quality gate and type classifier become for <em>all</em> memories in
              that namespace.
            </p>
          </div>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { icon: <TbShieldCheck size={16} />, t: 'SIVU — Quality Gate', b: 'Scores base_utility (0–1) on every store. Learns to accept good memories and reject noise from store/delete/pin signals.' },
              { icon: <TbTag size={16} />, t: 'SICU — Type Classifier', b: 'Classifies memory type (episodic, semantic, procedural, fact, preference). Respects explicit types; acts as fallback. Learns from reclassify signals.' },
              { icon: <TbDatabase size={16} />, t: 'SILU — Entity Extractor', b: 'Extracts entities and relationships via GPT-5.4-nano on every store. Builds triples for the AGE knowledge graph. Fires automatically.' },
              { icon: <TbRefresh size={16} />, t: 'SITU — Trigger Unit', b: 'Evaluates reactive triggers server-side on every memory event. Fires actions based on event type, memory type, namespace, and heat.' },
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


        {/* ── 2. Signal Sources ─────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="signals" icon={<TbDatabase size={20} />} title="Signal Sources"
            sub="Six lifecycle actions that generate training data" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D4AF37]/20">
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Action</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Signal</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Source Tag</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Confidence</th>
                  <th className="text-left py-3 text-[#888] font-semibold uppercase tracking-wider">Requires</th>
                </tr>
              </thead>
              <tbody className="text-[#aaa]">
                {([
                  ['Store + train_on_this=true',            'accept',      'train_on_this', 'Explicit',      'Plugin ≥ 3.9.0'],
                  ['Delete + train=true',                   'reject',      'agent_delete',  'High',          'Plugin ≥ 3.11.0'],
                  ['Reclassify + train_on_this=true',       'reclassify',  'train_on_this', 'Explicit',      'Any version'],
                  ['Pin (is_pinned=true)',                   'accept',      'pin',           'High',          'Server-side only'],
                  ['Manual Boost (heat change)',             'accept',      'boost',         'Medium',        'Server-side only'],
                  ['Update + train_on_this=true',            'accept',      'train_on_this', 'Reinforcement', 'Any version'],
                ] as [string, string, string, string, string][]).map(([action, signal, source, conf, req]) => (
                  <tr key={action} className="border-b border-[#1a2a3a]">
                    <td className="py-2.5 pr-4 font-mono text-[#ededed]">{action}</td>
                    <td className="py-2.5 pr-4">
                      <Chip label={signal} variant={signal === 'reject' ? 'red' : signal === 'reclassify' ? 'gold' : 'green'} />
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-[#00F0FF]">{source}</td>
                    <td className="py-2.5 pr-4 text-[#D4AF37]">{conf}</td>
                    <td className="py-2.5 text-[#666]">{req}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#555] mt-3">
            <strong>Note:</strong> Auto recall boost (heat increase on search hit) intentionally does{' '}
            <em>not</em> generate training signals — it would flood the table with low-value data.
          </p>
        </section>


        {/* ── 3. How It Works ───────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="how" icon={<TbBrain size={20} />} title="How It Works"
            sub="Two models, two jobs — quality gate and type classifier" />

          <div className="space-y-6">
            {/* SIVU */}
            <div className="border border-[#00F0FF]/10 p-5">
              <div className="flex items-center gap-2 mb-3">
                <TbShieldCheck size={16} className="text-[#00F0FF]" />
                <code className="text-[#00F0FF] font-mono text-sm font-bold">SIVU</code>
                <span className="text-xs text-[#666]">— Store Intelligence Validator Unit</span>
              </div>
              <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-3">
                <p>
                  SIVU scores <code className="text-[#00F0FF] text-xs">base_utility</code> (0–1)
                  on every store. This determines how &quot;useful&quot; a memory is, which influences
                  its effective starting heat in the thermodynamic engine. It learns from two
                  signal types:
                </p>
                <ul className="text-sm text-[#aaa] space-y-1">
                  <li>
                    <Chip label="accept" variant="green" />{' '}
                    <span className="ml-2">Content like this <strong className="text-white">should</strong> be stored (high utility)</span>
                  </li>
                  <li>
                    <Chip label="reject" variant="red" />{' '}
                    <span className="ml-2">Content like this <strong className="text-white">should not</strong> be stored (low utility/noise)</span>
                  </li>
                </ul>
                <p>
                  Higher-confidence signals (pin, explicit delete) are weighted more heavily during
                  retraining. A pinned memory is a strong &quot;yes, this matters&quot; signal. A
                  deleted memory with <code className="text-[#00F0FF] text-xs">train=true</code> is
                  a strong &quot;no, this was junk.&quot;
                </p>
              </div>
            </div>

            {/* SICU */}
            <div className="border border-[#00F0FF]/10 p-5">
              <div className="flex items-center gap-2 mb-3">
                <TbTag size={16} className="text-[#D4AF37]" />
                <code className="text-[#D4AF37] font-mono text-sm font-bold">SICU</code>
                <span className="text-xs text-[#666]">— Store Intelligence Classifier Unit</span>
              </div>
              <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-3">
                <p>
                  SICU classifies each memory into its correct type (episodic, semantic,
                  procedural, preference, fact). It <strong className="text-white">respects explicit
                  agent types</strong> and acts as a fallback classifier when no type is provided.
                  It learns from <Chip label="reclassify" variant="gold" /> signals — explicit
                  corrections where an agent or user says &quot;this was labeled{' '}
                  <code className="text-[#00F0FF] text-xs">episodic</code> but should be{' '}
                  <code className="text-[#00F0FF] text-xs">procedural</code>.&quot;
                </p>
                <p>
                  These are the <strong className="text-[#D4AF37]">highest-value signals</strong> in
                  the entire training pipeline because they represent direct human/agent corrections
                  to the model&apos;s output. SICU intentionally does not reclassify preference-like
                  content stored with explicit types — conservative and correct.
                </p>
              </div>
            </div>

            {/* SILU */}
            <div className="border border-[#00F0FF]/10 p-5">
              <div className="flex items-center gap-2 mb-3">
                <TbDatabase size={16} className="text-[#00F0FF]" />
                <code className="text-[#00F0FF] font-mono text-sm font-bold">SILU</code>
                <span className="text-xs text-[#666]">— Store Intelligence Labeling Unit</span>
              </div>
              <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-3">
                <p>
                  SILU runs entity extraction via <strong className="text-white">GPT-5.4-nano</strong>{' '}
                  on every store. It extracts entities and relationships from memory content,
                  building entity–relation–entity triples that populate the{' '}
                  <strong className="text-[#D4AF37]">Apache AGE knowledge graph</strong>.
                  This happens automatically — no configuration required.
                </p>
                <p>
                  The AGE graph is self-healing: every store, recall, and entity extraction
                  writes to AGE automatically. SILU is the bridge between raw text memories
                  and structured graph relationships.
                </p>
              </div>
            </div>

            {/* Automatic vs Explicit */}
            <div className="border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-5 rounded">
              <h3 className="text-sm font-bold text-[#D4AF37] mb-3">Automatic vs Explicit Signals</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-[#888] uppercase tracking-wider mb-2">Automatic (no flag needed)</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <TbPin size={14} className="text-[#D4AF37]" />
                      <span className="text-sm text-[#ccc]"><strong>Pin</strong> — always generates signal</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TbArrowUp size={14} className="text-[#D4AF37]" />
                      <span className="text-sm text-[#ccc]"><strong>Boost</strong> — always generates signal</span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-[#888] uppercase tracking-wider mb-2">Explicit (opt-in required)</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <TbFlame size={14} className="text-[#00F0FF]" />
                      <span className="text-sm text-[#ccc]"><strong>Store</strong> — <code className="text-[#00F0FF] text-xs">train_on_this=true</code></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TbTrash size={14} className="text-[#00F0FF]" />
                      <span className="text-sm text-[#ccc]"><strong>Delete</strong> — <code className="text-[#00F0FF] text-xs">train=true</code></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TbTag size={14} className="text-[#00F0FF]" />
                      <span className="text-sm text-[#ccc]"><strong>Reclassify</strong> — <code className="text-[#00F0FF] text-xs">train_on_this=true</code></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TbBook size={14} className="text-[#00F0FF]" />
                      <span className="text-sm text-[#ccc]"><strong>Update</strong> — <code className="text-[#00F0FF] text-xs">train_on_this=true</code></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>


        {/* ── 4. Code Examples ──────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="code" icon={<TbCode size={20} />} title="Code Examples"
            sub="Python and Node.js SDK usage for every training action" />

          <div className="space-y-10">
            {/* Store */}
            <div>
              <h3 className="text-sm font-bold text-[#ededed] mb-1 flex items-center gap-2">
                <TbFlame size={16} className="text-[#D4AF37]" />
                Store with Training
              </h3>
              <p className="text-xs text-[#666] mb-3">
                Teaches SIVU that content like this should be accepted.
              </p>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-[#D4AF37] uppercase tracking-wider mb-2">Python</p>
                  <CodeBlock code={PYTHON_STORE} lang="python" />
                </div>
                <div>
                  <p className="text-xs text-[#D4AF37] uppercase tracking-wider mb-2">Node.js</p>
                  <CodeBlock code={NODE_STORE} lang="typescript" />
                </div>
              </div>
            </div>

            {/* Delete */}
            <div>
              <h3 className="text-sm font-bold text-[#ededed] mb-1 flex items-center gap-2">
                <TbTrash size={16} className="text-[#D4AF37]" />
                Delete with Training
              </h3>
              <p className="text-xs text-[#666] mb-3">
                Snapshots the content before deletion. Teaches SIVU to reject similar content in future.
              </p>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-[#D4AF37] uppercase tracking-wider mb-2">Python</p>
                  <CodeBlock code={PYTHON_DELETE} lang="python" />
                </div>
                <div>
                  <p className="text-xs text-[#D4AF37] uppercase tracking-wider mb-2">Node.js</p>
                  <CodeBlock code={NODE_DELETE} lang="typescript" />
                </div>
              </div>
            </div>

            {/* Reclassify */}
            <div>
              <h3 className="text-sm font-bold text-[#ededed] mb-1 flex items-center gap-2">
                <TbTag size={16} className="text-[#D4AF37]" />
                Reclassify with Training
              </h3>
              <p className="text-xs text-[#666] mb-3">
                The highest-value signal — corrects the type classifier with explicit human/agent feedback.
              </p>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-[#D4AF37] uppercase tracking-wider mb-2">Python</p>
                  <CodeBlock code={PYTHON_RECLASSIFY} lang="python" />
                </div>
                <div>
                  <p className="text-xs text-[#D4AF37] uppercase tracking-wider mb-2">Node.js</p>
                  <CodeBlock code={NODE_RECLASSIFY} lang="typescript" />
                </div>
              </div>
            </div>

            {/* Pin */}
            <div>
              <h3 className="text-sm font-bold text-[#ededed] mb-1 flex items-center gap-2">
                <TbPin size={16} className="text-[#D4AF37]" />
                Pin (Auto-Trains)
              </h3>
              <p className="text-xs text-[#666] mb-3">
                No flag needed. Pinning always generates a high-confidence accept signal.
              </p>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-[#D4AF37] uppercase tracking-wider mb-2">Python</p>
                  <CodeBlock code={PYTHON_PIN} lang="python" />
                </div>
                <div>
                  <p className="text-xs text-[#D4AF37] uppercase tracking-wider mb-2">Node.js</p>
                  <CodeBlock code={NODE_PIN} lang="typescript" />
                </div>
              </div>
            </div>

            {/* Boost */}
            <div>
              <h3 className="text-sm font-bold text-[#ededed] mb-1 flex items-center gap-2">
                <TbArrowUp size={16} className="text-[#D4AF37]" />
                Boost (Auto-Trains)
              </h3>
              <p className="text-xs text-[#666] mb-3">
                No flag needed. Manual heat changes always generate a medium-confidence accept signal.
              </p>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-[#D4AF37] uppercase tracking-wider mb-2">Python</p>
                  <CodeBlock code={PYTHON_BOOST} lang="python" />
                </div>
                <div>
                  <p className="text-xs text-[#D4AF37] uppercase tracking-wider mb-2">Node.js</p>
                  <CodeBlock code={NODE_BOOST} lang="typescript" />
                </div>
              </div>
            </div>
          </div>
        </section>


        {/* ── 5. REST API Reference ─────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="rest" icon={<TbServer size={20} />} title="REST API Reference"
            sub="Raw HTTP calls for every training action" />

          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5 mb-6">
            {([
              ['POST',   '/api/v1/agent/nodes',              'Store with train_on_this=true'],
              ['DELETE', '/api/v1/agent/nodes/:id?train=true','Delete with reject signal'],
              ['PATCH',  '/api/v1/agent/nodes/:id',          'Reclassify with train_on_this=true'],
              ['PATCH',  '/api/v1/agent/nodes/:id (pin)',    'Pin — auto-generates accept signal'],
              ['PATCH',  '/api/v1/agent/nodes/:id (heat)',   'Boost — auto-generates accept signal'],
              ['GET',    '/api/v2/siu/training-data',        'Export accumulated training signals'],
            ] as [string, string, string][]).map(([method, path, desc]) => (
              <div key={path + method} className="flex items-center gap-3 px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                <MethodBadge method={method} />
                <code className="text-sm text-[#ccc] font-mono flex-1">{path}</code>
                <span className="text-xs text-[#666] hidden md:block">{desc}</span>
              </div>
            ))}
          </div>

          <div className="space-y-6">
            <div>
              <p className="text-sm text-[#888] mb-2">Store with training signal</p>
              <CodeBlock code={REST_STORE} lang="bash" />
            </div>
            <div>
              <p className="text-sm text-[#888] mb-2">Delete with training signal</p>
              <CodeBlock code={REST_DELETE} lang="bash" />
            </div>
            <div>
              <p className="text-sm text-[#888] mb-2">Reclassify with training signal</p>
              <CodeBlock code={REST_RECLASSIFY} lang="bash" />
            </div>
            <div>
              <p className="text-sm text-[#888] mb-2">Pin (auto-generates signal)</p>
              <CodeBlock code={REST_PIN} lang="bash" />
            </div>
            <div>
              <p className="text-sm text-[#888] mb-2">Manual boost (auto-generates signal)</p>
              <CodeBlock code={REST_BOOST} lang="bash" />
            </div>
          </div>
        </section>


        {/* ── 6. Signal Table Schema ────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="schema" icon={<TbDatabase size={20} />} title="Signal Table Schema"
            sub="Where training signals accumulate before retraining" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              All training signals land in the <code className="text-[#00F0FF]">training_signals</code>{' '}
              table. Each row captures the memory content at time of signal, the signal type, the
              source action, and — for reclassify signals — both the predicted and corrected types.
            </p>
          </div>
          <CodeBlock code={SCHEMA_SQL} lang="sql" />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D4AF37]/20">
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Column</th>
                  <th className="text-left py-3 text-[#888] font-semibold uppercase tracking-wider">Purpose</th>
                </tr>
              </thead>
              <tbody className="text-[#aaa]">
                {([
                  ['signal_type',     'accept, reject, or reclassify — determines which model consumes it'],
                  ['corrected_store', 'For SIVU: true = should store, false = should reject'],
                  ['corrected_type',  'For SICU: the correct memory type (set during reclassify)'],
                  ['predicted_type',  'What the model originally predicted (if available)'],
                  ['content_snapshot','Full content at time of signal — survives deletion'],
                  ['source',          'What generated this signal: train_on_this, agent_delete, pin, boost'],
                ] as [string, string][]).map(([col, desc]) => (
                  <tr key={col} className="border-b border-[#1a2a3a]">
                    <td className="py-2.5 pr-4 font-mono text-[#00F0FF]">{col}</td>
                    <td className="py-2.5">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>


        {/* ── 7. Retraining Pipeline ────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="pipeline" icon={<TbRefresh size={20} />} title="Retraining Pipeline"
            sub="From accumulated signals to improved models" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              Training signals accumulate in the database. When enough have built up, the SIU
              models can be retrained to incorporate the new corrections. The pipeline is
              currently manual — automation is planned.
            </p>
          </div>
          <CodeBlock code={RETRAIN_STEPS} lang="bash" />
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 text-[#00F0FF] mb-2">
                <TbDatabase size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Signals Accumulate</span>
              </div>
              <p className="text-xs text-[#888] leading-relaxed">
                Every store, delete, reclassify, pin, and boost adds a row to the training table.
                No action needed — they build up naturally as agents use their memory.
              </p>
            </div>
            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 text-[#00F0FF] mb-2">
                <TbRefresh size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Manual Retrain</span>
              </div>
              <p className="text-xs text-[#888] leading-relaxed">
                Export signals via the API, run training scripts for SIVU and SICU, deploy new
                ONNX models. Server picks them up on restart. Automated retraining is on the roadmap.
              </p>
            </div>
          </div>
        </section>


        {/* ── 8. Version History ─────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="versions" icon={<TbBook size={20} />} title="Version History"
            sub="When each training capability was introduced" />
          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
            {([
              ['3.9.0',                'train_on_this on store, update, and reclassify'],
              ['3.10.0',               'SIU v2 junk filter, autoCapture quality gate'],
              ['3.11.1 (current)',      'memory_delete tool with SIVU reject training; openclaw-sulcus v3.11.1'],
              ['Server v2.0.0',        'Pin and boost auto-generate training signals (no plugin update needed)'],
              ['Server v2.1.0',        'SILU entity extraction via GPT-5.4-nano, Apache AGE graph, SITU trigger evaluation, age_graph capability'],
            ] as [string, string][]).map(([ver, desc]) => (
              <div key={ver} className="flex items-center gap-4 px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                <code className="text-[#D4AF37] font-mono text-xs w-32 shrink-0">{ver}</code>
                <span className="text-sm text-[#aaa]">{desc}</span>
              </div>
            ))}
          </div>
        </section>


        {/* ── OpenClaw Plugin Tools ──────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="plugin" icon={<TbCode size={20} />} title="OpenClaw Plugin Tools"
            sub="Which tools generate training signals and which don't" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D4AF37]/20">
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Tool</th>
                  <th className="text-left py-3 pr-4 text-[#888] font-semibold uppercase tracking-wider">Parameters</th>
                  <th className="text-left py-3 text-[#888] font-semibold uppercase tracking-wider">Training</th>
                </tr>
              </thead>
              <tbody className="text-[#aaa]">
                {([
                  ['memory_store',        'content, memory_type, train',          'train=true → accept signal'],
                  ['memory_delete',       'id, train',                            'train=true (default) → reject signal'],
                  ['memory_recall',       'query, limit, namespace',              'No training signal'],
                  ['consolidate',         'min_heat',                             'No training signal'],
                  ['evaluate_triggers',   'event, context_json',                  'No training signal'],
                ] as [string, string, string][]).map(([tool, params, training]) => (
                  <tr key={tool} className="border-b border-[#1a2a3a]">
                    <td className="py-2.5 pr-4 font-mono text-[#00F0FF]">{tool}</td>
                    <td className="py-2.5 pr-4 text-[#ccc]">{params}</td>
                    <td className="py-2.5">{training}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>


        {/* ── Footer CTA ────────────────────────────────────────────────── */}
        <div className="border-t border-[#D4AF37]/20 mt-12 pt-10">
          <h2 className="text-xl font-bold text-[#ededed] mb-3">Your memory, self-improving.</h2>
          <p className="text-[#888] text-sm leading-relaxed mb-6">
            Training signals are available in the Sulcus SDK, OpenClaw plugin, and REST API.
            Start with <code className="text-[#00F0FF] text-xs">train=true</code> on your next
            store call — one flag, and your quality gate starts learning from your agents.
          </p>
          <div className="flex flex-col md:flex-row gap-4">
            <a href="https://sulcus.ca/dashboard" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Try It Now &rarr;
            </a>
            <Link href="/docs" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Back to Docs &rarr;
            </Link>
            <Link href="/docs/triggers" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Reactive Triggers &rarr;
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}