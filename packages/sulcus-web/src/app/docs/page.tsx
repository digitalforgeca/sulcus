'use client';

import Link from 'next/link';
import { SiteNav } from '@/components/site-nav';

const PYTHON_QUICKSTART = `from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Store memories with full lifecycle control
client.remember("User prefers dark mode", memory_type="preference",
    decay_class="slow",       # slow decay — preferences persist
    is_pinned=True,           # pinned — never decays
    min_heat=0.3,             # floor heat — never goes below 0.3
    key_points=["dark mode", "UI preference"])

client.remember("API rate limit is 1000/min", memory_type="semantic")

# Search
results = client.search("dark mode")
for m in results:
    print(f"[{m.memory_type}] {m.pointer_summary} (heat: {m.current_heat:.2f}")

# Recall feedback — reinforces good memories, penalizes bad ones
client.feedback(results[0].id, "relevant")    # boosts heat + stability
client.feedback(results[1].id, "outdated")    # marks as superseded

# List with filters
memories = client.list(page=1, page_size=10, memory_type="preference")

# Pin / unpin
client.pin(memories[0].id)
client.unpin(memories[0].id)

# Bulk operations
client.bulk_update(["id-1", "id-2"], is_pinned=True, heat=0.9)
client.bulk_delete(memory_type="episodic", namespace="old-session")

# Analytics
analytics = client.recall_analytics()
print(analytics["suggestions"])  # tuning recommendations based on feedback patterns`;

const NODE_QUICKSTART = `import { Sulcus } from "sulcus";

const client = new Sulcus({ apiKey: "sk-..." });

// Store memories with full lifecycle control
await client.remember("User prefers dark mode", {
  memoryType: "preference",
  decayClass: "slow",       // slow decay — preferences persist
  isPinned: true,           // pinned — never decays
  minHeat: 0.3,             // floor heat — never goes below 0.3
  keyPoints: ["dark mode", "UI preference"],
});

await client.remember("API rate limit is 1000/min", { memoryType: "semantic" });

// Search
const results = await client.search("dark mode");
for (const m of results) {
  console.log(\`[\${m.memory_type}] \${m.pointer_summary} (heat: \${m.current_heat.toFixed(2)})\`);
}

// Recall feedback — reinforces good memories, penalizes bad ones
await client.feedback(results[0].id, "relevant");    // boosts heat + stability
await client.feedback(results[1].id, "outdated");    // marks as superseded

// List with filters
const memories = await client.list({ page: 1, pageSize: 10, memoryType: "preference" });

// Bulk operations
await client.bulkUpdate(["id-1", "id-2"], { isPinned: true, heat: 0.9 });
await client.bulkDelete({ memoryType: "episodic", namespace: "old-session" });

// Analytics & tuning suggestions
const analytics = await client.recallAnalytics();
console.log(analytics.suggestions);`;

const PYTHON_ASYNC = `import asyncio
from sulcus import AsyncSulcus

async def main():
    async with AsyncSulcus(api_key="sk-...") as client:
        await client.remember("async memory", memory_type="semantic")
        results = await client.search("async")
        print(results)

asyncio.run(main())`;

const SELF_HOSTED = `# Python
client = Sulcus(api_key="your-key", base_url="http://localhost:4200")

# Node.js
const client = new Sulcus({ apiKey: "your-key", baseUrl: "http://localhost:4200" });`;

const MCP_EXAMPLE = `# Claude Desktop — add to claude_desktop_config.json:
{
  "mcpServers": {
    "sulcus": {
      "url": "https://api.sulcus.ca/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer sk-your-api-key"
      }
    }
  }
}`;

const REST_EXAMPLE = `# Create a memory
curl -X POST https://api.sulcus.ca/api/v1/agent/nodes \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{"label": "User prefers dark mode", "memory_type": "preference"}'

# Search memories
curl -X POST https://api.sulcus.ca/api/v1/agent/search \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{"query": "dark mode", "limit": 10}'

# List memories
curl https://api.sulcus.ca/api/v1/agent/nodes?page=1&page_size=10 \\
  -H "Authorization: Bearer sk-..."`;

const TRIGGERS_PYTHON = `# Reactive Triggers — automate memory lifecycle
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Auto-pin every preference memory
client.create_trigger(
    event="on_store",
    action="pin",
    name="auto-pin-preferences",
    filter_memory_type="preference"
)

# Boost memories every time they're recalled (spaced repetition)
client.create_trigger(
    event="on_recall",
    action="boost",
    name="reinforce-on-recall",
    action_config={"strength": 0.15}
)

# Webhook when critical memory starts cooling
client.create_trigger(
    event="on_threshold",
    action="webhook",
    name="alert-cold-procedures",
    filter_memory_type="procedural",
    filter_heat_below=0.3,
    action_config={"url": "https://hooks.slack.com/your-webhook"}
)

# List active triggers
triggers = client.list_triggers()
for t in triggers:
    print(f"{t['name']}: {t['event']} → {t['action']} (fired {t['fire_count']}x)")`;

const TRIGGERS_NODE = `import { Sulcus } from "sulcus";

const client = new Sulcus({ apiKey: "sk-..." });

// Auto-pin every preference memory
await client.createTrigger("on_store", "pin", {
  name: "auto-pin-preferences",
  filterMemoryType: "preference",
});

// Boost memories every time they're recalled
await client.createTrigger("on_recall", "boost", {
  name: "reinforce-on-recall",
  actionConfig: { strength: 0.15 },
});

// Webhook when critical memory starts cooling
await client.createTrigger("on_threshold", "webhook", {
  name: "alert-cold-procedures",
  filterMemoryType: "procedural",
  filterHeatBelow: 0.3,
  actionConfig: { url: "https://hooks.slack.com/your-webhook" },
});

// Check trigger history
const history = await client.triggerHistory();
for (const h of history) {
  console.log(\`\${h.event} → \${h.action} at \${h.fired_at}\`);
}`;

const TRIGGERS_REST = `# Create a trigger
curl -X POST https://api.sulcus.ca/api/v1/triggers \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "auto-pin-preferences",
    "event": "on_store",
    "action": "pin",
    "filter_memory_type": "preference"
  }'

# List triggers
curl https://api.sulcus.ca/api/v1/triggers \\
  -H "Authorization: Bearer sk-..."

# Delete a trigger
curl -X DELETE https://api.sulcus.ca/api/v1/triggers/{id} \\
  -H "Authorization: Bearer sk-..."`;

const OPENCLAW_CONFIG = `// ~/.openclaw/openclaw.json
{
  "plugins": {
    "slots": { "memory": "memory-sulcus" },
    "entries": {
      "memory-sulcus": {
        "enabled": true,
        "config": {
          "serverUrl": "https://api.sulcus.ca",
          "apiKey": "YOUR_API_KEY",
          "agentId": "my-agent",
          "namespace": "my-agent",
          "autoRecall": true,
          "autoCapture": true
        }
      }
    }
  }
}`;

const OPENCLAW_INSTALL = `# 1. Create the plugin directory
mkdir -p ~/.openclaw/extensions/memory-sulcus

# 2. Download the plugin from the Sulcus repo
git clone https://github.com/digitalforgeca/sulcus.git /tmp/sulcus
cp /tmp/sulcus/packages/openclaw-sulcus/* ~/.openclaw/extensions/memory-sulcus/

# 3. Install dependencies
cd ~/.openclaw/extensions/memory-sulcus && npm install

# 4. Verify discovery
openclaw plugins list
# → Memory (Sulcus) | memory-sulcus | disabled

# 5. Enable and restart
openclaw plugins enable memory-sulcus
openclaw restart`;

const MEMORY_TYPES = [
  { type: 'episodic', desc: 'Events, conversations, time-bound experiences', decay: 'Fast', example: '"Met with design team, decided on blue theme"' },
  { type: 'semantic', desc: 'Facts, knowledge, definitions', decay: 'Slow', example: '"Python 3.12 requires typing_extensions >= 4.0"' },
  { type: 'preference', desc: 'User preferences, settings, opinions', decay: 'Medium', example: '"User prefers dark mode and monospace fonts"' },
  { type: 'procedural', desc: 'How-to knowledge, workflows, recipes', decay: 'Slow', example: '"To deploy: git push, then az acr build, then update app"' },
  { type: 'moment', desc: 'Personality-defining interactions, relationship dynamics', decay: 'Glacial', example: '"User laughed and said \'that\'s why I trust you\'"' },
];

const DECAY_CLASSES = [
  { cls: 'fast', halfLife: '~2 hours', use: 'Ephemeral context, short-lived tasks' },
  { cls: 'normal', halfLife: '~24 hours', use: 'Standard memories (default)' },
  { cls: 'slow', halfLife: '~7 days', use: 'Important facts, preferences' },
  { cls: 'glacial', halfLife: '~30 days', use: 'Core identity, relationships, moments' },
];

const API_ENDPOINTS = [
  { method: 'POST', path: '/api/v1/agent/nodes', desc: 'Create a memory node' },
  { method: 'GET', path: '/api/v1/agent/nodes', desc: 'List memories (paginated)' },
  { method: 'GET', path: '/api/v1/agent/nodes/:id', desc: 'Get a single memory' },
  { method: 'PATCH', path: '/api/v1/agent/nodes/:id', desc: 'Update a memory' },
  { method: 'DELETE', path: '/api/v1/agent/nodes/:id', desc: 'Delete a memory' },
  { method: 'POST', path: '/api/v1/agent/search', desc: 'Text search memories' },
  { method: 'GET', path: '/api/v1/agent/hot_nodes', desc: 'List hottest memories' },
  { method: 'POST', path: '/api/v1/agent/nodes/bulk-patch', desc: 'Bulk update memories (shared patch or per-node)' },
  { method: 'POST', path: '/api/v1/agent/nodes/bulk', desc: 'Bulk delete by IDs, type, or namespace' },
  { method: 'POST', path: '/api/v1/agent/sync', desc: 'CRDT sync (push/pull ops)' },
  { method: 'GET', path: '/api/v1/metrics', desc: 'Storage & health metrics' },
  { method: 'GET', path: '/api/v1/org', desc: 'Tenant/org info & limits' },
  { method: 'GET', path: '/api/v1/keys', desc: 'List API keys' },
  { method: 'POST', path: '/api/v1/keys', desc: 'Generate new API key' },
  { method: 'GET', path: '/api/v1/settings/thermo', desc: 'Get thermodynamic engine config' },
  { method: 'PATCH', path: '/api/v1/settings/thermo', desc: 'Update thermodynamic engine config' },
  { method: 'POST', path: '/api/v1/feedback', desc: 'Recall quality feedback (relevant/irrelevant/outdated)' },
  { method: 'GET', path: '/api/v1/analytics/recall', desc: 'Recall analytics with tuning suggestions' },
  { method: 'GET', path: '/api/v1/activity', desc: 'Activity log (paginated, cursor-based)' },
  { method: 'GET', path: '/api/v1/gamification/profile', desc: 'XP, level, badges, streaks' },
  { method: 'GET', path: '/api/v1/triggers', desc: 'List active triggers' },
  { method: 'POST', path: '/api/v1/triggers', desc: 'Create a reactive trigger' },
  { method: 'PATCH', path: '/api/v1/triggers/:id', desc: 'Update a trigger' },
  { method: 'DELETE', path: '/api/v1/triggers/:id', desc: 'Delete a trigger' },
  { method: 'GET', path: '/api/v1/triggers/history', desc: 'Trigger firing history' },
  { method: 'POST', path: '/mcp', desc: 'MCP Streamable HTTP (JSON-RPC)' },
  { method: 'GET', path: '/mcp', desc: 'MCP SSE notification stream' },
];

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="relative group">
      <pre className="bg-[#0a1018] border border-[#00F0FF]/10 p-4 overflow-x-auto text-sm font-mono text-[#ccc] leading-relaxed">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2 text-[10px] text-[#555] uppercase tracking-widest">{lang}</div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[#050a0f] text-[#ededed] font-mono selection:bg-[#00F0FF] selection:text-[#050a0f] relative overflow-hidden">
      {/* Background patterns (same as landing) */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-0" style={{ backgroundImage: "linear-gradient(#00F0FF 1px, transparent 1px), linear-gradient(90deg, #00F0FF 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

      <div className="max-w-5xl mx-auto px-6 relative z-10">
        <SiteNav />

        <div className="py-16">
          <h1 className="text-4xl font-bold tracking-tight mb-4 uppercase text-white">Documentation</h1>
          <p className="text-[#888] mb-16 text-lg font-sans">Everything you need to give your AI agents persistent memory.</p>

        {/* Install */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">Install</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">Python</h3>
              <CodeBlock code={`pip install sulcus\n\n# With async support:\npip install sulcus[async]`} lang="bash" />
              <p className="text-xs text-[#555] mt-2">Python 3.9+ · Zero dependencies · Async via optional httpx</p>
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">Node.js</h3>
              <CodeBlock code={`npm install sulcus`} lang="bash" />
              <p className="text-xs text-[#555] mt-2">Node 18+ · Zero dependencies · Full TypeScript support</p>
            </div>
          </div>
        </section>

        {/* Quick Start */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">Quick Start</h2>
          <div className="space-y-8">
            <div>
              <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">Python</h3>
              <CodeBlock code={PYTHON_QUICKSTART} lang="python" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">Node.js / TypeScript</h3>
              <CodeBlock code={NODE_QUICKSTART} lang="typescript" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">Python Async</h3>
              <CodeBlock code={PYTHON_ASYNC} lang="python" />
            </div>
          </div>
        </section>

        {/* Memory Types */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">Memory Types</h2>
          <div className="space-y-4">
            {MEMORY_TYPES.map((t) => (
              <div key={t.type} className="border border-[#00F0FF]/10 p-5 hover:border-[#00F0FF]/30 transition-colors">
                <div className="flex items-center gap-4 mb-2">
                  <code className="text-[#00F0FF] font-mono text-sm">{t.type}</code>
                  <span className="text-[10px] text-[#D4AF37] uppercase tracking-widest">Decay: {t.decay}</span>
                </div>
                <p className="text-sm text-[#aaa] mb-1">{t.desc}</p>
                <p className="text-xs text-[#555] font-mono">{t.example}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Decay Classes & Lifecycle */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">Memory Lifecycle Control</h2>
          <p className="text-[#888] mb-6">
            Every memory has a heat value that decays over time. You control the speed, the floor, and the permanence.
          </p>

          <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-4">Decay Classes</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {DECAY_CLASSES.map((d) => (
              <div key={d.cls} className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors">
                <div className="flex items-center gap-3 mb-1">
                  <code className="text-[#00F0FF] font-mono text-sm">{d.cls}</code>
                  <span className="text-[10px] text-[#D4AF37] uppercase tracking-widest">Half-life: {d.halfLife}</span>
                </div>
                <p className="text-xs text-[#888]">{d.use}</p>
              </div>
            ))}
          </div>

          <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-4">Lifecycle Parameters</h3>
          <div className="space-y-3">
            <div className="border border-[#00F0FF]/10 p-4">
              <code className="text-[#00F0FF] font-mono text-sm">is_pinned</code>
              <p className="text-xs text-[#888] mt-1">Prevents ALL heat decay. Memory stays hot forever. Use for core identity, rules, permanent preferences.</p>
            </div>
            <div className="border border-[#00F0FF]/10 p-4">
              <code className="text-[#00F0FF] font-mono text-sm">min_heat</code>
              <p className="text-xs text-[#888] mt-1">Floor value (0.0–1.0). Memory decays but never drops below this. Ensures minimum recall priority.</p>
            </div>
            <div className="border border-[#00F0FF]/10 p-4">
              <code className="text-[#00F0FF] font-mono text-sm">decay_class</code>
              <p className="text-xs text-[#888] mt-1">Override the default decay speed for this memory type. Options: fast, normal, slow, glacial.</p>
            </div>
            <div className="border border-[#00F0FF]/10 p-4">
              <code className="text-[#00F0FF] font-mono text-sm">key_points</code>
              <p className="text-xs text-[#888] mt-1">Structured metadata — list of key takeaways. Improves search relevance and context building.</p>
            </div>
          </div>
        </section>

        {/* MCP Integration */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">MCP Integration</h2>
          <p className="text-[#888] mb-6">
            Sulcus speaks MCP (Model Context Protocol) natively. Connect any MCP-compatible client — Claude Desktop, 
            OpenAI agents, custom hosts — directly to your memory graph.
          </p>
          <CodeBlock code={MCP_EXAMPLE} lang="json" />
          <p className="text-xs text-[#555] mt-3">
            29 MCP tools available: search_memory, commit_memory, record_memory, build_context, list_hot_nodes, 
            tick, prune_cold_memories, forget_memory, page_in, compact_wal, sync_now, create_trigger, list_triggers,
            update_trigger, delete_trigger, trigger_history, and more.
          </p>
        </section>

        {/* Reactive Triggers */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#FF6B35] mb-8 tracking-tight">Reactive Triggers</h2>
          <p className="text-[#888] mb-6">
            Set rules on your memory graph. When events happen — a memory is stored, recalled, boosted, or decays — Sulcus fires actions automatically.
            No competitor has this. Triggers run server-side and locally, fire during MCP tool calls, and surface notifications inline.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            {[
              { event: 'on_store', desc: 'New memory created' },
              { event: 'on_recall', desc: 'Memory searched/recalled' },
              { event: 'on_boost', desc: 'Memory heat increased' },
              { event: 'on_relate', desc: 'Edge created between memories' },
              { event: 'on_decay', desc: 'Heat dropped during tick' },
              { event: 'on_threshold', desc: 'Heat crosses boundary' },
            ].map((e) => (
              <div key={e.event} className="border border-[#1a2a3a] p-3 bg-[#0a1520]/20">
                <code className="text-[#FF6B35] text-xs font-mono">{e.event}</code>
                <p className="text-[10px] text-[#666] mt-1">{e.desc}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-8">
            {['pin', 'boost', 'tag', 'deprecate', 'notify', 'webhook', 'chain (v2)'].map((a) => (
              <div key={a} className="text-center border border-[#222] p-2">
                <code className="text-[#D4AF37] text-xs">{a}</code>
              </div>
            ))}
          </div>

          <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">Python</h3>
          <CodeBlock code={TRIGGERS_PYTHON} lang="python" />
          <div className="h-4" />
          <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">Node.js</h3>
          <CodeBlock code={TRIGGERS_NODE} lang="typescript" />
          <div className="h-4" />
          <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">REST API</h3>
          <CodeBlock code={TRIGGERS_REST} lang="bash" />
        </section>

        {/* REST API */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">REST API</h2>
          <p className="text-[#888] mb-6">
            Base URL: <code className="text-[#00F0FF]">https://api.sulcus.ca</code>
            <br />Authentication: <code className="text-[#00F0FF]">Authorization: Bearer {'<api-key>'}</code>
          </p>

          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5 mb-8">
            {API_ENDPOINTS.map((ep, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                <span className={`font-mono text-xs w-16 ${
                  ep.method === 'GET' ? 'text-green-400' :
                  ep.method === 'POST' ? 'text-blue-400' :
                  ep.method === 'PATCH' ? 'text-yellow-400' :
                  'text-red-400'
                }`}>{ep.method}</span>
                <code className="text-sm text-[#ccc] font-mono flex-1">{ep.path}</code>
                <span className="text-xs text-[#666]">{ep.desc}</span>
              </div>
            ))}
          </div>

          <h3 className="text-sm font-bold tracking-widest uppercase text-[#D4AF37] mb-3">Examples</h3>
          <CodeBlock code={REST_EXAMPLE} lang="bash" />
        </section>

        {/* Self-Hosted */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">Self-Hosted</h2>
          <p className="text-[#888] mb-6">
            Point any SDK at your own server. The entire stack — server, database, sync — runs on your infrastructure.
          </p>
          <CodeBlock code={SELF_HOSTED} lang="python" />
        </section>

        {/* OpenClaw Integration */}
        <section id="openclaw" className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">OpenClaw Integration</h2>
          <p className="text-[#888] mb-6">
            Sulcus is a native memory backend for <a href="https://github.com/openclaw/openclaw" className="text-[#00F0FF] hover:underline">OpenClaw</a>. 
            Replace file-based memory with thermodynamic memory — your agents get heat-based decay, 
            cross-agent sync, programmable triggers, and auto-recall/capture out of the box.
          </p>

          <div className="mb-8">
            <h3 className="text-lg font-semibold text-white mb-4">Install</h3>
            <CodeBlock code={OPENCLAW_INSTALL} lang="bash" />
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-semibold text-white mb-4">Configure</h3>
            <CodeBlock code={OPENCLAW_CONFIG} lang="json" />
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-semibold text-white mb-4">What you get</h3>
            <div className="space-y-3 text-sm text-[#888]">
              <div className="flex gap-3">
                <span className="text-[#00F0FF] font-mono">memory_search</span>
                <span>Semantic search across all Sulcus memories with heat scores</span>
              </div>
              <div className="flex gap-3">
                <span className="text-[#00F0FF] font-mono">memory_store</span>
                <span>Store new memories with auto-detected type (preference, fact, procedural, etc.)</span>
              </div>
              <div className="flex gap-3">
                <span className="text-[#00F0FF] font-mono">memory_get</span>
                <span>Retrieve specific memories by UUID with auto-boost on recall</span>
              </div>
              <div className="flex gap-3">
                <span className="text-[#00F0FF] font-mono">memory_forget</span>
                <span>Delete memories by ID</span>
              </div>
              <div className="flex gap-3">
                <span className="text-[#00F0FF] font-mono">auto-recall</span>
                <span>Relevant memories injected into context before each agent turn</span>
              </div>
              <div className="flex gap-3">
                <span className="text-[#00F0FF] font-mono">auto-capture</span>
                <span>Important information detected and stored from user messages automatically</span>
              </div>
            </div>
          </div>
        </section>

        {/* Framework Integrations */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">Framework Integrations</h2>
          <p className="text-[#888] mb-6">
            Dedicated packages for popular LLM frameworks. Each wraps the Sulcus API with framework-native abstractions.
          </p>
          <div className="border border-[#00F0FF]/10 divide-y divide-[#00F0FF]/5">
            {[
              { name: 'LangChain', pkg: 'sulcus-langchain', install: 'pip install sulcus-langchain', desc: 'SulcusMemory ChatMessageHistory + retriever', lang: 'Python' },
              { name: 'LlamaIndex', pkg: 'sulcus-llamaindex', install: 'pip install sulcus-llamaindex', desc: 'Memory store + query engine integration', lang: 'Python' },
              { name: 'Vercel AI SDK', pkg: 'sulcus-vercel-ai', install: 'npm install sulcus-vercel-ai', desc: 'LanguageModelV3Middleware for automatic memory', lang: 'TypeScript' },
              { name: 'OpenAI Tools', pkg: '—', install: 'Copy tools.json', desc: 'Function-calling schema for GPT-4, o-series', lang: 'JSON' },
              { name: 'Anthropic Tools', pkg: '—', install: 'Copy tools.json', desc: 'Tool-use schema for Claude API', lang: 'JSON' },
              { name: 'CrewAI', pkg: 'sulcus-crewai', install: 'pip install sulcus-crewai', desc: 'Shared thermodynamic memory for multi-agent crews', lang: 'Python' },
              { name: 'Deep Agents', pkg: 'sulcus-deepagents', install: 'pip install sulcus-deepagents', desc: 'Replace AGENTS.md with thermodynamic memory middleware', lang: 'Python' },
              { name: 'CLI', pkg: 'sulcus-cli', install: 'npm install -g sulcus-cli', desc: 'Terminal interface: search, store, list, pin, forget', lang: 'Node.js' },
              { name: 'OpenClaw', pkg: 'memory-sulcus', install: 'Copy plugin to ~/.openclaw/extensions/', desc: 'Full memory backend: auto-recall, auto-capture, triggers', lang: 'TypeScript' },
              { name: 'VS Code', pkg: 'sulcus-vscode', install: 'Marketplace (coming)', desc: 'Memory sidebar + inline annotations', lang: 'TypeScript' },
            ].map((i, idx) => (
              <div key={idx} className="flex items-center gap-4 px-4 py-3 hover:bg-[#00F0FF]/5 transition-colors">
                <span className="text-sm text-white font-medium w-32">{i.name}</span>
                <code className="text-xs text-[#00F0FF] font-mono flex-1">{i.install}</code>
                <span className="text-xs text-[#666] hidden md:block max-w-[300px]">{i.desc}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-[#555] mt-4">
            Integration packages available on{' '}
            <a href="https://github.com/digitalforgeca/sulcus" className="text-[#00F0FF] hover:underline">
              GitHub
            </a>
            {' '}and{' '}
            <a href="https://www.npmjs.com/package/sulcus" className="text-[#00F0FF] hover:underline">
              npm
            </a>.
          </p>
        </section>

        {/* Links */}
        <section className="border-t border-[#00F0FF]/10 pt-12">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">Resources</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <a href="https://github.com/digitalforgeca/sulcus" className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors block">
              <div className="font-bold text-white mb-1">GitHub</div>
              <div className="text-[#666]">Source code, issues, and contributions</div>
            </a>
            <a href="https://pypi.org/project/sulcus/" className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors block">
              <div className="font-bold text-white mb-1">PyPI</div>
              <div className="text-[#666]">pip install sulcus</div>
            </a>
            <a href="https://www.npmjs.com/package/sulcus" className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors block">
              <div className="font-bold text-white mb-1">npm</div>
              <div className="text-[#666]">npm install sulcus</div>
            </a>
            <Link href="/docs/triggers" className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors block">
              <div className="font-bold text-white mb-1">Reactive Triggers</div>
              <div className="text-[#666]">Rules that fire when memory events happen</div>
            </Link>
            <Link href="/docs/local-panel" className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors block">
              <div className="font-bold text-white mb-1">Local Control Panel</div>
              <div className="text-[#666]">Browse, manage, and configure your local memory</div>
            </Link>
            <Link href="/membench" className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors block">
              <div className="font-bold text-white mb-1">MemBench</div>
              <div className="text-[#666]">Open memory benchmark</div>
            </Link>
            <a href="https://github.com/digitalforgeca/sulcus#integrations" className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors block">
              <div className="font-bold text-white mb-1">Integrations Guide</div>
              <div className="text-[#666]">LangChain, LlamaIndex, Vercel AI, and more</div>
            </a>
          </div>
        </section>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-12 border-t border-[#D4AF37]/20 text-center relative z-10">
        <p className="text-[10px] text-[#2a4a5a] tracking-[0.3em] font-medium uppercase hover:text-[#00F0FF]/50 transition-colors cursor-default">
          Forged by Digital Forge Studios. Tempered by thermodynamics.
        </p>
      </footer>
    </div>
  );
}
