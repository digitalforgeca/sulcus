'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { apiFetch } from '@/lib/api';
import type { RecallAnalytics, ThermoResponse } from '@/hooks/useSulcusApi';

interface UsageRow {
  month: string;
  sync_requests: number;
  nodes_added: number;
  avg_latency_ms: number;
  max_latency_ms: number;
}

interface DashboardStats {
  total_nodes: number;
  pinned_count: number;
  avg_heat: number;
  type_distribution: { memory_type: string; count: number }[];
  heat_distribution: { frozen: number; cool: number; warm: number; hot: number; blazing: number };
  namespace_counts: { namespace: string; count: number }[];
  recent_nodes: { id: string; label: string; memory_type: string; heat: number; updated_at: string }[];
}

const TYPE_COLORS: Record<string, string> = {
  episodic: '#a855f7',
  semantic: '#3b82f6',
  procedural: '#22c55e',
  preference: '#f59e0b',
  fact: '#06b6d4',
};

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#0a1520] p-6 relative border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)] ${className}`}>
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
      <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>
      {children}
    </div>
  );
}

function StatNumber({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <h3 className="text-[#00F0FF] text-xs uppercase font-bold mb-2 tracking-widest">{label}</h3>
      <div className="text-3xl font-bold text-white font-mono">{value}</div>
      {sub && <div className="text-xs text-[#888] mt-2 uppercase tracking-wider">{sub}</div>}
    </Card>
  );
}

function HeatBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] uppercase tracking-widest text-[#888] w-14 text-right">{label}</span>
      <div className="flex-1 h-2 bg-black/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
      </div>
      <span className="text-xs font-mono text-[#555] w-8 text-right">{count}</span>
    </div>
  );
}

function WelcomeWagon() {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 mb-4">
          <div className="w-3 h-3 bg-[#00F0FF] shadow-[0_0_12px_#00F0FF] rounded-full animate-pulse"></div>
          <div className="w-3 h-3 bg-[#D4AF37] shadow-[0_0_12px_#D4AF37] rounded-full animate-pulse" style={{ animationDelay: '0.5s' }}></div>
        </div>
        <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">Welcome to Sulcus</h1>
        <p className="text-[#888] text-lg">Thermodynamic memory for your AI agents. Let&apos;s get your first memory stored.</p>
      </div>

      <div className="space-y-6">
        {/* Step 1 */}
        <Card>
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-[#00F0FF]/10 border border-[#00F0FF]/30 flex items-center justify-center flex-shrink-0 mt-1">
              <span className="text-sm font-bold text-[#00F0FF]">1</span>
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold mb-1">Get your API key</h3>
              <p className="text-[#888] text-sm mb-3">
                Head to <Link href="/dashboard/settings" className="text-[#00F0FF] hover:underline">Settings → API Keys</Link> to generate one. You&apos;ll need it for all integrations.
              </p>
            </div>
          </div>
        </Card>

        {/* Step 2: Choose your path */}
        <Card>
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-[#00F0FF]/10 border border-[#00F0FF]/30 flex items-center justify-center flex-shrink-0 mt-1">
              <span className="text-sm font-bold text-[#00F0FF]">2</span>
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold mb-3">Connect your agent</h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* OpenClaw */}
                <div className="bg-black/30 border border-[#D4AF37]/20 p-4 rounded">
                  <div className="text-xs uppercase tracking-widest text-[#D4AF37] font-bold mb-2">OpenClaw</div>
                  <p className="text-[10px] text-[#666] mb-3">Full memory backend plugin with auto-recall and auto-capture.</p>
                  <button
                    onClick={() => copy('npx clawhub@latest install sulcus-memory', 'openclaw')}
                    className="w-full text-left bg-[#0a0a0a] px-3 py-2 rounded text-xs font-mono text-[#00F0FF] hover:bg-[#111] transition-colors cursor-pointer"
                  >
                    {copied === 'openclaw' ? '✓ Copied' : '$ npx clawhub install sulcus-memory'}
                  </button>
                </div>

                {/* Python */}
                <div className="bg-black/30 border border-[#D4AF37]/20 p-4 rounded">
                  <div className="text-xs uppercase tracking-widest text-[#D4AF37] font-bold mb-2">Python</div>
                  <p className="text-[10px] text-[#666] mb-3">SDK for LangChain, CrewAI, or any Python agent framework.</p>
                  <button
                    onClick={() => copy('pip install sulcus', 'python')}
                    className="w-full text-left bg-[#0a0a0a] px-3 py-2 rounded text-xs font-mono text-[#00F0FF] hover:bg-[#111] transition-colors cursor-pointer"
                  >
                    {copied === 'python' ? '✓ Copied' : '$ pip install sulcus'}
                  </button>
                </div>

                {/* Node.js */}
                <div className="bg-black/30 border border-[#D4AF37]/20 p-4 rounded">
                  <div className="text-xs uppercase tracking-widest text-[#D4AF37] font-bold mb-2">Node.js</div>
                  <p className="text-[10px] text-[#666] mb-3">SDK for Vercel AI, custom agents, or any TypeScript project.</p>
                  <button
                    onClick={() => copy('npm install sulcus', 'node')}
                    className="w-full text-left bg-[#0a0a0a] px-3 py-2 rounded text-xs font-mono text-[#00F0FF] hover:bg-[#111] transition-colors cursor-pointer"
                  >
                    {copied === 'node' ? '✓ Copied' : '$ npm install sulcus'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Step 3 */}
        <Card>
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-[#00F0FF]/10 border border-[#00F0FF]/30 flex items-center justify-center flex-shrink-0 mt-1">
              <span className="text-sm font-bold text-[#00F0FF]">3</span>
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold mb-1">Store your first memory</h3>
              <p className="text-[#888] text-sm mb-3">Try it right now — paste this into your terminal:</p>
              <button
                onClick={() => copy(`curl -X POST https://api.sulcus.ca/api/v1/agent/nodes \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"pointer_summary": "My first Sulcus memory", "memory_type": "fact"}'`, 'curl')}
                className="w-full text-left bg-[#0a0a0a] px-4 py-3 rounded text-xs font-mono text-[#00F0FF] hover:bg-[#111] transition-colors cursor-pointer leading-relaxed"
              >
                {copied === 'curl' ? '✓ Copied to clipboard' : (
                  <>
                    <span className="text-[#555]">$</span> curl -X POST https://api.sulcus.ca/api/v1/agent/nodes \<br />
                    &nbsp;&nbsp;-H &quot;Authorization: Bearer YOUR_API_KEY&quot; \<br />
                    &nbsp;&nbsp;-d &apos;{`{"pointer_summary": "My first memory", "memory_type": "fact"}`}&apos;
                  </>
                )}
              </button>
            </div>
          </div>
        </Card>

        {/* Links */}
        <div className="flex items-center justify-center gap-6 pt-4">
          <Link href="/docs" className="text-xs uppercase tracking-widest text-[#00F0FF]/50 hover:text-[#00F0FF] transition-colors">
            Documentation →
          </Link>
          <a href="https://github.com/digitalforgeca/sulcus" target="_blank" rel="noopener noreferrer" className="text-xs uppercase tracking-widest text-[#00F0FF]/50 hover:text-[#00F0FF] transition-colors">
            GitHub →
          </a>
          <a href="https://discord.com/invite/ttDj6nxmk" target="_blank" rel="noopener noreferrer" className="text-xs uppercase tracking-widest text-[#00F0FF]/50 hover:text-[#00F0FF] transition-colors">
            Discord →
          </a>
        </div>
      </div>
    </div>
  );
}

function TypeBadge({ type: t }: { type: string }) {
  const colors: Record<string, string> = {
    episodic: 'border-purple-500/50 text-purple-400',
    semantic: 'border-blue-500/50 text-blue-400',
    procedural: 'border-green-500/50 text-green-400',
    preference: 'border-amber-500/50 text-amber-400',
    fact: 'border-cyan-500/50 text-cyan-400',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 border rounded-full uppercase tracking-widest ${colors[t] || 'border-[#333] text-[#666]'}`}>
      {t}
    </span>
  );
}

export default function DashboardOverview() {
  const [usage, setUsage] = useState<UsageRow | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recallData, setRecallData] = useState<RecallAnalytics | null>(null);
  const [thermoData, setThermoData] = useState<ThermoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        // Use apiFetch for JWT→API key fallback on new users
        const [usageData, statsData] = await Promise.all([
          apiFetch<UsageRow[]>("/api/v1/admin/usage").catch(() => [] as UsageRow[]),
          apiFetch<DashboardStats>("/api/v1/admin/dashboard").catch(() => null),
        ]);

        setUsage(usageData[0] || null);
        setStats(statsData);

        // Fetch thermo + recall analytics (non-blocking, best-effort)
        const [recallRes, thermoRes] = await Promise.all([
          apiFetch<RecallAnalytics>("/api/v1/analytics/recall").catch(() => null),
          apiFetch<ThermoResponse>("/api/v1/settings/thermo").catch(() => null),
        ]);
        setRecallData(recallRes);
        setThermoData(thermoRes);
      } catch (err: any) {
        // Don't surface errors to users — just show empty state
        console.warn("Dashboard fetch error:", err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Suppress top-level error display — individual sections handle their own empty states
  // New users will see zeros/empty states rather than a crash page

  const hd = stats?.heat_distribution;
  const totalHeat = hd ? hd.frozen + hd.cool + hd.warm + hd.hot + hd.blazing : 0;
  const isEmpty = !loading && (!stats || stats.total_nodes === 0);

  if (isEmpty) {
    return <WelcomeWagon />;
  }

  return (
    <div className="max-w-5xl font-sans">
      <h1 className="text-3xl font-bold mb-8 tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
        <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"></div>
        Dashboard
      </h1>

      {/* Top stats row */}
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 transition-opacity duration-300 ${loading ? 'opacity-50' : 'opacity-100'}`}>
        <StatNumber label="Total Nodes" value={loading ? '…' : (stats?.total_nodes ?? 0).toLocaleString()} sub="Memory graph" />
        <StatNumber label="Sync Requests" value={loading ? '…' : (usage?.sync_requests ?? 0).toLocaleString()} sub="This month" />
        <StatNumber label="Avg Heat" value={loading ? '…' : (stats?.avg_heat ?? 0).toFixed(2)} sub="Graph temperature" />
        <StatNumber label="Avg Latency" value={loading ? '…' : `${(usage?.avg_latency_ms ?? 0).toFixed(1)}ms`} sub={`Peak: ${(usage?.max_latency_ms ?? 0).toFixed(1)}ms`} />
      </div>

      {/* Middle row: Type Distribution + Heat Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Type Distribution */}
        <Card>
          <h3 className="text-xs uppercase tracking-widest text-[#D4AF37] font-bold mb-4">Memory Types</h3>
          {loading ? (
            <div className="text-[#555] animate-pulse text-sm">Loading…</div>
          ) : stats?.type_distribution.length === 0 ? (
            <div className="text-[#333] text-sm">No data</div>
          ) : (
            <div className="space-y-3">
              {stats?.type_distribution.map(({ memory_type, count }) => {
                const pct = stats.total_nodes > 0 ? (count / stats.total_nodes) * 100 : 0;
                const color = TYPE_COLORS[memory_type] || '#555';
                return (
                  <div key={memory_type} className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-xs uppercase tracking-widest text-[#888] w-24">{memory_type}</span>
                    <div className="flex-1 h-1.5 bg-black/50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                    <span className="text-xs font-mono text-[#555] w-10 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Heat Distribution */}
        <Card>
          <h3 className="text-xs uppercase tracking-widest text-[#D4AF37] font-bold mb-4">Heat Distribution</h3>
          {loading ? (
            <div className="text-[#555] animate-pulse text-sm">Loading…</div>
          ) : !hd ? (
            <div className="text-[#333] text-sm">No data</div>
          ) : (
            <div className="space-y-3">
              <HeatBar label="Blazing" count={hd.blazing} total={totalHeat} color="#D4AF37" />
              <HeatBar label="Hot" count={hd.hot} total={totalHeat} color="#f59e0b" />
              <HeatBar label="Warm" count={hd.warm} total={totalHeat} color="#00F0FF" />
              <HeatBar label="Cool" count={hd.cool} total={totalHeat} color="#3b82f6" />
              <HeatBar label="Frozen" count={hd.frozen} total={totalHeat} color="#333" />
            </div>
          )}
        </Card>
      </div>

      {/* Thermo Engine Row */}
      {thermoData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <h3 className="text-[10px] uppercase tracking-widest text-[#888] mb-2">Tick Mode</h3>
            <div className="text-lg font-mono font-bold text-[#D4AF37] capitalize">{thermoData.config.tick.mode}</div>
            <div className="text-[10px] text-[#555] mt-1">Every {thermoData.config.tick.trigger_ops} ops</div>
          </Card>
          <Card>
            <h3 className="text-[10px] uppercase tracking-widest text-[#888] mb-2">Resonance</h3>
            <div className="text-lg font-mono font-bold text-[#00F0FF]">{thermoData.config.resonance.spread_factor.toFixed(2)}</div>
            <div className="text-[10px] text-[#555] mt-1">{thermoData.config.resonance.depth}-hop, gate {thermoData.config.resonance.thermal_gate.toFixed(2)}</div>
          </Card>
          <Card>
            <h3 className="text-[10px] uppercase tracking-widest text-[#888] mb-2">Active Index</h3>
            <div className="text-lg font-mono font-bold text-[#22c55e]">{thermoData.config.active_index.max_nodes}</div>
            <div className="text-[10px] text-[#555] mt-1">{(thermoData.config.active_index.context_budget_chars / 1000).toFixed(0)}k char budget</div>
          </Card>
          <Card>
            <h3 className="text-[10px] uppercase tracking-widest text-[#888] mb-2">Recall Quality</h3>
            {recallData && recallData.stats.length > 0 ? (
              <>
                <div className="text-lg font-mono font-bold text-[#D4AF37]">
                  {(recallData.stats.reduce((a, s) => a + s.relevance_ratio, 0) / recallData.stats.length * 100).toFixed(0)}%
                </div>
                <div className="text-[10px] text-[#555] mt-1">{recallData.stats.reduce((a, s) => a + s.total_recalls, 0)} total recalls</div>
              </>
            ) : (
              <>
                <div className="text-lg font-mono text-[#555]">No data</div>
                <div className="text-[10px] text-[#555] mt-1">Use feedback to train</div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* Bottom row: Graph Health + Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="md:col-span-1">
          <h3 className="text-xs uppercase tracking-widest text-[#D4AF37] font-bold mb-3">Graph Health</h3>
          {loading ? (
            <div className="text-[#555] animate-pulse text-sm">Loading…</div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#888] uppercase tracking-wider">Pinned</span>
                <span className="text-sm font-mono text-[#D4AF37]">{stats?.pinned_count ?? 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#888] uppercase tracking-wider">Avg Heat</span>
                <span className="text-sm font-mono text-[#00F0FF]">{(stats?.avg_heat ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#888] uppercase tracking-wider">Hottest</span>
                <span className="text-sm font-mono text-[#D4AF37]">{hd?.blazing ?? 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#888] uppercase tracking-wider">Coldest</span>
                <span className="text-sm font-mono text-[#333]">{hd?.frozen ?? 0}</span>
              </div>
              <div className="border-t border-[#D4AF37]/10 pt-3 mt-2">
                <span className="text-[10px] text-[#444] uppercase tracking-wider block mb-1">Agents</span>
                {(stats?.namespace_counts ?? []).map(({ namespace, count }) => (
                  <div key={namespace} className="flex items-center gap-2 py-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] shadow-[0_0_4px_#00F0FF]"></div>
                    <span className="text-xs text-[#999] flex-1">{namespace}</span>
                    <span className="text-[10px] text-[#555] font-mono">{count} nodes</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Recent Activity */}
        <Card className="md:col-span-2">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs uppercase tracking-widest text-[#D4AF37] font-bold">Recent Activity</h3>
            <Link href="/dashboard/memories" className="text-[10px] uppercase tracking-widest text-[#00F0FF]/50 hover:text-[#00F0FF] transition-colors">
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="text-[#555] animate-pulse text-sm">Loading…</div>
          ) : (stats?.recent_nodes ?? []).length === 0 ? (
            <div className="text-[#333] text-sm">No recent activity</div>
          ) : (
            <div className="space-y-2">
              {stats?.recent_nodes.map(node => {
                const d = new Date(node.updated_at);
                const now = new Date();
                const diffH = Math.floor((now.getTime() - d.getTime()) / 3600000);
                const diffD = Math.floor(diffH / 24);
                let relative: string;
                if (diffH < 1) relative = 'just now';
                else if (diffH < 24) relative = `${diffH}h ago`;
                else if (diffD < 30) relative = `${diffD}d ago`;
                else relative = d.toLocaleDateString();

                const label = node.label.length > 80 ? node.label.slice(0, 80) + '…' : node.label;

                return (
                  <div key={node.id} className="flex items-center gap-3 py-1.5 border-b border-[#D4AF37]/5 last:border-0">
                    <TypeBadge type={node.memory_type} />
                    <span className="text-xs text-[#999] flex-1 truncate" title={node.label}>{label}</span>
                    <span className="text-[10px] text-[#444] font-mono flex-shrink-0">{relative}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
