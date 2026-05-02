'use client';

import Link from 'next/link';
import {
  TbArrowLeft, TbTopologyRing, TbBrain, TbCode, TbDatabase,
  TbArrowsExchange, TbSearch, TbShieldCheck, TbBolt,
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

function Chip({ label, variant = 'cyan' }: { label: string; variant?: 'cyan' | 'gold' | 'muted' | 'green' }) {
  const s: Record<string, string> = {
    cyan:  'border-[#00F0FF]/30 text-[#00F0FF] bg-[#00F0FF]/5',
    gold:  'border-[#D4AF37]/30 text-[#D4AF37] bg-[#D4AF37]/5',
    muted: 'border-[#333]/50 text-[#666]',
    green: 'border-green-500/30 text-green-400 bg-green-500/5',
  };
  return (
    <span className={`inline-block border rounded px-2 py-0.5 text-[10px] font-mono ${s[variant]}`}>
      {label}
    </span>
  );
}

const CYPHER_QUERY = `// Find all memories related to "deployment" within 2 hops
MATCH (m:Memory)-[r:RELATES_TO*1..2]-(related:Memory)
WHERE m.label CONTAINS 'deploy'
  AND m.heat > 0.3
RETURN m, r, related
ORDER BY related.heat DESC
LIMIT 20`;

const CYPHER_ENTITY = `// Find all entities extracted from procedural memories
MATCH (m:Memory {memory_type: 'procedural'})-[:HAS_ENTITY]->(e:Entity)
WHERE m.namespace = 'icarus'
RETURN e.name, e.type, COUNT(m) as mention_count
ORDER BY mention_count DESC`;

const CYPHER_TEMPORAL = `// Temporal traversal — find what was known before a date
MATCH (m:Memory)
WHERE m.created_at < '2026-03-01T00:00:00Z'
  AND m.heat > 0.2
  AND m.namespace = 'icarus'
RETURN m.label, m.memory_type, m.heat, m.created_at
ORDER BY m.heat DESC`;

const TRIPLE_EXAMPLE = `// Entity triples extracted by SILU from:
// "Deploy: push to ACR then az containerapp update — Azure project"
//
// Extracted triples:
//   (Memory) --[HAS_ENTITY]--> (Entity: "ACR", type: "service")
//   (Memory) --[HAS_ENTITY]--> (Entity: "az containerapp", type: "tool")
//   (Memory) --[HAS_ENTITY]--> (Entity: "Azure", type: "platform")
//   (Entity: "ACR") --[PART_OF]--> (Entity: "Azure")
//   (Entity: "az containerapp") --[USES]--> (Entity: "ACR")`;

const REST_GRAPH = `# Query the AGE graph via REST
curl -X POST https://api.sulcus.ca/api/v1/graph/query \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "cypher": "MATCH (m:Memory) WHERE m.heat > 0.5 RETURN m.label, m.heat LIMIT 10",
    "namespace": "icarus"
  }'

# Get entity relationships for a memory
curl https://api.sulcus.ca/api/v1/graph/nodes/node_01J.../entities \\
  -H "Authorization: Bearer sk-..."`;

const MCP_GRAPH = `// MCP tool — graph_query
{
  "cypher": "MATCH (m:Memory)-[r:RELATES_TO]-(n:Memory) WHERE m.id = 'node_01J...' RETURN n",
  "namespace": "icarus"
}`;

export default function KnowledgeGraphClient() {
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
            <TbTopologyRing size={28} className="text-[#D4AF37]" />
            <h1 className="text-3xl font-bold tracking-tight">Knowledge Graph (AGE)</h1>
          </div>
          <p className="text-[#888] text-base leading-relaxed">
            Sulcus uses <strong className="text-white">Apache AGE</strong> — a temporal knowledge
            graph extension for PostgreSQL — as the structural backbone for memory relationships.
            Memories are vertices, relationships are edges. Every store, recall, and entity
            extraction writes to AGE automatically. The graph is self-healing.
          </p>
          <p className="text-xs text-[#555] mt-3 tracking-wider uppercase">
            Sulcus v2.1.0 · Apache AGE Knowledge Graph · age_graph capability
          </p>
        </div>
        <div className="border-b border-[#D4AF37]/20 mb-10" />

        {/* TOC */}
        <nav className="mb-12 border border-[#00F0FF]/10 p-5 bg-[#00F0FF]/3 rounded-lg">
          <p className="text-xs text-[#555] uppercase tracking-widest mb-3">On this page</p>
          <ol className="space-y-1.5 text-sm columns-2">
            {([
              ['#overview',   'Overview'],
              ['#silu',       'SILU — Entity Extraction'],
              ['#structure',  'Graph Structure'],
              ['#cypher',     'Cypher Queries'],
              ['#temporal',   'Temporal Traversal'],
              ['#self-healing','Self-Healing Writes'],
              ['#rest',       'REST API'],
              ['#mcp',        'MCP Tools'],
            ] as [string, string][]).map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-[#00F0FF]/70 hover:text-[#00F0FF] transition-colors">{label}</a>
              </li>
            ))}
          </ol>
        </nav>

        {/* ── Overview ───────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="overview" icon={<TbTopologyRing size={20} />} title="Overview"
            sub="A temporal knowledge graph built on Apache AGE — Postgres-native, self-healing" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4">
            <p>
              Every other memory system stores text. Sulcus stores{' '}
              <strong className="text-white">structured knowledge</strong>. The AGE graph
              tracks not just what memories exist, but <em>how they relate to each other</em> — and
              when those relationships were formed.
            </p>
            <p>
              This is fundamentally different from vector similarity (which answers "what is
              near this?") or BM25 text search (which answers "what contains this word?").
              The knowledge graph answers:{' '}
              <strong className="text-[#D4AF37]">"What does the agent know about X,
              and how does X connect to everything else?"</strong>
            </p>
          </div>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: <TbDatabase size={16} />, t: 'Postgres-Native', b: 'Apache AGE runs as a Postgres extension. No separate graph database. Same ACID guarantees. Same backups.' },
              { icon: <TbArrowsExchange size={16} />, t: 'Self-Healing', b: 'Every store, recall, and entity extraction writes to AGE automatically. The graph is always consistent with the memory store.' },
              { icon: <TbSearch size={16} />, t: 'Cypher Queries', b: 'Full Cypher query language. Traverse relationships, filter by heat or type, find paths between memories.' },
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

        {/* ── SILU ───────────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="silu" icon={<TbBrain size={20} />} title="SILU — Entity Extraction"
            sub="Store Intelligence Labeling Unit: GPT-5.4-nano extracts entities and relationships on every store" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              SILU runs automatically on every memory store. It sends the memory content to{' '}
              <strong className="text-white">GPT-5.4-nano</strong> and extracts:
            </p>
            <ul className="text-sm text-[#aaa] space-y-1">
              <li><Chip label="entities" variant="cyan" /> — Named things: people, tools, services, concepts, projects</li>
              <li><Chip label="relationships" variant="gold" /> — How entities relate: USES, PART_OF, RELATES_TO, DEPENDS_ON</li>
              <li><Chip label="triples" variant="green" /> — Entity → Relation → Entity, written to AGE as graph edges</li>
            </ul>
            <p>
              The result: every memory is automatically enriched with structured knowledge. A
              procedural memory about deployment becomes a node connected to &quot;ACR&quot;,
              &quot;Azure&quot;, and &quot;az containerapp&quot; via typed edges.
            </p>
          </div>
          <CodeBlock code={TRIPLE_EXAMPLE} lang="graph" />
        </section>

        {/* ── Graph Structure ────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="structure" icon={<TbDatabase size={20} />} title="Graph Structure"
            sub="Vertex and edge schema — what's stored in the AGE graph" />

          <div className="space-y-4 mb-6">
            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Memory Vertices</span>
                <Chip label="label: Memory" variant="cyan" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed mb-3">
                Every memory node is a vertex in the AGE graph. Properties mirror the memory store:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#D4AF37]/20">
                      <th className="text-left py-2 pr-4 text-[#888] uppercase tracking-wider">Property</th>
                      <th className="text-left py-2 text-[#888] uppercase tracking-wider">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-[#aaa]">
                    {([
                      ['id',           'UUID — matches the memory node ID'],
                      ['label',        'Memory content label (searchable)'],
                      ['memory_type',  'episodic, semantic, procedural, fact, preference'],
                      ['namespace',    'Agent/tenant namespace'],
                      ['heat',         'Current heat value (0–1, updated on tick and recall)'],
                      ['base_utility', 'SIVU utility score (0–1)'],
                      ['created_at',   'ISO timestamp of creation'],
                      ['updated_at',   'ISO timestamp of last update'],
                    ] as [string, string][]).map(([prop, desc]) => (
                      <tr key={prop} className="border-b border-[#1a2a3a]">
                        <td className="py-2 pr-4 font-mono text-[#00F0FF]">{prop}</td>
                        <td className="py-2">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Entity Vertices</span>
                <Chip label="label: Entity" variant="gold" />
              </div>
              <p className="text-sm text-[#aaa] leading-relaxed">
                Named entities extracted by SILU. Properties: <code className="text-[#00F0FF] text-xs">name</code>,{' '}
                <code className="text-[#00F0FF] text-xs">type</code> (person, tool, service, concept, platform),{' '}
                <code className="text-[#00F0FF] text-xs">namespace</code>, <code className="text-[#00F0FF] text-xs">mention_count</code>.
              </p>
            </div>

            <div className="border border-[#00F0FF]/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#ededed]">Edge Types</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {['RELATES_TO', 'HAS_ENTITY', 'PART_OF', 'USES', 'DEPENDS_ON', 'CO_RECALLED'].map((e) => (
                  <div key={e} className="text-center border border-[#1a2a3a] p-2">
                    <code className="text-[#D4AF37] text-xs">{e}</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Cypher Queries ──────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="cypher" icon={<TbCode size={20} />} title="Cypher Queries"
            sub="Full openCypher query language — traverse relationships, filter by heat or type" />
          <div className="space-y-6">
            <div>
              <p className="text-sm text-[#888] mb-2">Find related memories by traversal</p>
              <CodeBlock code={CYPHER_QUERY} lang="cypher" />
            </div>
            <div>
              <p className="text-sm text-[#888] mb-2">Find entities extracted from a memory type</p>
              <CodeBlock code={CYPHER_ENTITY} lang="cypher" />
            </div>
          </div>
        </section>

        {/* ── Temporal Traversal ──────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="temporal" icon={<TbArrowsExchange size={20} />} title="Temporal Traversal"
            sub="Query the graph at a point in time — what did the agent know before a given date?" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              Every vertex and edge carries timestamps. You can traverse the graph at any point
              in time — asking questions like &quot;what did this agent know about deployment before
              the incident?&quot; or &quot;which facts were hot during last quarter?&quot;
            </p>
            <p>
              This is the AGE advantage over pure vector stores:{' '}
              <strong className="text-[#D4AF37]">temporal validity windows</strong>. Not just
              &quot;what is similar&quot; but &quot;what was true at this moment.&quot;
            </p>
          </div>
          <CodeBlock code={CYPHER_TEMPORAL} lang="cypher" />
        </section>

        {/* ── Self-Healing Writes ──────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="self-healing" icon={<TbShieldCheck size={20} />} title="Self-Healing Graph Writes"
            sub="Every memory operation keeps the AGE graph in sync automatically" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              The AGE graph is not a separate system you need to maintain. Every operation
              that touches the memory store also updates the graph:
            </p>
          </div>
          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
            {([
              ['memory_store',   'Creates vertex with all properties; SILU extracts entities and writes triples'],
              ['memory_recall',  'Updates vertex heat in AGE; creates CO_RECALLED edges between co-occurring memories'],
              ['memory_delete',  'Removes vertex and all incident edges; entities are orphaned (not deleted — may be shared)'],
              ['memory_boost',   'Updates heat property on vertex immediately'],
              ['tick (300s)',     'Batch-updates heat on all vertices to match the memory store after decay'],
              ['entity extraction', 'SILU runs asynchronously post-store; adds HAS_ENTITY edges and Entity vertices'],
            ] as [string, string][]).map(([op, desc]) => (
              <div key={op} className="flex items-start gap-4 px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                <code className="text-[#00F0FF] font-mono text-xs w-32 shrink-0 pt-0.5">{op}</code>
                <span className="text-sm text-[#aaa]">{desc}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 rounded">
            <p className="text-xs text-[#D4AF37] leading-relaxed">
              <strong>Zero configuration required.</strong> The AGE graph writes are built into
              the memory engine. When you store a memory via SDK, REST API, MCP, or OpenClaw plugin,
              the graph is updated automatically. The <code className="text-[#D4AF37] text-xs">age_graph: true</code>{' '}
              capability flag in the server status confirms the graph backend is active.
            </p>
          </div>
        </section>

        {/* ── REST API ──────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="rest" icon={<TbCode size={20} />} title="REST API"
            sub="HTTP endpoints for graph queries and entity access" />
          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5 mb-6">
            {([
              ['POST', '/api/v1/graph/query',                    'Execute a Cypher query against the AGE graph'],
              ['GET',  '/api/v1/graph/nodes/:id',                'Get a memory vertex and its edges from AGE'],
              ['GET',  '/api/v1/graph/nodes/:id/entities',       'Get entities extracted from a memory'],
              ['GET',  '/api/v1/graph/entities',                 'List all entities in a namespace'],
              ['GET',  '/api/v1/graph/entities/:name/memories',  'Get all memories that mention an entity'],
            ] as [string, string, string][]).map(([method, path, desc]) => (
              <div key={path} className="flex items-center gap-3 px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                <span className={`font-mono text-xs w-14 shrink-0 ${
                  method === 'GET' ? 'text-green-400' : 'text-blue-400'
                }`}>{method}</span>
                <code className="text-sm text-[#ccc] font-mono flex-1">{path}</code>
                <span className="text-xs text-[#666] hidden md:block">{desc}</span>
              </div>
            ))}
          </div>
          <CodeBlock code={REST_GRAPH} lang="bash" />
        </section>

        {/* ── MCP Tools ────────────────────────────────────────────── */}
        <section className="mb-14">
          <SectionAnchor id="mcp" icon={<TbBolt size={20} />} title="MCP Tools"
            sub="Query the knowledge graph from any MCP-compatible agent" />
          <div className="prose prose-invert prose-sm max-w-none text-[#ccc] leading-relaxed space-y-4 mb-6">
            <p>
              The Sulcus MCP server exposes graph tools alongside the standard memory tools.
              Your agents can traverse the knowledge graph, find related memories, and query
              entity relationships directly from conversation context.
            </p>
          </div>
          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5 mb-6">
            {([
              ['graph_query',          'Execute a Cypher query — returns vertices and edges'],
              ['get_memory_entities',  'Get entities extracted from a specific memory node'],
              ['list_entities',        'List all entities in a namespace with mention counts'],
              ['find_related',         'Traverse RELATES_TO edges from a memory to find connected memories'],
            ] as [string, string][]).map(([tool, desc]) => (
              <div key={tool} className="flex items-center gap-3 px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                <code className="text-[#00F0FF] font-mono text-xs flex-1">{tool}</code>
                <span className="text-xs text-[#666] hidden md:block">{desc}</span>
              </div>
            ))}
          </div>
          <CodeBlock code={MCP_GRAPH} lang="json" />
        </section>

        {/* ── Footer CTA ────────────────────────────────────────────── */}
        <div className="border-t border-[#D4AF37]/20 mt-12 pt-10">
          <h2 className="text-xl font-bold text-[#ededed] mb-3">Memory that knows itself.</h2>
          <p className="text-[#888] text-sm leading-relaxed mb-6">
            The AGE knowledge graph is active in Sulcus v2.1.0. Check your server status
            for <code className="text-[#00F0FF] text-xs">age_graph: true</code> to confirm
            the graph backend is running. No configuration required — store a memory, and
            the graph updates automatically.
          </p>
          <div className="flex flex-col md:flex-row gap-4">
            <a href="https://sulcus.ca/status" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Server Status &rarr;
            </a>
            <Link href="/docs/training" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Training (SILU) &rarr;
            </Link>
            <Link href="/docs/thermodynamic-engine" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Thermodynamic Engine &rarr;
            </Link>
            <Link href="/docs" className="text-[#D4AF37] text-sm uppercase tracking-widest hover:text-[#00F0FF] transition-colors">
              Back to Docs &rarr;
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
