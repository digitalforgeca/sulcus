"use client";

import { useEffect, useState } from "react";
import {
  TbRobot, TbActivity, TbDatabase, TbClock, TbBolt, TbRefresh,
  TbWifi, TbWifiOff, TbServer, TbCpu, TbDeviceFloppy, TbHash,
  TbLock, TbChevronRight, TbExternalLink,
} from "react-icons/tb";
import {
  GiAbstract074, GiAbstract076, GiAbstract098,
  GiAbstract060, GiAbstract008,
} from "react-icons/gi";
import { SERVER_URL, apiFetch, authHeaders } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NamespaceCount {
  namespace: string;
  count: number;
}

interface TypeDist {
  memory_type: string;
  count: number;
}

interface RecentNode {
  id: string;
  label: string;
  memory_type: string;
  heat: number;
  updated_at: string;
}

interface DashboardData {
  total_nodes: number;
  pinned_count: number;
  avg_heat: number;
  type_distribution: TypeDist[];
  namespace_counts: NamespaceCount[];
  recent_nodes: RecentNode[];
  namespace_type_distribution?: Record<string, TypeDist[]>;
  namespace_recent_nodes?: Record<string, RecentNode[]>;
}

interface OrgData {
  plan_tier: string;
  max_seats: number | null;
  features: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  preference: "#D4AF37",
  semantic: "#00F0FF",
  procedural: "#8B5CF6",
  episodic: "#f59e0b",
  fact: "#22c55e",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  preference: <GiAbstract074 size={12} />,
  semantic: <GiAbstract076 size={12} />,
  procedural: <GiAbstract098 size={12} />,
  episodic: <GiAbstract060 size={12} />,
  fact: <GiAbstract008 size={12} />,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [org, setOrg] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedNs, setSelectedNs] = useState<string | null>(null);

  async function load() {
    try {
      const [d, o] = await Promise.all([
        apiFetch<DashboardData>("/api/v1/admin/dashboard"),
        apiFetch<OrgData>("/api/v1/org"),
      ]);
      setDashboard(d);
      setOrg(o);
    } catch (err) {
      console.error("Failed to load agent data", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[#555] animate-pulse tracking-widest text-sm uppercase font-mono">
        <TbRobot size={20} className="mr-2 animate-pulse" /> Loading agent fleet…
      </div>
    );
  }

  const agents = dashboard?.namespace_counts || [];
  const totalNodes = dashboard?.total_nodes || 0;
  const typeDist = dashboard?.type_distribution || [];
  const recentNodes = dashboard?.recent_nodes || [];
  const tier = org?.plan_tier || "free";
  const maxAgents = tier === "enterprise" ? "∞" : tier === "cortex" ? "5" : "1";
  const features = (org?.features || "").split(",").filter(Boolean);

  // Get recent activity per namespace from recent_nodes
  const nsLastActivity: Record<string, string> = {};
  const nsNodeTypes: Record<string, Record<string, number>> = {};
  for (const node of recentNodes) {
    const ns = (node as any).namespace || "default";
    if (!nsLastActivity[ns]) nsLastActivity[ns] = node.updated_at;
    if (!nsNodeTypes[ns]) nsNodeTypes[ns] = {};
    nsNodeTypes[ns][node.memory_type] = (nsNodeTypes[ns][node.memory_type] || 0) + 1;
  }

  return (
    <div className="max-w-5xl font-sans">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
          <TbRobot size={24} className="text-[#00F0FF]" />
          Agent Fleet
        </h1>
        <div className="flex items-center gap-4">
          <span className="text-xs text-[#888] uppercase tracking-widest font-mono">
            {agents.length} / {maxAgents} agents
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 border border-[#333] hover:border-[#00F0FF]/50 transition-colors rounded-sm disabled:opacity-50"
          >
            <TbRefresh size={14} className={`text-[#888] ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Fleet Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-[#0a1520] p-4 border border-[#D4AF37]/20 rounded-sm">
          <div className="text-xs text-[#888] uppercase tracking-widest mb-1 flex items-center gap-1.5">
            <TbDatabase size={10} /> Total Nodes
          </div>
          <div className="text-2xl font-mono text-[#00F0FF]">{totalNodes}</div>
        </div>
        <div className="bg-[#0a1520] p-4 border border-[#D4AF37]/20 rounded-sm">
          <div className="text-xs text-[#888] uppercase tracking-widest mb-1 flex items-center gap-1.5">
            <TbActivity size={10} /> Avg Heat
          </div>
          <div className="text-2xl font-mono text-[#D4AF37]">
            {(dashboard?.avg_heat ?? 0).toFixed(2)}
          </div>
        </div>
        <div className="bg-[#0a1520] p-4 border border-[#D4AF37]/20 rounded-sm">
          <div className="text-xs text-[#888] uppercase tracking-widest mb-1 flex items-center gap-1.5">
            <TbServer size={10} /> Namespaces
          </div>
          <div className="text-2xl font-mono text-white">{agents.length}</div>
        </div>
        <div className="bg-[#0a1520] p-4 border border-[#D4AF37]/20 rounded-sm">
          <div className="text-xs text-[#888] uppercase tracking-widest mb-1 flex items-center gap-1.5">
            <TbLock size={10} /> Tier
          </div>
          <div className={`text-2xl font-mono ${tier === "cortex" ? "text-[#D4AF37]" : tier === "enterprise" ? "text-purple-400" : "text-[#00F0FF]"}`}>
            {tier.charAt(0).toUpperCase() + tier.slice(1)}
          </div>
        </div>
      </div>

      {/* Agent Cards */}
      <div className="space-y-4 mb-8">
        {agents.map((agent) => {
          const isSelected = selectedNs === agent.namespace;
          const lastActive = nsLastActivity[agent.namespace];
          const pct = totalNodes > 0 ? Math.round((agent.count / totalNodes) * 100) : 0;
          const nodeTypes = nsNodeTypes[agent.namespace] || {};
          
          return (
            <div key={agent.namespace} className="bg-[#0a1520] border border-[#D4AF37]/20 rounded-sm overflow-hidden">
              <button
                onClick={() => setSelectedNs(isSelected ? null : agent.namespace)}
                className="w-full p-5 flex items-center justify-between hover:bg-[#0d1a28] transition-colors text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-[#050a0f] border border-[#00F0FF]/30 rounded-sm flex items-center justify-center">
                    <TbRobot size={18} className="text-[#00F0FF]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold tracking-widest uppercase">
                        {agent.namespace}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 border rounded-full border-green-500/40 text-green-400 uppercase tracking-widest">
                        <TbWifi size={8} /> Active
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[#888]">
                      <span className="flex items-center gap-1">
                        <TbDatabase size={10} /> {agent.count} nodes
                      </span>
                      <span className="text-[#333]">·</span>
                      <span className="flex items-center gap-1">
                        <TbDeviceFloppy size={10} /> {pct}% of index
                      </span>
                      {lastActive && (
                        <>
                          <span className="text-[#333]">·</span>
                          <span className="flex items-center gap-1">
                            <TbClock size={10} /> {timeAgo(lastActive)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <TbChevronRight size={16} className={`text-[#555] transition-transform ${isSelected ? "rotate-90" : ""}`} />
              </button>

              {/* Expanded Detail */}
              {isSelected && (
                <div className="border-t border-[#D4AF37]/10 p-5 bg-[#050a0f]/50">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Node Type Breakdown */}
                    <div>
                      <h4 className="text-xs text-[#888] uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <TbCpu size={10} /> Memory Types
                      </h4>
                      {(() => {
                        const agentTypes = dashboard?.namespace_type_distribution?.[agent.namespace] || [];
                        return agentTypes.length > 0 ? (
                        <div className="space-y-2">
                          {agentTypes.map((t) => (
                            <div key={t.memory_type} className="flex items-center gap-2">
                              <span style={{ color: TYPE_COLORS[t.memory_type] || "#555" }}>
                                {TYPE_ICONS[t.memory_type] ?? <TbHash size={12} />}
                              </span>
                              <span className="text-xs text-[#888] uppercase tracking-wider flex-1">{t.memory_type}</span>
                              <span className="text-xs font-mono text-white">{t.count}</span>
                              <div className="w-16 bg-[#111820] h-1 rounded-full overflow-hidden">
                                <div
                                  className="h-1 rounded-full"
                                  style={{
                                    width: `${Math.min((t.count / Math.max(agent.count, 1)) * 100, 100)}%`,
                                    backgroundColor: TYPE_COLORS[t.memory_type] || "#555",
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-[#555] font-mono">No type data</div>
                      );
                      })()}
                    </div>

                    {/* Connection Info */}
                    <div>
                      <h4 className="text-xs text-[#888] uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <TbBolt size={10} /> Connection
                      </h4>
                      <div className="space-y-3 text-xs font-mono">
                        <div>
                          <span className="text-[#555] uppercase tracking-wider block mb-0.5">Namespace</span>
                          <span className="text-[#00F0FF]">{agent.namespace}</span>
                        </div>
                        <div>
                          <span className="text-[#555] uppercase tracking-wider block mb-0.5">Protocol</span>
                          <span className="text-white">CRDT Sync v1</span>
                        </div>
                        <div>
                          <span className="text-[#555] uppercase tracking-wider block mb-0.5">Endpoint</span>
                          <span className="text-[#888] break-all text-[10px]">sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io</span>
                        </div>
                      </div>
                    </div>

                    {/* Recent Activity */}
                    <div>
                      <h4 className="text-xs text-[#888] uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <TbActivity size={10} /> Recent Activity
                      </h4>
                      <div className="space-y-2">
                        {(dashboard?.namespace_recent_nodes?.[agent.namespace] || recentNodes).slice(0, 4).map((node) => (
                          <div key={node.id} className="flex items-start gap-2">
                            <span style={{ color: TYPE_COLORS[node.memory_type] || "#555" }} className="mt-0.5 shrink-0">
                              {TYPE_ICONS[node.memory_type] ?? <TbHash size={10} />}
                            </span>
                            <div className="min-w-0">
                              <div className="text-[10px] text-white truncate">
                                {node.label?.slice(0, 60) || "Untitled"}
                              </div>
                              <div className="text-[9px] text-[#555] font-mono">{timeAgo(node.updated_at)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Features */}
                  {features.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-[#D4AF37]/10">
                      <span className="text-xs text-[#555] uppercase tracking-widest">Features: </span>
                      {features.map((f) => (
                        <span key={f} className="inline-block text-[10px] px-2 py-0.5 border border-[#333] rounded-full text-[#888] mr-2 uppercase tracking-widest">
                          {f.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {agents.length === 0 && (
          <div className="text-center py-16 text-[#555]">
            <TbRobot size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-sm uppercase tracking-widest mb-2">No agents connected</p>
            <p className="text-xs text-[#888]">Configure an MCP sidecar or OpenClaw plugin to get started.</p>
          </div>
        )}
      </div>

      {/* Setup Guide */}
      <div className="bg-[#0a1520] p-6 border border-[#D4AF37]/20 rounded-sm">
        <h3 className="font-bold mb-3 text-white uppercase tracking-widest text-sm flex items-center gap-2">
          <TbBolt size={14} className="text-[#D4AF37]" /> Connect an Agent
        </h3>
        <p className="text-sm text-[#888] mb-4">
          Install the SULCUS MCP sidecar or OpenClaw plugin and point it at this server. 
          Generate an API key from your <a href="/dashboard/account" className="text-[#00F0FF] hover:underline">Account</a> page.
        </p>
        <div className="space-y-3">
          <div>
            <span className="text-[10px] text-[#555] uppercase tracking-widest block mb-1">MCP Sidecar (sulcus.ini)</span>
            <code className="block bg-[#050a0f] border border-[#1a2a3a] p-3 rounded-sm text-xs text-[#D4AF37] font-mono">
              [sulcus]{"\n"}
              server_url = https://sulcus.ca{"\n"}
              server_api_key = sk-YOUR_KEY_HERE
            </code>
          </div>
          <div>
            <span className="text-[10px] text-[#555] uppercase tracking-widest block mb-1">OpenClaw Plugin</span>
            <code className="block bg-[#050a0f] border border-[#1a2a3a] p-3 rounded-sm text-xs text-[#D4AF37] font-mono">
              openclaw sulcus join &lt;invitation-token&gt;
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
