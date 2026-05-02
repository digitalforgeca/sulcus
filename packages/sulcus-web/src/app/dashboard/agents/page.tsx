"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  TbRobot, TbActivity, TbDatabase, TbClock, TbBolt, TbRefresh,
  TbWifi, TbServer, TbCpu, TbDeviceFloppy, TbHash,
  TbLock, TbChevronRight, TbShield, TbShieldCheck,
  TbShieldX, TbPlus, TbTrash, TbLoader2, TbArrowMerge,
  TbAlertTriangle, TbX,
} from "react-icons/tb";
import {
  GiAbstract074, GiAbstract076, GiAbstract098,
  GiAbstract060, GiAbstract008,
} from "react-icons/gi";
import { SERVER_URL, apiFetch, authHeaders } from "@/lib/api";
import GoldCard from "@/components/GoldCard";
import AgentSiuConfig from "@/components/AgentSiuConfig";
import AgentTriggers from "@/components/AgentTriggers";

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
  const loadedRef = useRef(false);

  // Merge modal state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<string | null>(null);

  // Delete modal state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteNs, setDeleteNs] = useState("");
  const [deleteStep, setDeleteStep] = useState<"confirm" | "merge-first">("confirm");
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);

  const load = useCallback(async () => {
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
  }, []);

  // Initial load — runs once
  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      load();
    }
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  // Open merge modal pre-filled with source
  const openMerge = (source: string) => {
    setMergeSource(source);
    setMergeTarget("");
    setMergeResult(null);
    setMergeOpen(true);
  };

  const handleMerge = async () => {
    if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) return;
    setMerging(true);
    setMergeResult(null);
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/admin/agents/merge`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ source: mergeSource, target: mergeTarget }),
      });
      const data = await res.json();
      if (res.ok) {
        setMergeResult(`✅ Merged ${data.memories_moved} memories from "${mergeSource}" → "${mergeTarget}"`);
        load();
      } else {
        setMergeResult(`❌ ${data.error || "Merge failed"}`);
      }
    } catch (e) {
      setMergeResult(`❌ Network error`);
    } finally {
      setMerging(false);
    }
  };

  // Open delete dialog
  const openDelete = (ns: string) => {
    setDeleteNs(ns);
    setDeleteStep("confirm");
    setDeleteResult(null);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteNs) return;
    setDeleting(true);
    setDeleteResult(null);
    try {
      const hdrs = await authHeaders();
      const res = await fetch(
        `${SERVER_URL}/api/v1/admin/agents/${encodeURIComponent(deleteNs)}?confirm=true`,
        { method: "DELETE", headers: hdrs }
      );
      const data = await res.json();
      if (res.ok) {
        setDeleteResult(`✅ Deleted "${deleteNs}": ${data.memories_deleted} memories, ${data.edges_deleted} edges`);
        load();
      } else {
        setDeleteResult(`❌ ${data.error || "Delete failed"}`);
      }
    } catch {
      setDeleteResult(`❌ Network error`);
    } finally {
      setDeleting(false);
    }
  };

  // Switch from delete → merge-first flow
  const switchToMergeFirst = () => {
    setDeleteOpen(false);
    setMergeSource(deleteNs);
    setMergeTarget("");
    setMergeResult(null);
    setMergeOpen(true);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-2">
          <TbRobot size={16} className="text-[#00F0FF]" />
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GoldCard padding="p-3">
          <div className="text-[10px] text-[#555] uppercase tracking-widest mb-1 flex items-center gap-1.5">
            <TbDatabase size={10} /> Total Nodes
          </div>
          <div className="text-lg font-mono text-[#00F0FF]">{totalNodes.toLocaleString()}</div>
        </GoldCard>
        <GoldCard padding="p-3">
          <div className="text-[10px] text-[#555] uppercase tracking-widest mb-1 flex items-center gap-1.5">
            <TbActivity size={10} /> Avg Heat
          </div>
          <div className="text-lg font-mono text-[#D4AF37]">
            {(dashboard?.avg_heat ?? 0).toFixed(2)}
          </div>
        </GoldCard>
        <GoldCard padding="p-3">
          <div className="text-[10px] text-[#555] uppercase tracking-widest mb-1 flex items-center gap-1.5">
            <TbServer size={10} /> Namespaces
          </div>
          <div className="text-lg font-mono text-white">{agents.length}</div>
        </GoldCard>
        <GoldCard padding="p-3">
          <div className="text-[10px] text-[#555] uppercase tracking-widest mb-1 flex items-center gap-1.5">
            <TbLock size={10} /> Tier
          </div>
          <div className={`text-lg font-mono ${tier === "cortex" ? "text-[#D4AF37]" : tier === "enterprise" ? "text-purple-400" : "text-[#00F0FF]"}`}>
            {tier.charAt(0).toUpperCase() + tier.slice(1)}
          </div>
        </GoldCard>
      </div>

      {/* Agent Cards */}
      <div className="space-y-3">
        {agents.map((agent) => {
          const isSelected = selectedNs === agent.namespace;
          const lastActive = nsLastActivity[agent.namespace];
          const pct = totalNodes > 0 ? Math.round((agent.count / totalNodes) * 100) : 0;
          const nodeTypes = nsNodeTypes[agent.namespace] || {};
          
          return (
            <GoldCard key={agent.namespace} padding="p-0" className="overflow-hidden">
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
                      <span className="text-white text-sm font-bold tracking-widest uppercase">
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); openMerge(agent.namespace); }}
                    title="Merge into another agent"
                    className="p-1.5 border border-[#333] hover:border-[#00F0FF]/50 hover:text-[#00F0FF] transition-colors rounded-sm text-[#555]"
                  >
                    <TbArrowMerge size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); openDelete(agent.namespace); }}
                    title="Delete agent"
                    className="p-1.5 border border-[#333] hover:border-red-500/50 hover:text-red-400 transition-colors rounded-sm text-[#555]"
                  >
                    <TbTrash size={12} />
                  </button>
                  <TbChevronRight size={16} className={`text-[#555] transition-transform ${isSelected ? "rotate-90" : ""}`} />
                </div>
              </button>

              {/* Expanded Detail */}
              {isSelected && (<>
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
                          <span className="text-[#888] break-all text-[10px]">api.sulcus.ca</span>
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

                {/* Per-Agent Intelligence Config */}
                <AgentSiuConfig namespace={agent.namespace} />

                {/* Per-Agent Triggers */}
                <AgentTriggers namespace={agent.namespace} />
              </>)}
            </GoldCard>
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

      {/* Global Triggers — apply across all agents */}
      <GoldCard>
        <AgentTriggers namespace="default" globalLabel="Global Triggers" />
      </GoldCard>

      {/* Namespace Access Control */}
      <NamespaceAclSection />

      {/* Setup Guide */}
      <GoldCard>
        <h3 className="font-bold mb-3 text-white uppercase tracking-widest text-xs flex items-center gap-2">
          <TbBolt size={12} className="text-[#D4AF37]" /> Connect an Agent
        </h3>
        <p className="text-xs text-[#888] mb-4">
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
      </GoldCard>

      {/* SIU/SILU controls are now per-agent (inside each agent card above) */}

      {/* ═══ Merge Modal ═══ */}
      {mergeOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => !merging && setMergeOpen(false)}>
          <div className="bg-[#0a1520] border border-[#D4AF37]/30 rounded-sm max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest flex items-center gap-2">
                <TbArrowMerge size={14} /> Merge Agent
              </h3>
              <button onClick={() => setMergeOpen(false)} disabled={merging} className="text-[#555] hover:text-white">
                <TbX size={16} />
              </button>
            </div>
            <p className="text-xs text-[#888]">
              Move all memories from the source namespace into the target. The source namespace will be empty after merge.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-[#555] uppercase tracking-widest block mb-1">Source (from)</label>
                <select
                  value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}
                  className="w-full bg-[#050a0f] border border-[#D4AF37]/20 text-white text-xs px-3 py-2 rounded-sm focus:outline-none"
                >
                  {agents.map(a => <option key={a.namespace} value={a.namespace}>{a.namespace} ({a.count} memories)</option>)}
                </select>
              </div>
              <div className="text-center text-[#555] text-lg">↓</div>
              <div>
                <label className="text-[10px] text-[#555] uppercase tracking-widest block mb-1">Target (into)</label>
                <select
                  value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}
                  className="w-full bg-[#050a0f] border border-[#D4AF37]/20 text-white text-xs px-3 py-2 rounded-sm focus:outline-none"
                >
                  <option value="">Select target namespace...</option>
                  {agents.filter(a => a.namespace !== mergeSource).map(a => (
                    <option key={a.namespace} value={a.namespace}>{a.namespace} ({a.count} memories)</option>
                  ))}
                </select>
              </div>
            </div>
            {mergeResult && (
              <div className={`text-xs p-3 rounded-sm border ${
                mergeResult.startsWith("✅") ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"
              }`}>
                {mergeResult}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setMergeOpen(false)} disabled={merging}
                className="px-4 py-2 text-xs text-[#888] border border-[#333] rounded-sm hover:border-[#555] uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={merging || !mergeTarget || mergeSource === mergeTarget}
                className="px-4 py-2 text-xs bg-[#00F0FF]/20 text-[#00F0FF] border border-[#00F0FF]/30 rounded-sm hover:bg-[#00F0FF]/30 uppercase tracking-widest disabled:opacity-50 flex items-center gap-1"
              >
                {merging ? <TbLoader2 size={12} className="animate-spin" /> : <TbArrowMerge size={12} />}
                Merge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Delete Modal ═══ */}
      {deleteOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => !deleting && setDeleteOpen(false)}>
          <div className="bg-[#0a1520] border border-red-500/30 rounded-sm max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-red-400 uppercase tracking-widest flex items-center gap-2">
                <TbAlertTriangle size={14} /> Delete Agent
              </h3>
              <button onClick={() => setDeleteOpen(false)} disabled={deleting} className="text-[#555] hover:text-white">
                <TbX size={16} />
              </button>
            </div>
            <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-sm">
              <p className="text-xs text-red-300 mb-2">
                This will permanently delete <strong className="text-red-400">{deleteNs}</strong> and all its data:
              </p>
              <ul className="text-xs text-[#888] space-y-1 ml-4 list-disc">
                <li>All memories (active + archived)</li>
                <li>All graph edges</li>
                <li>Namespace counters &amp; ACL rules</li>
              </ul>
            </div>
            <div className="p-3 bg-[#050a0f] border border-[#D4AF37]/20 rounded-sm">
              <p className="text-xs text-[#D4AF37] flex items-center gap-2 mb-2">
                <TbArrowMerge size={12} /> Want to keep the memories?
              </p>
              <button
                onClick={switchToMergeFirst}
                className="text-xs text-[#00F0FF] hover:underline"
              >
                Merge into another agent first →
              </button>
            </div>
            {deleteResult && (
              <div className={`text-xs p-3 rounded-sm border ${
                deleteResult.startsWith("✅") ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"
              }`}>
                {deleteResult}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteOpen(false)} disabled={deleting}
                className="px-4 py-2 text-xs text-[#888] border border-[#333] rounded-sm hover:border-[#555] uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-sm hover:bg-red-500/30 uppercase tracking-widest flex items-center gap-1"
              >
                {deleting ? <TbLoader2 size={12} className="animate-spin" /> : <TbTrash size={12} />}
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Namespace ACL Component
// ---------------------------------------------------------------------------

interface AclRule {
  id: string;
  agent_label: string;
  namespace: string;
  policy: string;
  created_at: string;
}

function NamespaceAclSection() {
  const [rules, setRules] = useState<AclRule[]>([]);
  const [defaultPolicy, setDefaultPolicy] = useState("allow");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newAgent, setNewAgent] = useState("");
  const [newNamespace, setNewNamespace] = useState("");
  const [newPolicy, setNewPolicy] = useState("allow");
  const aclLoadedRef = useRef(false);

  const loadAcl = useCallback(async () => {
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`${SERVER_URL}/api/v1/namespaces/acl`, { headers: hdrs });
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
        setDefaultPolicy(data.default_policy || "allow");
        setNamespaces(data.namespaces || []);
        setAgents(data.agents || []);
      }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!aclLoadedRef.current) {
      aclLoadedRef.current = true;
      loadAcl();
    }
  }, [loadAcl]);

  const handleSetDefault = async (policy: string) => {
    setSaving(true);
    try {
      const hdrs = await authHeaders();
      await fetch(`${SERVER_URL}/api/v1/namespaces/default`, {
        method: "PUT", headers: hdrs,
        body: JSON.stringify({ default_policy: policy }),
      });
      setDefaultPolicy(policy);
    } catch {} finally { setSaving(false); }
  };

  const handleAddRule = async () => {
    if (!newAgent || !newNamespace) return;
    setSaving(true);
    try {
      const hdrs = await authHeaders();
      await fetch(`${SERVER_URL}/api/v1/namespaces/acl`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ agent_label: newAgent, namespace: newNamespace, policy: newPolicy }),
      });
      setNewAgent(""); setNewNamespace(""); setNewPolicy("allow");
      await loadAcl();
    } catch {} finally { setSaving(false); }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const hdrs = await authHeaders();
      await fetch(`${SERVER_URL}/api/v1/namespaces/acl/${id}`, { method: "DELETE", headers: hdrs });
      await loadAcl();
    } catch {}
  };

  if (loading) return (
    <div className="bg-[#0a1520] border border-[#D4AF37]/20 p-6 rounded-sm flex items-center gap-2 text-[#555]">
      <TbLoader2 size={14} className="animate-spin" /> Loading namespace access rules…
    </div>
  );

  return (
    <GoldCard className="space-y-4">
      <h3 className="font-bold text-white uppercase tracking-widest text-xs flex items-center gap-2">
        <TbShield size={12} className="text-[#00F0FF]" /> Namespace Access Control
      </h3>
      <p className="text-xs text-[#555]">
        Control which agents can access which namespaces. Agents without explicit rules fall back to the default policy.
      </p>

      {/* Default Policy */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-[#888] uppercase tracking-widest">Default Policy:</span>
        <button
          onClick={() => handleSetDefault("allow")}
          disabled={saving}
          className={`px-3 py-1.5 text-xs uppercase tracking-widest border rounded-sm transition-colors ${
            defaultPolicy === "allow"
              ? "bg-green-500/20 text-green-400 border-green-500/40"
              : "bg-transparent text-[#555] border-[#333] hover:border-green-500/40 hover:text-green-400"
          }`}
        >
          <TbShieldCheck size={12} className="inline mr-1" /> Allow
        </button>
        <button
          onClick={() => handleSetDefault("deny")}
          disabled={saving}
          className={`px-3 py-1.5 text-xs uppercase tracking-widest border rounded-sm transition-colors ${
            defaultPolicy === "deny"
              ? "bg-red-500/20 text-red-400 border-red-500/40"
              : "bg-transparent text-[#555] border-[#333] hover:border-red-500/40 hover:text-red-400"
          }`}
        >
          <TbShieldX size={12} className="inline mr-1" /> Deny
        </button>
      </div>

      {/* Rules Table */}
      {rules.length > 0 && (
        <div className="border border-[#1a2a3a] rounded-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#050a0f] text-[#555] uppercase tracking-widest">
                <th className="text-left p-3">Agent</th>
                <th className="text-left p-3">Namespace</th>
                <th className="text-left p-3">Policy</th>
                <th className="text-right p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t border-[#1a2a3a] hover:bg-[#0d1a25]">
                  <td className="p-3 text-[#D4AF37] font-mono">{rule.agent_label}</td>
                  <td className="p-3 text-[#ededed] font-mono">{rule.namespace}</td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-widest ${
                      rule.policy === "allow"
                        ? "bg-green-500/20 text-green-400"
                        : "bg-red-500/20 text-red-400"
                    }`}>
                      {rule.policy === "allow" ? <TbShieldCheck size={10} /> : <TbShieldX size={10} />}
                      {rule.policy}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDeleteRule(rule.id)} className="text-[#555] hover:text-red-400 transition-colors">
                      <TbTrash size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Rule */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] text-[#555] uppercase tracking-widest block mb-1">Agent</label>
          <input
            list="agent-options"
            value={newAgent} onChange={(e) => setNewAgent(e.target.value)}
            placeholder="agent label"
            className="bg-[#050a0f] border border-[#D4AF37]/20 text-white text-xs px-3 py-2 w-40 focus:outline-none focus:border-[#D4AF37]/50 placeholder-[#333] rounded-sm"
          />
          <datalist id="agent-options">
            {agents.map(a => <option key={a} value={a} />)}
          </datalist>
        </div>
        <div>
          <label className="text-[10px] text-[#555] uppercase tracking-widest block mb-1">Namespace</label>
          <input
            list="ns-options"
            value={newNamespace} onChange={(e) => setNewNamespace(e.target.value)}
            placeholder="namespace"
            className="bg-[#050a0f] border border-[#D4AF37]/20 text-white text-xs px-3 py-2 w-40 focus:outline-none focus:border-[#D4AF37]/50 placeholder-[#333] rounded-sm"
          />
          <datalist id="ns-options">
            {namespaces.map(n => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div>
          <label className="text-[10px] text-[#555] uppercase tracking-widest block mb-1">Policy</label>
          <select
            value={newPolicy} onChange={(e) => setNewPolicy(e.target.value)}
            className="bg-[#050a0f] border border-[#D4AF37]/20 text-white text-xs px-3 py-2 focus:outline-none appearance-none rounded-sm"
          >
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
        </div>
        <button
          onClick={handleAddRule}
          disabled={saving || !newAgent || !newNamespace}
          className="px-4 py-2 bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30 text-xs uppercase tracking-widest hover:bg-[#D4AF37]/30 transition-colors disabled:opacity-50 flex items-center gap-1 rounded-sm"
        >
          {saving ? <TbLoader2 size={12} className="animate-spin" /> : <TbPlus size={12} />}
          Add Rule
        </button>
      </div>

      {rules.length === 0 && (
        <p className="text-xs text-[#555] italic">
          No explicit rules configured. All agents follow the default policy ({defaultPolicy}).
        </p>
      )}
    </GoldCard>
  );
}
