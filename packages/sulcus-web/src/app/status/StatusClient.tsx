'use client';

import { useState, useEffect, useCallback } from 'react';
import { SiteNav } from '@/components/site-nav';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.sulcus.ca';

interface StatusData {
  status: string;
  version: string;
  checked_at: string;
  graph: {
    total_nodes: number;
    total_edges: number;
    hot_nodes: number;
    cold_nodes: number;
    average_heat: number;
    memory_types: { type: string; count: number }[];
  };
  system: {
    total_agents: number;
    total_operations: number;
    active_triggers: number;
    trigger_fires: number;
    waitlist_signups: number;
    database_size_mb: number;
    last_activity: string | null;
  };
}

function StatusBadge({ status }: { status: string }) {
  const isOp = status === 'operational';
  return (
    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border ${
      isOp
        ? 'border-green-500/40 bg-green-500/10 text-green-400'
        : 'border-red-500/40 bg-red-500/10 text-red-400'
    }`}>
      <div className={`w-2.5 h-2.5 rounded-full ${isOp ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
      <span className="text-sm font-medium tracking-wide uppercase">
        {isOp ? 'All Systems Operational' : 'Service Disruption'}
      </span>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-[#111] border border-[#222] rounded-xl p-5 hover:border-[#333] transition-colors">
      <div className="text-xs uppercase tracking-wider text-[#666] mb-2">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-[#D4AF37]' : 'text-white'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div className="text-xs text-[#555] mt-1">{sub}</div>}
    </div>
  );
}

function HeatBar({ heat }: { heat: number }) {
  const pct = Math.min(100, Math.max(0, heat * 100));
  const color = heat > 0.6 ? '#00F0FF' : heat > 0.3 ? '#D4AF37' : '#555';
  return (
    <div className="w-full h-2 rounded-full bg-[#1a1a1a] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

function TypeRow({ type, count, total }: { type: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-sm text-[#888] capitalize">{type}</div>
      <div className="flex-1 h-2 rounded-full bg-[#1a1a1a] overflow-hidden">
        <div
          className="h-full rounded-full bg-[#D4AF37]/70 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-16 text-right text-sm tabular-nums text-[#888]">{count.toLocaleString()}</div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

export default function StatusClient() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/status`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch status');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <SiteNav />

        <header className="py-10 md:py-14 text-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            System Status
          </h1>
          <p className="text-[#666] text-sm">
            Real-time health and aggregate statistics for the Sulcus memory network.
            <br />
            Auto-refreshes every 30 seconds.
          </p>
        </header>

        {error && !data && (
          <div className="text-center py-20">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-red-500/40 bg-red-500/10 text-red-400">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <span className="text-sm font-medium">Unable to reach API — {error}</span>
            </div>
          </div>
        )}

        {data && (
          <div className="space-y-8 pb-16">
            {/* Status badge */}
            <div className="flex flex-col items-center gap-3">
              <StatusBadge status={data.status} />
              <span className="text-xs text-[#555]">
                v{data.version} · checked {timeAgo(data.checked_at)} · refreshed {lastRefresh.toLocaleTimeString()}
              </span>
            </div>

            {/* Primary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Memory Nodes" value={data.graph.total_nodes} accent />
              <StatCard label="Edges" value={data.graph.total_edges} />
              <StatCard label="Agents" value={data.system.total_agents} accent />
              <StatCard label="Operations" value={data.system.total_operations} />
            </div>

            {/* Thermodynamic health */}
            <div className="bg-[#111] border border-[#222] rounded-xl p-6">
              <h2 className="text-sm uppercase tracking-wider text-[#D4AF37] mb-4">Thermodynamic Health</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <div className="text-xs text-[#666] mb-1.5">Average Heat</div>
                  <HeatBar heat={data.graph.average_heat} />
                  <div className="text-xs text-[#555] mt-1 tabular-nums">{data.graph.average_heat.toFixed(3)}</div>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-[#666] mb-1.5">
                    <span>Hot Nodes (&gt;0.5)</span>
                    <span className="text-[#00F0FF] tabular-nums">{data.graph.hot_nodes.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs text-[#666]">
                    <span>Cold Nodes (&lt;0.1)</span>
                    <span className="text-[#555] tabular-nums">{data.graph.cold_nodes.toLocaleString()}</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#666] mb-1.5">Heat Distribution</div>
                  <div className="text-xs text-[#555]">
                    {data.graph.total_nodes > 0
                      ? `${((data.graph.hot_nodes / data.graph.total_nodes) * 100).toFixed(1)}% hot · ${((data.graph.cold_nodes / data.graph.total_nodes) * 100).toFixed(1)}% cold`
                      : 'No data'}
                  </div>
                </div>
              </div>
            </div>

            {/* Memory types */}
            <div className="bg-[#111] border border-[#222] rounded-xl p-6">
              <h2 className="text-sm uppercase tracking-wider text-[#D4AF37] mb-4">Memory Types</h2>
              <div className="space-y-2.5">
                {data.graph.memory_types.map((t) => (
                  <TypeRow
                    key={t.type}
                    type={t.type}
                    count={t.count}
                    total={data.graph.total_nodes}
                  />
                ))}
              </div>
            </div>

            {/* System info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Active Triggers"
                value={data.system.active_triggers}
                sub={`${data.system.trigger_fires.toLocaleString()} total fires`}
              />
              <StatCard
                label="Database Size"
                value={`${data.system.database_size_mb} MB`}
              />
              <StatCard
                label="Waitlist"
                value={data.system.waitlist_signups}
                sub="signups"
              />
              <StatCard
                label="Last Activity"
                value={data.system.last_activity ? timeAgo(data.system.last_activity) : '—'}
              />
            </div>

            {/* Footer */}
            <div className="text-center text-xs text-[#444] pt-4 border-t border-[#1a1a1a]">
              <p>
                Sulcus is built by{' '}
                <a href="https://dforge.ca" className="text-[#D4AF37]/60 hover:text-[#D4AF37] transition-colors">
                  Digital Forge Studios Inc.
                </a>
                . No personally identifiable information is displayed on this page.
              </p>
            </div>
          </div>
        )}

        {!data && !error && (
          <div className="text-center py-20">
            <div className="w-6 h-6 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-[#555] text-sm mt-4">Loading status...</p>
          </div>
        )}
      </div>
    </div>
  );
}
