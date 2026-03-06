'use client';

import { useState, useEffect } from 'react';

interface MemoryNode {
  id: string;
  label: string;
  memory_type: string;
  heat: number;
}

export default function MemoriesPage() {
  const [nodes, setNodes] = useState<MemoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemories = async () => {
    setLoading(true);
    try {
      const token = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';
      const serverUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus.dforge.ca';
      
      const res = await fetch(`${serverUrl}/api/v1/agent/nodes`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Failed to fetch memories');
      
      const data = await res.json();
      setNodes(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this memory? It will be removed from all agents.')) return;
    
    try {
      const token = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';
      const serverUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus.dforge.ca';
      
      const res = await fetch(`${serverUrl}/api/v1/agent/nodes/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Failed to delete memory');
      
      setNodes(nodes.filter(n => n.id !== id));
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="max-w-5xl font-sans">
      <div className="flex justify-between items-end mb-8">
        <h1 className="text-3xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
          <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"></div>
          Cloud Memory Management
        </h1>
        <button 
          onClick={fetchMemories}
          className="text-xs text-[#00F0FF] border border-[#00F0FF]/30 px-4 py-2 hover:bg-[#00F0FF]/10 transition-colors uppercase tracking-widest"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-4 font-mono tracking-wider mb-8">
          Error: {error}
        </div>
      )}

      <div className="bg-[#0a1520] border border-[#D4AF37]/30 shadow-[0_0_20px_rgba(0,0,0,0.5)] relative">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>

        <table className="w-full text-left font-mono text-sm">
          <thead className="bg-[#111820] text-[#D4AF37] text-xs uppercase tracking-widest border-b border-[#D4AF37]/30">
            <tr>
              <th className="p-4">Label / Summary</th>
              <th className="p-4 w-32">Type</th>
              <th className="p-4 w-24 text-right">Heat</th>
              <th className="p-4 w-24 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#D4AF37]/10">
            {loading ? (
              <tr>
                <td colSpan={4} className="p-12 text-center text-[#888] animate-pulse">Loading memory graph...</td>
              </tr>
            ) : nodes.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-12 text-center text-[#888]">No memories found for this tenant.</td>
              </tr>
            ) : (
              nodes.map(node => (
                <tr key={node.id} className="hover:bg-[#D4AF37]/5 transition-colors group">
                  <td className="p-4 truncate max-w-md text-[#ccc] group-hover:text-white" title={node.label}>{node.label}</td>
                  <td className="p-4 text-xs text-[#00F0FF]/70 tracking-widest">{node.memory_type}</td>
                  <td className="p-4 text-right text-[#D4AF37]">{node.heat.toFixed(3)}</td>
                  <td className="p-4 text-center">
                    <button 
                      onClick={() => handleDelete(node.id)}
                      className="text-red-500/50 hover:text-red-500 transition-colors uppercase text-xs tracking-widest"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}