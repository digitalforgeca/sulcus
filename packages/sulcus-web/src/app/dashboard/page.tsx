'use client';

import { useEffect, useState } from 'react';

interface UsageRow {
  month: string;
  sync_requests: number;
  nodes_added: number;
  avg_latency_ms: number;
  max_latency_ms: number;
}

interface GraphNode {
  id: string;
  label: string;
  heat: number;
  memory_type: string;
}

interface GraphSnapshot {
  nodes: GraphNode[];
  links: any[];
}

export default function DashboardOverview() {
  const [usage, setUsage] = useState<UsageRow | null>(null);
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const token = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';
        if (!token) {
          throw new Error('API key not configured. Please set NEXT_PUBLIC_SULCUS_API_KEY.');
        }
        const headers = { Authorization: `Bearer ${token}` };

        const [usageRes, graphRes] = await Promise.all([
          fetch('http://localhost:3000/api/v1/admin/usage', { headers }),
          fetch('http://localhost:3000/api/v1/admin/visualize/graph', { headers }),
        ]);

        if (!usageRes.ok || !graphRes.ok) {
          throw new Error('Failed to fetch dashboard telemetry');
        }

        const usageData: UsageRow[] = await usageRes.json();
        const graphData: GraphSnapshot = await graphRes.json();

        setUsage(usageData[0] || null);
        setGraph(graphData);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (error) {
    return <div className="text-red-500 bg-red-900/20 p-4 rounded border border-red-900">Error: {error}</div>;
  }

  const syncs = usage?.sync_requests || 0;
  const nodes = graph?.nodes.length || 0;
  const avgLat = usage?.avg_latency_ms?.toFixed(1) || '0.0';
  const p95Lat = usage?.max_latency_ms?.toFixed(1) || '0.0';

  const hotNodes = graph?.nodes
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 10) || [];

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Tenant Overview</h1>
      
      <div className={`grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 transition-opacity duration-300 ${loading ? 'opacity-50' : 'opacity-100'}`}>
        <div className="bg-[#111] p-6 rounded-lg border border-[#222]">
          <h3 className="text-[#888] text-sm uppercase font-bold mb-2">Sync Operations</h3>
          <div className="text-4xl font-bold text-[#ff3e00]">{loading ? '…' : syncs.toLocaleString()}</div>
          <div className="text-sm text-[#555] mt-2">This billing period</div>
        </div>
        <div className="bg-[#111] p-6 rounded-lg border border-[#222]">
          <h3 className="text-[#888] text-sm uppercase font-bold mb-2">Nodes in Graph</h3>
          <div className="text-4xl font-bold">{loading ? '…' : nodes.toLocaleString()}</div>
          <div className="text-sm text-[#555] mt-2">Semantic units</div>
        </div>
        <div className="bg-[#111] p-6 rounded-lg border border-[#222]">
          <h3 className="text-[#888] text-sm uppercase font-bold mb-2">Avg Latency</h3>
          <div className="text-4xl font-bold text-green-500">{loading ? '…' : `${avgLat}ms`}</div>
          <div className="text-sm text-[#555] mt-2">Max: {p95Lat}ms</div>
        </div>
      </div>

      <h2 className="text-xl font-bold mb-4">Memory Graph Snapshot (Hot Nodes)</h2>
      <div className="bg-[#111] rounded-lg border border-[#222] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[#555]">Loading graph...</div>
        ) : hotNodes.length === 0 ? (
          <div className="p-8 text-center text-[#555]">Graph is empty.</div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-[#1a1a1a] text-[#888] text-xs uppercase">
              <tr>
                <th className="p-4">Label / Summary</th>
                <th className="p-4 w-24">Type</th>
                <th className="p-4 w-24 text-right">Heat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222]">
              {hotNodes.map(node => (
                <tr key={node.id} className="hover:bg-[#151515]">
                  <td className="p-4 truncate max-w-md" title={node.label}>{node.label}</td>
                  <td className="p-4 text-xs text-[#888]">{node.memory_type}</td>
                  <td className="p-4 text-right font-mono text-[#ff3e00]">{node.heat.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
