'use client';

import Link from 'next/link';

const PYTHON_QUICKSTART = `from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Store memories
client.remember("User prefers dark mode", memory_type="preference")
client.remember("API rate limit is 1000/min", memory_type="semantic")

# Search
results = client.search("dark mode")
for m in results:
    print(f"[{m.memory_type}] {m.pointer_summary} (heat: {m.current_heat:.2f}")

# List with filters
memories = client.list(page=1, page_size=10, memory_type="preference")

# Pin important memories (prevents heat decay)
client.pin(memories[0].id)

# Update
client.update(memories[0].id, label="Updated content")

# Delete
client.forget(memories[0].id)`;

const NODE_QUICKSTART = `import { Sulcus } from "sulcus";

const client = new Sulcus({ apiKey: "sk-..." });

// Store memories
await client.remember("User prefers dark mode", { memoryType: "preference" });
await client.remember("API rate limit is 1000/min", { memoryType: "semantic" });

// Search
const results = await client.search("dark mode");
for (const m of results) {
  console.log(\`[\${m.memory_type}] \${m.pointer_summary} (heat: \${m.current_heat.toFixed(2)})\`);
}

// List with filters
const memories = await client.list({ page: 1, pageSize: 10, memoryType: "preference" });

// Pin important memories (prevents heat decay)
await client.pin(memories[0].id);

// Update
await client.update(memories[0].id, { label: "Updated content" });

// Delete
await client.forget(memories[0].id);`;

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
      "url": "https://server.sulcus.dforge.ca/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer sk-your-api-key"
      }
    }
  }
}`;

const REST_EXAMPLE = `# Create a memory
curl -X POST https://server.sulcus.dforge.ca/api/v1/agent/nodes \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{"label": "User prefers dark mode", "memory_type": "preference"}'

# Search memories
curl -X POST https://server.sulcus.dforge.ca/api/v1/agent/search \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{"query": "dark mode", "limit": 10}'

# List memories
curl https://server.sulcus.dforge.ca/api/v1/agent/nodes?page=1&page_size=10 \\
  -H "Authorization: Bearer sk-..."`;

const MEMORY_TYPES = [
  { type: 'episodic', desc: 'Events, conversations, time-bound experiences', decay: 'Fast', example: '"Met with design team, decided on blue theme"' },
  { type: 'semantic', desc: 'Facts, knowledge, definitions', decay: 'Slow', example: '"Python 3.12 requires typing_extensions >= 4.0"' },
  { type: 'preference', desc: 'User preferences, settings, opinions', decay: 'Medium', example: '"User prefers dark mode and monospace fonts"' },
  { type: 'procedural', desc: 'How-to knowledge, workflows, recipes', decay: 'Slow', example: '"To deploy: git push, then az acr build, then update app"' },
];

const API_ENDPOINTS = [
  { method: 'POST', path: '/api/v1/agent/nodes', desc: 'Create a memory node' },
  { method: 'GET', path: '/api/v1/agent/nodes', desc: 'List memories (paginated)' },
  { method: 'GET', path: '/api/v1/agent/nodes/:id', desc: 'Get a single memory' },
  { method: 'PATCH', path: '/api/v1/agent/nodes/:id', desc: 'Update a memory' },
  { method: 'DELETE', path: '/api/v1/agent/nodes/:id', desc: 'Delete a memory' },
  { method: 'POST', path: '/api/v1/agent/search', desc: 'Text search memories' },
  { method: 'GET', path: '/api/v1/agent/hot_nodes', desc: 'List hottest memories' },
  { method: 'POST', path: '/api/v1/agent/sync', desc: 'CRDT sync (push/pull ops)' },
  { method: 'GET', path: '/api/v1/metrics', desc: 'Storage & health metrics' },
  { method: 'GET', path: '/api/v1/org', desc: 'Tenant/org info & limits' },
  { method: 'GET', path: '/api/v1/keys', desc: 'List API keys' },
  { method: 'POST', path: '/api/v1/keys', desc: 'Generate new API key' },
  { method: 'GET', path: '/api/v1/settings/thermo', desc: 'Get thermodynamic engine config' },
  { method: 'PATCH', path: '/api/v1/settings/thermo', desc: 'Update thermodynamic engine config' },
  { method: 'POST', path: '/api/v1/feedback', desc: 'Recall quality feedback (relevant/irrelevant/outdated)' },
  { method: 'GET', path: '/api/v1/analytics/recall', desc: 'Recall analytics with tuning suggestions' },
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
    <div className="min-h-screen bg-[#050a0f] text-white">
      {/* Header */}
      <header className="border-b border-[#00F0FF]/10 py-4 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-lg font-bold tracking-widest uppercase text-[#00F0FF]">
            Sulcus
          </Link>
          <nav className="flex gap-6 text-xs uppercase tracking-widest text-[#888]">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <Link href="/docs" className="text-[#00F0FF]">Docs</Link>
            <Link href="/membench" className="hover:text-white transition-colors">Benchmarks</Link>
            <Link href="/login" className="hover:text-white transition-colors">Sign In</Link>
          </nav>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight mb-4">Documentation</h1>
        <p className="text-[#888] mb-16 text-lg">Everything you need to give your AI agents persistent memory.</p>

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

        {/* MCP Integration */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">MCP Integration</h2>
          <p className="text-[#888] mb-6">
            Sulcus speaks MCP (Model Context Protocol) natively. Connect any MCP-compatible client — Claude Desktop, 
            OpenAI agents, custom hosts — directly to your memory graph.
          </p>
          <CodeBlock code={MCP_EXAMPLE} lang="json" />
          <p className="text-xs text-[#555] mt-3">
            24 MCP tools available: search_memory, commit_memory, record_memory, build_context, list_hot_nodes, 
            tick, prune_cold_memories, forget_memory, page_in, compact_wal, sync_now, and more.
          </p>
        </section>

        {/* REST API */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">REST API</h2>
          <p className="text-[#888] mb-6">
            Base URL: <code className="text-[#00F0FF]">https://server.sulcus.dforge.ca</code>
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
              { name: 'OpenClaw', pkg: '@sulcus/memory-sulcus', install: 'openclaw plugins install', desc: 'Native OpenClaw memory plugin', lang: 'TypeScript' },
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
            Source code for all integrations:{' '}
            <a href="https://github.com/mcdoolz/sulcus/tree/master/integrations" className="text-[#00F0FF] hover:underline">
              github.com/mcdoolz/sulcus/integrations
            </a>
          </p>
        </section>

        {/* Links */}
        <section className="border-t border-[#00F0FF]/10 pt-12">
          <h2 className="text-2xl font-bold text-[#00F0FF] mb-8 tracking-tight">Resources</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <a href="https://github.com/mcdoolz/sulcus" className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors block">
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
            <Link href="/membench" className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors block">
              <div className="font-bold text-white mb-1">MemBench</div>
              <div className="text-[#666]">Open memory benchmark</div>
            </Link>
            <a href="https://github.com/mcdoolz/sulcus/blob/master/INTEGRATIONS.md" className="border border-[#00F0FF]/10 p-4 hover:border-[#00F0FF]/30 transition-colors block">
              <div className="font-bold text-white mb-1">Integrations Guide</div>
              <div className="text-[#666]">LangChain, LlamaIndex, Vercel AI, and more</div>
            </a>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="py-12 border-t border-[#D4AF37]/20 text-center">
        <p className="text-[10px] text-[#2a4a5a] tracking-[0.3em] font-medium uppercase">
          Forged in Rust. Tempered by thermodynamics. 🦀
        </p>
      </footer>
    </div>
  );
}
