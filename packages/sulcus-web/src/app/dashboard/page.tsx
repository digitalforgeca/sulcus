'use client';

import { useEffect, useState, useRef } from 'react';

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

type ImportStatus = 'idle' | 'success' | 'error';

export default function DashboardOverview() {
  const [usage, setUsage] = useState<UsageRow | null>(null);
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importMessage, setImportMessage] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const token = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';
        const serverUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io';
        
        if (!token) {
          throw new Error('API key not configured. Please set NEXT_PUBLIC_SULCUS_API_KEY.');
        }
        const headers = { Authorization: `Bearer ${token}` };

        const [usageRes, graphRes] = await Promise.all([
          fetch(`${serverUrl}/api/v1/admin/usage`, { headers }),
          fetch(`${serverUrl}/api/v1/admin/visualize/graph`, { headers }),
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

  const handleExport = () => {
    if (!graph || graph.nodes.length === 0) return;
    
    const exportData = {
      exported_at: new Date().toISOString(),
      nodes: graph.nodes
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sulcus-memory-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (!json.nodes || !Array.isArray(json.nodes)) {
          throw new Error("Invalid memory snapshot format");
        }
        setImportStatus('success');
        setImportMessage(`Successfully parsed ${json.nodes.length} memory nodes. (Sync backend stubbed)`);
      } catch (err: any) {
        setImportStatus('error');
        setImportMessage(`Failed to import: ${err.message}`);
      }
    };
    reader.readAsText(file);
    
    // Reset input so the same file can be uploaded again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (error) {
    return <div className="text-red-500 bg-red-900/20 p-4 rounded border border-red-900 font-mono tracking-widest uppercase">Error: {error}</div>;
  }

  const syncs = usage?.sync_requests || 0;
  const nodes = graph?.nodes.length || 0;
  const avgLat = usage?.avg_latency_ms?.toFixed(1) || '0.0';
  const p95Lat = usage?.max_latency_ms?.toFixed(1) || '0.0';

  const hotNodes = graph?.nodes
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 10) || [];

  return (
    <div className="max-w-4xl font-sans">
      <h1 className="text-3xl font-bold mb-8 tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
        <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"></div>
        Tenant Overview
      </h1>
      
      <div className={`grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 transition-opacity duration-300 ${loading ? 'opacity-50' : 'opacity-100'}`}>
        {/* Sync Ops Card */}
        <div className="bg-[#0a1520] p-6 relative border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)]">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
          <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>
          
          <h3 className="text-[#00F0FF] text-xs uppercase font-bold mb-2 tracking-widest">Sync Operations</h3>
          <div className="text-4xl font-bold text-white font-mono">{loading ? '…' : syncs.toLocaleString()}</div>
          <div className="text-xs text-[#888] mt-2 uppercase tracking-wider">This billing period</div>
        </div>

        {/* Nodes Card */}
        <div className="bg-[#0a1520] p-6 relative border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)]">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
          <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>
          
          <h3 className="text-[#00F0FF] text-xs uppercase font-bold mb-2 tracking-widest">Nodes in Graph</h3>
          <div className="text-4xl font-bold text-white font-mono">{loading ? '…' : nodes.toLocaleString()}</div>
          <div className="text-xs text-[#888] mt-2 uppercase tracking-wider">Semantic units</div>
        </div>

        {/* Latency Card */}
        <div className="bg-[#0a1520] p-6 relative border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)]">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
          <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>
          
          <h3 className="text-[#00F0FF] text-xs uppercase font-bold mb-2 tracking-widest">Avg Latency</h3>
          <div className="text-4xl font-bold text-white font-mono">{loading ? '…' : `${avgLat}ms`}</div>
          <div className="text-xs text-[#888] mt-2 uppercase tracking-wider">Max: {p95Lat}ms</div>
        </div>
      </div>

      <div className="flex justify-between items-end mb-4">
        <h2 className="text-xl font-bold text-white tracking-widest uppercase">Memory Graph Snapshot</h2>
        
        <div className="flex gap-4">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept=".json" 
            className="hidden" 
          />
          <button 
            onClick={handleImportClick}
            className="text-xs font-bold uppercase tracking-widest text-[#888] border border-[#333] hover:border-[#00F0FF] hover:text-[#00F0FF] px-4 py-2 transition-colors flex items-center gap-2"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Import
          </button>
          <button 
            onClick={handleExport}
            disabled={hotNodes.length === 0}
            className="text-xs font-bold uppercase tracking-widest text-[#D4AF37] border border-[#D4AF37]/50 hover:bg-[#D4AF37]/10 disabled:opacity-50 disabled:hover:bg-transparent px-4 py-2 transition-colors flex items-center gap-2 shadow-[0_0_10px_rgba(212,175,55,0.1)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Export
          </button>
        </div>
      </div>

      {importStatus !== 'idle' && (
        <div className={`mb-4 p-4 border text-sm font-mono tracking-wider flex justify-between items-center ${importStatus === 'success' ? 'bg-[#0a1520] border-[#00F0FF]/50 text-[#00F0FF]' : 'bg-red-950/30 border-red-500/50 text-red-400'}`}>
          <span>{importMessage}</span>
          <button onClick={() => setImportStatus('idle')} className="hover:text-white">&times;</button>
        </div>
      )}

      <div className="bg-[#0a1520] border border-[#D4AF37]/30 overflow-hidden relative shadow-[0_0_20px_rgba(0,0,0,0.5)]">
        {loading ? (
          <div className="p-12 text-center text-[#888] font-mono tracking-widest text-sm uppercase animate-pulse">Initializing Interface...</div>
        ) : hotNodes.length === 0 ? (
          <div className="p-12 text-center text-[#888] font-mono tracking-widest text-sm uppercase">Graph is empty. Awaiting agent input.</div>
        ) : (
          <table className="w-full text-left font-mono text-sm">
            <thead className="bg-[#111820] text-[#D4AF37] text-xs uppercase tracking-widest border-b border-[#D4AF37]/30">
              <tr>
                <th className="p-4 font-normal">Label / Summary</th>
                <th className="p-4 w-32 font-normal">Type</th>
                <th className="p-4 w-24 text-right font-normal">Heat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D4AF37]/10">
              {hotNodes.map(node => (
                <tr key={node.id} className="hover:bg-[#D4AF37]/5 transition-colors group">
                  <td className="p-4 truncate max-w-md text-[#ccc] group-hover:text-white" title={node.label}>{node.label}</td>
                  <td className="p-4 text-xs text-[#00F0FF]/70 tracking-widest">{node.memory_type}</td>
                  <td className="p-4 text-right text-[#D4AF37]">{node.heat.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
