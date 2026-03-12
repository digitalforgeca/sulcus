'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface UsageData {
  month: string;
  sync_requests: number;
  nodes_added: number;
  avg_latency_ms: number;
  max_latency_ms: number;
}

function BillingContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'idle' | 'success' | 'canceled'>('idle');
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(true);

  const serverUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io';
  const apiKey = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';

  useEffect(() => {
    if (searchParams.get('success')) setStatus('success');
    if (searchParams.get('canceled')) setStatus('canceled');

    async function loadUsage() {
      try {
        const res = await fetch(`${serverUrl}/api/v1/admin/usage`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (res.ok) {
          const data: UsageData[] = await res.json();
          if (data.length > 0) setUsage(data[0]);
        }
      } catch (err) {
        console.error("Failed to fetch usage", err);
      } finally {
        setLoadingUsage(false);
      }
    }
    loadUsage();
  }, [searchParams, serverUrl, apiKey]);

  // Quota limits by plan
  const FREE_LIMITS = { sync_requests: 10000, nodes: 1000 };
  const syncPct = usage ? Math.min((usage.sync_requests / FREE_LIMITS.sync_requests) * 100, 100) : 0;
  const nodesPct = usage ? Math.min((usage.nodes_added / FREE_LIMITS.nodes) * 100, 100) : 0;

  return (
    <div className="max-w-4xl font-sans">
      <h1 className="text-3xl font-bold mb-8 tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
        <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"></div>
        Subscription & Quota
      </h1>
      
      {status === 'success' && (
        <div className="bg-[#0a1520] border border-[#00F0FF]/50 text-[#00F0FF] p-4 font-mono tracking-wider flex justify-between items-center mb-8">
          <span>Upgrade successful! Your organizational cortex is being provisioned.</span>
          <button onClick={() => setStatus('idle')} className="hover:text-white">&times;</button>
        </div>
      )}

      {status === 'canceled' && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-4 font-mono tracking-wider flex justify-between items-center mb-8">
          <span>Checkout canceled. No changes were made.</span>
          <button onClick={() => setStatus('idle')} className="hover:text-white">&times;</button>
        </div>
      )}
      
      {/* Current Plan */}
      <div className="bg-[#0a1520] p-8 rounded-lg border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)] relative mb-12">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>

        <h2 className="text-xl font-bold mb-2 text-white uppercase tracking-widest">Current Plan: Open (Free)</h2>
        <p className="text-[#888] mb-6">Local sidecar with cloud sync. Upgrade for team features, higher limits, and dedicated support.</p>
        
        {loadingUsage ? (
          <div className="text-[#888] animate-pulse font-mono text-sm">Loading usage data...</div>
        ) : usage ? (
          <div className="space-y-4 max-w-lg">
            {/* Sync Requests */}
            <div className="bg-[#111820] p-4 border border-[#D4AF37]/20">
              <div className="flex justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-[#888]">Sync Requests (this month)</span>
                <span className="text-xs font-bold text-[#D4AF37]">{usage.sync_requests.toLocaleString()} / {FREE_LIMITS.sync_requests.toLocaleString()}</span>
              </div>
              <div className="w-full bg-black h-1">
                <div 
                  className={`h-1 transition-all duration-500 ${syncPct > 80 ? 'bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]' : 'bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]'}`}
                  style={{ width: `${syncPct}%` }}
                ></div>
              </div>
            </div>

            {/* Nodes Added */}
            <div className="bg-[#111820] p-4 border border-[#D4AF37]/20">
              <div className="flex justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-[#888]">Nodes Added (this month)</span>
                <span className="text-xs font-bold text-[#D4AF37]">{usage.nodes_added.toLocaleString()} / {FREE_LIMITS.nodes.toLocaleString()}</span>
              </div>
              <div className="w-full bg-black h-1">
                <div 
                  className={`h-1 transition-all duration-500 ${nodesPct > 80 ? 'bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]' : 'bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]'}`}
                  style={{ width: `${nodesPct}%` }}
                ></div>
              </div>
            </div>

            {/* Performance Stats */}
            <div className="flex gap-4">
              <div className="bg-[#111820] p-3 border border-[#D4AF37]/10 flex-1">
                <div className="text-xs uppercase tracking-wider text-[#888] mb-1">Avg Latency</div>
                <div className="text-lg font-mono text-[#00F0FF]">{usage.avg_latency_ms.toFixed(1)}ms</div>
              </div>
              <div className="bg-[#111820] p-3 border border-[#D4AF37]/10 flex-1">
                <div className="text-xs uppercase tracking-wider text-[#888] mb-1">Peak Latency</div>
                <div className="text-lg font-mono text-[#00F0FF]">{usage.max_latency_ms.toFixed(1)}ms</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[#555] font-mono text-sm">No usage data available yet.</div>
        )}
      </div>

      {/* Plans */}
      <h2 className="text-2xl font-bold mb-6 tracking-widest text-white uppercase">Plans</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Free tier */}
        <div className="bg-[#0a1520] p-6 border border-[#00F0FF]/30 relative flex flex-col">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#00F0FF] to-transparent"></div>
          <div className="text-xs uppercase tracking-widest text-[#00F0FF] mb-2">Current</div>
          <h3 className="text-lg font-bold text-white tracking-widest uppercase mb-1">Open</h3>
          <div className="text-2xl font-mono text-white mb-3">Free</div>
          <ul className="text-[#888] text-sm space-y-2 flex-1 mb-4">
            <li className="flex items-start gap-2"><span className="text-[#00F0FF]">✓</span> Local embedded PG</li>
            <li className="flex items-start gap-2"><span className="text-[#00F0FF]">✓</span> Cloud sync (10K req/mo)</li>
            <li className="flex items-start gap-2"><span className="text-[#00F0FF]">✓</span> 1 agent</li>
            <li className="flex items-start gap-2"><span className="text-[#00F0FF]">✓</span> MCP tools</li>
          </ul>
          <div className="w-full border border-[#00F0FF]/30 text-[#00F0FF] px-4 py-2 text-center text-sm tracking-widest uppercase">
            Active
          </div>
        </div>

        {/* Pro tier */}
        <div className="bg-[#0a1520] p-6 border border-[#D4AF37]/40 relative flex flex-col">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent"></div>
          <div className="text-xs uppercase tracking-widest text-[#D4AF37] mb-2">Recommended</div>
          <h3 className="text-lg font-bold text-[#D4AF37] tracking-widest uppercase mb-1">Cortex</h3>
          <div className="text-2xl font-mono text-white mb-3">$29<span className="text-sm text-[#888]">/mo</span></div>
          <ul className="text-[#888] text-sm space-y-2 flex-1 mb-4">
            <li className="flex items-start gap-2"><span className="text-[#D4AF37]">✓</span> Everything in Open</li>
            <li className="flex items-start gap-2"><span className="text-[#D4AF37]">✓</span> 100K sync requests/mo</li>
            <li className="flex items-start gap-2"><span className="text-[#D4AF37]">✓</span> 5 agents</li>
            <li className="flex items-start gap-2"><span className="text-[#D4AF37]">✓</span> Remote MCP server</li>
            <li className="flex items-start gap-2"><span className="text-[#D4AF37]">✓</span> Shared embeddings</li>
          </ul>
          <div className="w-full border border-[#D4AF37]/50 text-[#D4AF37] px-4 py-2 text-center text-sm tracking-widest uppercase opacity-50 cursor-not-allowed">
            Coming Soon
          </div>
        </div>

        {/* Enterprise tier */}
        <div className="bg-[#0a1520] p-6 border border-[#333] relative flex flex-col">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#555] to-transparent"></div>
          <div className="text-xs uppercase tracking-widest text-[#555] mb-2">Teams</div>
          <h3 className="text-lg font-bold text-white tracking-widest uppercase mb-1">Enterprise</h3>
          <div className="text-2xl font-mono text-white mb-3">Custom</div>
          <ul className="text-[#888] text-sm space-y-2 flex-1 mb-4">
            <li className="flex items-start gap-2"><span className="text-[#555]">✓</span> Everything in Cortex</li>
            <li className="flex items-start gap-2"><span className="text-[#555]">✓</span> Unlimited sync</li>
            <li className="flex items-start gap-2"><span className="text-[#555]">✓</span> Unlimited agents</li>
            <li className="flex items-start gap-2"><span className="text-[#555]">✓</span> SSO / SAML</li>
            <li className="flex items-start gap-2"><span className="text-[#555]">✓</span> Dedicated support</li>
          </ul>
          <div className="w-full border border-[#333] text-[#555] px-4 py-2 text-center text-sm tracking-widest uppercase opacity-50 cursor-not-allowed">
            Contact Us
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="text-[#888] font-mono animate-pulse p-8">Loading billing module...</div>}>
      <BillingContent />
    </Suspense>
  );
}
