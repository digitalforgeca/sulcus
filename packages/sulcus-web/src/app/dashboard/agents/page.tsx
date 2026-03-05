'use client';

import { useEffect, useState } from 'react';

interface AgentInfo {
  id: string;
  name: string;
  last_sync: string;
  ops_count: number;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real system, we'd fetch this from /api/v1/admin/agents
    // For now, we'll derive it from the usage stats or mock it since we haven't implemented the agent registry API yet.
    const mockAgents: AgentInfo[] = [
      { id: '1', name: 'OpenClaw-Main', last_sync: new Date().toISOString(), ops_count: 124 },
      { id: '2', name: 'Claude-Extension', last_sync: new Date().toISOString(), ops_count: 42 },
    ];
    
    setTimeout(() => {
      setAgents(mockAgents);
      setLoading(false);
    }, 500);
  }, []);

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Active Agents</h1>
      
      <div className="bg-[#111] rounded-lg border border-[#222] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[#555]">Loading agent fleet...</div>
        ) : agents.length === 0 ? (
          <div className="p-8 text-center text-[#555]">No agents registered.</div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-[#1a1a1a] text-[#888] text-xs uppercase">
              <tr>
                <th className="p-4">Agent Name</th>
                <th className="p-4">Last Sync</th>
                <th className="p-4 text-right">Ops</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222]">
              {agents.map(agent => (
                <tr key={agent.id} className="hover:bg-[#151515]">
                  <td className="p-4 font-medium text-white">{agent.name}</td>
                  <td className="p-4 text-sm text-[#888]">{new Date(agent.last_sync).toLocaleString()}</td>
                  <td className="p-4 text-right font-mono text-[#ff3e00]">{agent.ops_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      <div className="mt-8 p-6 bg-[#111] rounded-lg border border-[#222]">
        <h3 className="font-bold mb-2">How to add an agent?</h3>
        <p className="text-sm text-[#888] mb-4">
          Install the SULCUS extension or the OpenClaw plugin and use your tenant API key to connect to this server.
        </p>
        <code className="block bg-black p-3 rounded text-xs text-[#ff3e00]">
          SULCUS_SERVER_URL=http://sulcus.dforge.ca:3000 SULCUS_API_KEY=YOUR_KEY
        </code>
      </div>
    </div>
  );
}
